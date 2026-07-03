// =============================================================================
// /api/associates · CRUD + aplicações de associação + aprovar/negar + categoria
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { notificarCorretorAprovado, notificarCorretorNegado } from "../services/vaiClient.js";
import { sendCapiEvent, userFromReqAndForm, isCapiEnabled } from "../services/metaCapi.js";
import { logger } from "../utils/logger.js";
import { sendMagicLinkWhatsApp } from "../services/magicAuth.js";
import { isEnabled as isWaCloudEnabled } from "../services/whatsappCloud.js";
import * as imobisec from "../services/imobisec.js";

// Disco · credenciais CRECI. Setável via env CRECI_STORAGE_DIR, default /root/vaidavenda-calebe/storage/creci
const CRECI_DIR = process.env.CRECI_STORAGE_DIR || "/root/vaidavenda-calebe/storage/creci";
try { fs.mkdirSync(CRECI_DIR, { recursive: true }); } catch {}

const creciUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, CRECI_DIR),
    filename: (_req, file, cb) => {
      const ts = Date.now();
      const rnd = crypto.randomBytes(4).toString("hex");
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 8) || "";
      const safe = path.basename(file.originalname, path.extname(file.originalname))
        .replace(/[^\w.-]/g, "_").slice(0, 40);
      cb(null, `${ts}-${rnd}-${safe}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },          // 8 MB
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg","image/png","image/webp","application/pdf"].includes(file.mimetype);
    cb(ok ? null : new Error("invalid_mime"), ok);
  }
});

// Gera senha temporária única por aprovação · 10 chars · inclui 1 maiúscula, 1 minúscula,
// 1 dígito e 1 símbolo pra atender políticas básicas. Ex: "Kx7@p2Nqfr"
function generateTempPassword(){
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";     // sem I/O (ambíguos)
  const lower = "abcdefghijkmnopqrstuvwxyz";    // sem l
  const digit = "23456789";                     // sem 0/1
  const sym   = "!@#$%&*";
  const all   = upper + lower + digit + sym;
  const pick = (set) => set[crypto.randomInt(0, set.length)];
  const chars = [pick(upper), pick(lower), pick(digit), pick(sym)];
  for (let i = 0; i < 6; i++) chars.push(pick(all));
  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--){
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const r = Router();

// ---------- Listagem (admin) -------------------------------------------------
r.get("/", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const take = Math.min(Number(req.query.limit) || 50, 5000);  // 2026-05-14 · cap subido p/ comportar 266+ corretores no admin Corretores
    const skip = Number(req.query.offset) || 0;
    const where = {
      ...(req.query.status  ? { status:   req.query.status } : {}),
      ...(req.query.category? { category: req.query.category } : {}),
      ...(req.query.segment ? { segment:  req.query.segment } : {}),
      ...(req.query.q ? { user: { name: { contains: String(req.query.q), mode: "insensitive" } } } : {})
    };
    const [data, total] = await Promise.all([
      db.associate.findMany({
        where, take, skip, orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id:true, name:true, email:true, lastLoginAt:true, lastSeenAt:true, magicSentAt:true, magicUsedAt:true, magicExpiresAt:true, active:true } },
          _count: { select: { leads: true, sales: true } }
        }
      }),
      db.associate.count({ where })
    ]);
    // Contagem de vendas APPROVED · respeita RANKING_CUTOFF_AT pra zerar ranking sem perder dados.
    const ids = data.map(a => a.id);
    const rankingCutoff = process.env.RANKING_CUTOFF_AT ? new Date(process.env.RANKING_CUTOFF_AT) : null;
    const saleWhere = { associateId: { in: ids }, status: "APPROVED", ...(rankingCutoff ? { createdAt: { gte: rankingCutoff } } : {}) };
    const approvedCounts = ids.length
      ? await db.sale.groupBy({ by: ["associateId"], where: saleWhere, _count: { _all: true } })
      : [];
    const approvedMap = Object.fromEntries(approvedCounts.map(r => [r.associateId, r._count._all]));
    const enriched = data.map(a => ({ ...a, salesApprovedCount: approvedMap[a.id] || 0 }));
    res.json({ data: enriched, total, limit: take, offset: skip });
  } catch (e){ next(e); }
});

// ---------- Perfil do próprio corretor (self-update) ------------------------
// PATCH /api/associates/me · corretor logado atualiza os próprios dados públicos
// (phone, whatsapp, bio, photoUrl, creci, creciUf) que aparecem na LP de afiliado.
// IMPORTANTE: declarar ANTES de /:id pra Express não tratar "me" como id.
r.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      phone:    z.string().max(32).optional(),
      whatsapp: z.string().max(32).optional(),
      bio:      z.string().max(2000).optional(),
      photoUrl: z.string().max(1000).optional(),
      creci:    z.string().max(32).optional(),
      creciUf:  z.string().length(2).optional(),
      cpf:      z.string().max(20).optional(),
      rg:       z.string().max(20).optional(),
      address:  z.string().max(500).optional(),
      bankData: z.string().max(500).optional(),
      pixKey:   z.string().max(200).optional()
    });
    const raw = schema.parse(req.body);
    // Filtra campos vazios: campo vazio ("") não deve sobrescrever valor existente no banco.
    const data = Object.fromEntries(Object.entries(raw).filter(([_, v]) => v !== undefined && v !== ""));
    if (Object.keys(data).length === 0) return res.status(200).json({});
    const assoc = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
    if (!assoc) return res.status(404).json({ error: "not_an_associate" });
    const updated = await db.associate.update({
      where: { id: assoc.id },
      data,
      select: { id: true, phone: true, whatsapp: true, bio: true, photoUrl: true, creci: true, creciUf: true, cpf: true, rg: true, address: true, bankData: true, pixKey: true }
    });
    await audit({ req, action: "ASSOCIATE_SELF_UPDATE", entity: `Associate:${assoc.id}`, metadata: { fields: Object.keys(data) } });
    return res.json(updated);
  } catch (e){ next(e); }
});

// ---------- Perfil público (LP de afiliado) ---------------------------------
// GET /api/associates/public-by-slug/:slug · SEM auth · retorna apenas dados
// que podem ser exibidos numa landing page pública (nome, bio, foto, creci, whatsapp, phone).
// Slug = primeiro nome do corretor em lowercase (mesma convenção usada em buildLpImovelUrl).
// IMPORTANTE: precisa vir ANTES de /:id pra Express não interpretar como id.
r.get("/public-by-slug/:slug", async (req, res, next) => {
  try {
    const raw = String(req.params.slug || "").trim();
    if (!raw) return res.status(400).json({ error: "slug_required" });
    let match = null;
    // Se parece um CUID (c + 24 chars alfanuméricos), busca direto pelo id · robusto
    if (/^c[a-z0-9]{20,}$/i.test(raw)){
      match = await db.associate.findFirst({
        where: { id: raw, status: "APPROVED" },
        include: { user: { select: { name: true } } }
      });
    }
    // Fallback legado · primeiro nome em lowercase (URLs antigas)
    if (!match){
      const slug = raw.toLowerCase();
      const aprovados = await db.associate.findMany({
        where: { status: "APPROVED" },
        include: { user: { select: { name: true } } }
      });
      match = aprovados.find(a => {
        const first = (a.user?.name || "").trim().split(/\s+/)[0] || "";
        return first.toLowerCase() === slug;
      });
    }
    if (!match) return res.status(404).json({ error: "not_found" });
    return res.json({
      name:     match.user?.name || "",
      bio:      match.bio || "",
      photoUrl: match.photoUrl || "",
      creci:    match.creci || "",
      creciUf:  match.creciUf || "",
      whatsapp: match.whatsapp || "",
      phone:    match.phone || ""
    });
  } catch (e){ next(e); }
});

// ---------- Aplicações (fluxo público — cadastro de novo associado) ----------
// Estas rotas precisam vir ANTES de /:id para não serem capturadas como id="applications".
const applicationSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(10),
  cpf: z.string().min(11),
  rg: z.string().optional(),
  creci: z.string().min(3),
  creciUf: z.string().length(2),
  city: z.string().min(2),
  currentAgency: z.string().optional(),
  yearsMarket: z.number().int().optional(),
  instagram: z.string().optional(),
  notes: z.string().optional(),
  credentialUrl: z.string().optional()
});

// POST /api/associates/applications · aceita multipart (file "credential") OU JSON puro
// Campos numéricos (yearsMarket) chegam como string em multipart — convertemos antes do zod.
r.post("/applications", creciUpload.single("credential"), async (req, res, next) => {
  try {
    const body = { ...req.body };
    if (body.yearsMarket !== undefined && body.yearsMarket !== "") body.yearsMarket = Number(body.yearsMarket);
    else delete body.yearsMarket;
    // Remove credentialUrl se veio do cliente · fonte autoritativa é o arquivo anexado
    delete body.credentialUrl;
    const data = applicationSchema.parse(body);
    if (req.file) data.credentialUrl = req.file.filename;   // path relativo dentro de CRECI_DIR
    const app = await db.associateApplication.create({ data });
    await audit({
      action: "ASSOCIATE_APPLICATION",
      entity: `App:${app.id}`,
      metadata: { email: app.email, creci: app.creci, hasFile: !!req.file, fileName: req.file?.filename }
    });
    logger.info({ appId: app.id, email: app.email, creci: app.creci, file: req.file?.filename }, "✓ nova aplicação de corretor");
    res.status(201).json({ id: app.id, status: app.status, credentialUrl: app.credentialUrl || null });
    // Meta CAPI · Lead server-side (não bloqueia a resposta) · event_id casa com o do pixel
    if (isCapiEnabled()){
      const eventId = req.body?.event_id || `lead_${app.id}`;
      const eventSourceUrl = req.body?.event_source_url
        || (req.headers?.referer || `https://${req.headers?.host || "app.calebe.tech"}/`);
      const user = userFromReqAndForm(req, { ...req.body, name: app.name, email: app.email, phone: app.phone, cpf: app.cpf, city: app.city, creciUf: app.creciUf });
      sendCapiEvent({
        eventName: "Lead",
        eventId,
        eventSourceUrl,
        user,
        customData: { content_name: "Cadastro corretor associado Calebe", content_category: "broker_application", currency: "BRL", value: 0 }
      }).catch(err => logger.warn({ err: err?.message, appId: app.id }, "[capi] lead falhou"));
    }
  } catch (e){
    // Se zod falhou mas subiu um arquivo, remove pra não deixar lixo
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch {} }
    next(e);
  }
});

// GET /api/associates/applications/:id/credential · admin baixa/visualiza o CRECI anexado
r.get("/applications/:id/credential", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const app = await db.associateApplication.findUnique({
      where: { id: req.params.id },
      select: { id: true, credentialUrl: true, name: true, creci: true }
    });
    if (!app) return res.status(404).json({ error: "not_found" });
    if (!app.credentialUrl) return res.status(404).json({ error: "no_credential" });
    // Segurança contra path traversal · só aceita basename
    const safeName = path.basename(app.credentialUrl);
    const filePath = path.join(CRECI_DIR, safeName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "file_missing" });
    await audit({ req, action: "ASSOCIATE_CREDENTIAL_VIEWED", entity: `App:${app.id}`, metadata: { file: safeName } });
    // inline: navegador renderiza se for imagem/pdf
    res.setHeader("Content-Disposition", `inline; filename="creci-${app.creci}-${app.name.replace(/[^\w]/g, "_")}${path.extname(safeName)}"`);
    res.sendFile(filePath);
  } catch (e){ next(e); }
});

// GET /api/associates/applications/:id/creci-status · pré-consulta IMOBISEC (cacheada).
// ?fresh=1 força reconsulta (gasta crédito). Sem token → status "not_configured".
r.get("/applications/:id/creci-status", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const app = await db.associateApplication.findUnique({
      where: { id: req.params.id },
      select: { id: true, creci: true, creciUf: true },
    });
    if (!app) return res.status(404).json({ error: "not_found" });
    const out = await imobisec.checkCreci({ uf: app.creciUf, creci: app.creci, forceFresh: req.query.fresh === "1" });
    res.json({ id: app.id, ...out });
  } catch (e){ next(e); }
});

// POST /api/associates/applications/creci-status · lote { ids:[...] } → { configured, results }.
// Consulta (e cacheia) os ids informados. Enviar só os PENDING pra controlar custo.
r.post("/applications/creci-status", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    if (!imobisec.isConfigured()) return res.json({ configured: false, results: {} });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(x => typeof x === "string").slice(0, 300) : [];
    if (!ids.length) return res.json({ configured: true, results: {} });
    const apps = await db.associateApplication.findMany({
      where: { id: { in: ids } },
      select: { id: true, creci: true, creciUf: true },
    });
    const results = await imobisec.checkMany(apps.map(a => ({ id: a.id, uf: a.creciUf, creci: a.creci })));
    res.json({ configured: true, results });
  } catch (e){ next(e); }
});

r.get("/applications", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Number(req.query.offset) || 0;
    const where = req.query.status ? { status: req.query.status } : {};
    const [data, total] = await Promise.all([
      db.associateApplication.findMany({ where, take, skip, orderBy: { createdAt: "desc" } }),
      db.associateApplication.count({ where })
    ]);
    // Resolve nome/email do admin que revisou (reviewedBy) e do que preencheu background check,
    // em um único round-trip. Usa chaves textuais (reviewedBy/backgroundCheckedBy = User.id)
    const ids = new Set();
    for (const a of data){
      if (a.reviewedBy) ids.add(a.reviewedBy);
      if (a.backgroundCheckedBy) ids.add(a.backgroundCheckedBy);
    }
    if (ids.size){
      const users = await db.user.findMany({
        where: { id: { in: Array.from(ids) } },
        select: { id: true, name: true, email: true }
      });
      const map = Object.fromEntries(users.map(u => [u.id, { name: u.name, email: u.email }]));
      for (const a of data){
        a.reviewer = a.reviewedBy ? (map[a.reviewedBy] || null) : null;
        a.backgroundChecker = a.backgroundCheckedBy ? (map[a.backgroundCheckedBy] || null) : null;
      }
    }
    res.json({ data, total });
  } catch (e){ next(e); }
});

r.get("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const a = await db.associate.findUnique({
      where: { id: req.params.id },
      include: { user: true }
    });
    if (!a) return res.status(404).json({ error: "not_found" });
    const application = a.applicationId
      ? await db.associateApplication.findUnique({ where: { id: a.applicationId } })
      : null;
    res.json({ ...a, application });
  } catch (e){ next(e); }
});

// ---------- Background check (validação manual antes de aprovar/negar) ----
// PATCH /api/associates/applications/:id/background-check · admin grava status SPC/SERASA,
// Civil, Criminal, CRECI + observações internas. Dados NÃO vão pro corretor e NÃO saem em nenhuma
// mensagem — servem só pra histórico interno e base de decisão de aprovação.
const backgroundCheckSchema = z.object({
  creciStatus:     z.enum(["APT","INAPT","WAITING"]).nullable().optional(),
  spcSerasaStatus: z.enum(["CLEAN","RESTRICTIONS","PENDING"]).nullable().optional(),
  civilStatus:     z.enum(["CLEAN","RESTRICTIONS","PENDING"]).nullable().optional(),
  criminalStatus:  z.enum(["CLEAN","RESTRICTIONS","PENDING"]).nullable().optional(),
  backgroundNotes: z.string().max(2000).nullable().optional()
});

r.patch("/applications/:id/background-check", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const data = backgroundCheckSchema.parse(req.body);
    const exists = await db.associateApplication.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: "not_found" });
    const updated = await db.associateApplication.update({
      where: { id: req.params.id },
      data: { ...data, backgroundCheckedAt: new Date(), backgroundCheckedBy: req.user.id },
      select: {
        id: true,
        creciStatus: true,
        spcSerasaStatus: true,
        civilStatus: true,
        criminalStatus: true,
        backgroundNotes: true,
        backgroundCheckedAt: true,
        backgroundCheckedBy: true
      }
    });
    await audit({
      req,
      action: "ASSOCIATE_APPLICATION_BACKGROUND_CHECK",
      entity: `App:${updated.id}`,
      metadata: {
        creciStatus: updated.creciStatus,
        spcSerasaStatus: updated.spcSerasaStatus,
        civilStatus: updated.civilStatus,
        criminalStatus: updated.criminalStatus,
        hasNotes: !!updated.backgroundNotes
      }
    });
    res.json(updated);
  } catch (e){ next(e); }
});

// ---------- Aprovar aplicação ------------------------------------------------
const approveSchema = z.object({
  category: z.enum(["BRONZE","SILVER","GOLD","DIAMOND"]).default("BRONZE"),
  segment:  z.enum(["Alto padrão","Investidor","Lançamentos","Regional"]).default("Regional"),
  tempPassword: z.string().min(6).optional()
});

r.patch("/:id/approve", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { category, segment, tempPassword } = approveSchema.parse(req.body);
    const app = await db.associateApplication.findUnique({ where: { id: req.params.id } });
    if (!app) return res.status(404).json({ error: "application_not_found" });
    if (app.status !== "PENDING") return res.status(409).json({ error: "already_reviewed" });

    const senha = tempPassword || generateTempPassword();
    const passwordHash = await bcrypt.hash(senha, 12);

    const user = await db.user.upsert({
      where: { email: app.email },
      create: { email: app.email, name: app.name, passwordHash, role: "ASSOCIATE" },
      update: { role: "ASSOCIATE", active: true }
    });

    await db.associateApplication.update({
      where: { id: app.id },
      data: { status: "APPROVED", reviewedBy: req.user.id, reviewedAt: new Date() }
    });

    const associate = await db.associate.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        applicationId: app.id,
        category, segment,
        creci: app.creci, creciUf: app.creciUf,
        phone: app.phone, cpf: app.cpf, rg: app.rg
      },
      update: { status: "APPROVED", category, segment }
    });
    await audit({ req, action: "ASSOCIATE_APPROVED", entity: `Associate:${associate.id}`, metadata: { applicationId: app.id, category, segment } });

    // 2026-05-11 · Estratégia de notificação · Magic Link via Cloud API (template
     // `calebe_acesso_aprovado` com botão URL dinâmico). Se Cloud API não estiver
     // habilitada ou der erro, fallback pro fluxo VAI antigo (com senha temporária).
    let notifyMode = "magic_cloud";
    (async () => {
      try {
        if (isWaCloudEnabled()){
          const r1 = await sendMagicLinkWhatsApp(user, associate);
          if (r1.ok){
            audit({ req, action: "ASSOCIATE_APPROVED_MAGIC_SENT", entity: `Associate:${associate.id}`, metadata: { messageId: r1.messageId, phone: app.phone } }).catch(()=>{});
            logger.info({ associateId: associate.id, email: app.email, messageId: r1.messageId }, "🔐 aprovacao · magic link enviado via Cloud API");
            return;
          }
          logger.warn({ associateId: associate.id, err: r1.error, status: r1.status, code: r1.code }, "magic_cloud falhou · caindo pro fluxo VAI legado");
          notifyMode = "vai_fallback";
        } else {
          notifyMode = "vai_fallback_disabled";
        }
        // Fallback · fluxo VAI antigo com senha temporária
        const r2 = await notificarCorretorAprovado({
          associateId: associate.id,
          name: app.name,
          email: app.email,
          phone: app.phone,
          tempPassword: senha,
          urlSistema: process.env.APP_PUBLIC_URL || "https://app.calebe.tech"
        });
        if (r2.ok && r2.mode === "direct_bound"){
          audit({ req, action: "ASSOCIATE_APPROVED_NOTIFIED", entity: `Associate:${associate.id}`, metadata: { chatId: r2.chatId, fallback: notifyMode } }).catch(()=>{});
        } else if (r2.ok && r2.mode === "queued"){
          audit({ req, action: "ASSOCIATE_APPROVED_QUEUED", entity: `Associate:${associate.id}`, metadata: { phone: app.phone, fallback: notifyMode } }).catch(()=>{});
        } else if (!r2.ok){
          logger.warn({ associateId: associate.id, reason: r2.error || r2.skipped, fallback: notifyMode }, "aprovacao_notified_skip");
        }
      } catch (err){
        logger.warn({ err: err.message, associateId: associate.id }, "aprovacao_notify_throw");
      }
    })();

    res.json({ associateId: associate.id, userId: user.id, tempPassword: senha, notifyMode: "magic_link_or_fallback" });
  } catch (e){ next(e); }
});

// 2026-05-11 · POST /api/associates/:id/send-magic
// Admin reenvia magic link pra um corretor específico (ex: alguém aprovado mas
// que não conseguiu fazer o 1º acesso). Gera token novo, envia via Cloud API.
r.post("/:id/send-magic", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const associate = await db.associate.findUnique({
      where: { id: req.params.id },
      include: { user: true }
    });
    if (!associate) return res.status(404).json({ error: "associate_not_found" });
    if (!associate.user) return res.status(409).json({ error: "associate_without_user" });
    if (!associate.user.active) return res.status(409).json({ error: "user_inactive" });

    if (!isWaCloudEnabled()){
      return res.status(503).json({ error: "whatsapp_cloud_disabled" });
    }
    const r1 = await sendMagicLinkWhatsApp(associate.user, associate);
    if (!r1.ok){
      logger.warn({ associateId: associate.id, err: r1.error }, "send-magic falhou");
      return res.status(r1.status || 502).json({ error: r1.error, code: r1.code, body: r1.body });
    }
    await audit({ req, action: "ASSOCIATE_MAGIC_RESENT", entity: `Associate:${associate.id}`, metadata: { messageId: r1.messageId } });
    logger.info({ associateId: associate.id, email: associate.user.email, messageId: r1.messageId, by: req.user.email }, "🔁 magic_link · reenviado por admin");
    res.json({ ok: true, messageId: r1.messageId, to: r1.to });
  } catch (e){ next(e); }
});

// 2026-05-11 · POST /api/associates/bulk-send-magic
// Admin reenvia magic link em LOTE pros corretores que nunca logaram.
// Body opcional: { extraTargets: ["userId1", ...] } pra incluir usuários
// específicos no envio (ex: testar com nº próprio). Sleep 1.5s entre envios
// pra não estourar rate limit Cloud API.
const bulkSchema = z.object({
  extraTargets: z.array(z.string()).max(20).optional()
});

r.post("/bulk-send-magic", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const input = bulkSchema.parse(req.body || {});
    if (!isWaCloudEnabled()){
      return res.status(503).json({ error: "whatsapp_cloud_disabled" });
    }

    // Aprovados ativos que nunca logaram
    const targets = await db.user.findMany({
      where: {
        role: "ASSOCIATE",
        active: true,
        lastLoginAt: null,
        ...(input.extraTargets?.length ? {} : {})
      },
      include: { associate: true }
    });

    // Adiciona extras (se passados) sem duplicar
    let allUsers = targets;
    if (input.extraTargets?.length){
      const extras = await db.user.findMany({
        where: { id: { in: input.extraTargets } },
        include: { associate: true }
      });
      const ids = new Set(allUsers.map(u => u.id));
      for (const e of extras) if (!ids.has(e.id)) allUsers.push(e);
    }

    const results = { total: allUsers.length, sent: 0, failed: 0, skipped: 0, items: [] };
    for (const u of allUsers){
      if (!u.associate){ results.skipped++; results.items.push({ userId: u.id, email: u.email, skipped: "no_associate_record" }); continue; }
      try {
        const r1 = await sendMagicLinkWhatsApp(u, u.associate);
        if (r1.ok){
          results.sent++;
          results.items.push({ userId: u.id, email: u.email, ok: true, to: r1.to, messageId: r1.messageId });
        } else {
          results.failed++;
          results.items.push({ userId: u.id, email: u.email, ok: false, error: r1.error, status: r1.status });
        }
      } catch (e){
        results.failed++;
        results.items.push({ userId: u.id, email: u.email, ok: false, error: e.message });
      }
      // Rate-limit · ~40/min (1.5s entre envios)
      await new Promise(r => setTimeout(r, 1500));
    }

    await audit({ req, action: "ASSOCIATE_MAGIC_BULK_SENT", entity: `Admin:${req.user.id}`,
      metadata: { total: results.total, sent: results.sent, failed: results.failed, skipped: results.skipped } });
    logger.info({ by: req.user.email, ...results, items: undefined }, "🔁 magic_link · bulk send terminado");

    res.json(results);
  } catch (e){ next(e); }
});

r.patch("/:id/deny", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || "").slice(0, 500);
    const app = await db.associateApplication.update({
      where: { id: req.params.id },
      data: { status: "DENIED", reviewedBy: req.user.id, reviewedAt: new Date(), denialReason: reason }
    });
    await audit({ req, action: "ASSOCIATE_DENIED", entity: `App:${app.id}`, metadata: { reason } });

    // Notifica corretor via WhatsApp (best-effort · não bloqueia resposta)
    notificarCorretorNegado({
      name: app.name,
      email: app.email,
      phone: app.phone,
      reason
    }).then(r => {
      if (r.ok){
        logger.info({ appId: app.id, mode: r.mode }, "negacao_notified");
        audit({ req, action: "ASSOCIATE_DENIED_NOTIFIED", entity: `App:${app.id}`, metadata: { mode: r.mode, phone: app.phone } }).catch(()=>{});
      } else {
        logger.warn({ appId: app.id, reason: r.error || r.skipped }, "negacao_notified_skip");
      }
    }).catch(err => logger.warn({ err: err.message }, "negacao_notified_throw"));

    res.json({ ok: true });
  } catch (e){ next(e); }
});

// ---------- Editar categoria / segmento / CRECI ------------------------------
r.patch("/:id/category", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const category = z.enum(["BRONZE","SILVER","GOLD","DIAMOND"]).parse(req.body.category);
    const prev = await db.associate.findUnique({ where: { id: req.params.id }, select: { category: true } });
    if (!prev) return res.status(404).json({ error: "not_found" });
    const a = await db.associate.update({ where: { id: req.params.id }, data: { category } });
    await audit({ req, action: "ASSOCIATE_CATEGORY_CHANGED", entity: `Associate:${a.id}`, metadata: { from: prev.category, to: category } });
    res.json({ id: a.id, category: a.category });
  } catch (e){ next(e); }
});

r.patch("/:id/segment", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const segment = z.enum(["Alto padrão","Investidor","Lançamentos","Regional"]).parse(req.body.segment);
    const a = await db.associate.update({ where: { id: req.params.id }, data: { segment } });
    await audit({ req, action: "ASSOCIATE_SEGMENT_CHANGED", entity: `Associate:${a.id}`, metadata: { segment } });
    res.json({ id: a.id, segment: a.segment });
  } catch (e){ next(e); }
});

r.patch("/:id/creci", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { creci, creciUf } = z.object({ creci: z.string().min(3), creciUf: z.string().length(2) }).parse(req.body);
    const a = await db.associate.update({ where: { id: req.params.id }, data: { creci, creciUf } });
    await audit({ req, action: "ASSOCIATE_CRECI_UPDATED", entity: `Associate:${a.id}`, metadata: { creci, creciUf } });
    res.json({ id: a.id, creci, creciUf });
  } catch (e){ next(e); }
});

// Desativar / reativar (e bloquear · INACTIVE + reason + dispatch template)
r.patch("/:id/status", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const status = z.enum(["APPROVED","INACTIVE","DENIED"]).parse(req.body.status);
    const reason = (req.body.reason || "").toString().trim().slice(0, 500);
    const id = req.params.id;

    // Pega status anterior para detectar reativacao (INACTIVE -> APPROVED)
    const before = await db.associate.findUnique({
      where: { id },
      select: { status: true, phone: true, whatsapp: true, user: { select: { name: true } } }
    });
    if (!before) return res.status(404).json({ error: "not_found" });

    // Quando bloqueia (vai pra INACTIVE), guarda motivo + timestamp. Quando reativa, limpa.
    const updateData = { status };
    if (status === "INACTIVE"){
      updateData.blockReason = reason || null;
      updateData.blockedAt = new Date();
    } else if (status === "APPROVED" && before.status === "INACTIVE"){
      updateData.blockReason = null;
      updateData.blockedAt = null;
    }

    const a = await db.associate.update({ where: { id }, data: updateData });

    // Dispara template Meta `calebe_acesso_bloqueado` se virou INACTIVE e tem motivo
    let blockNoticeSent = false;
    if (status === "INACTIVE" && reason && before.status !== "INACTIVE"){
      const to = before.whatsapp || before.phone;
      if (to && isWaCloudEnabled()){
        try {
          const { sendTemplate } = await import("../services/whatsappCloud.js");
          const firstName = (before.user?.name || "Corretor").split(" ")[0];
          const r1 = await sendTemplate({
            to,
            templateName: "calebe_acesso_bloqueado",
            languageCode: "pt_BR",
            bodyParams: [firstName, reason]
          });
          blockNoticeSent = !!r1.ok;
          logger.info({ associateId: id, messageId: r1.messageId, blockNoticeSent }, "block-notice enviado");
        } catch (e){
          logger.warn({ associateId: id, err: e?.message }, "block-notice falhou · template pode estar PENDING/REJECTED");
        }
      }
    }

    let leadsRestored = 0;
    // Reativacao: restaura leads que ainda estao na fila E tem conversa com esse broker
    if (before.status === "INACTIVE" && status === "APPROVED") {
      // Busca leads cujas conversations apontam pra esse broker E que estao na fila (assignedToId = null)
      const candidatos = await db.lead.findMany({
        where: {
          assignedToId: null,
          status: { notIn: ["CLOSED", "LOST"] },
          conversation: { is: { associateId: id } }
        },
        select: { id: true }
      });
      if (candidatos.length > 0) {
        const r = await db.lead.updateMany({
          where: { id: { in: candidatos.map(c => c.id) } },
          data: { assignedToId: id, assignedAt: new Date() }
        });
        leadsRestored = r.count;
        await audit({
          req,
          action: "leads_restored_on_reactivate",
          entity: `Associate:${id}`,
          metadata: { leadsRestored, leadIds: candidatos.map(c => c.id) }
        });
        logger.info({ associateId: id, leadsRestored }, "leads restaurados na reativacao");
      }
    }

    await audit({ req, action: "ASSOCIATE_STATUS_CHANGED", entity: `Associate:${a.id}`, metadata: { status, previousStatus: before.status, leadsRestored, reason, blockNoticeSent } });
    res.json({ id: a.id, status: a.status, leadsRestored, blockReason: a.blockReason, blockedAt: a.blockedAt, blockNoticeSent });
  } catch (e){ next(e); }
});


// 2026-05-11 · PATCH /api/associates/:id · admin · edit completo (User + Associate + Application)
// Aceita qualquer subconjunto: name, email, phone, whatsapp, cpf, rg, creci, creciUf, city,
// instagram, yearsMarket, currentAgency, password (define nova senha do User).
r.patch("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const id = req.params.id;
    const schema = z.object({
      name:           z.string().min(2).max(120).optional(),
      email:          z.string().email().max(180).optional(),
      phone:          z.string().min(8).max(30).optional(),
      whatsapp:       z.string().min(8).max(30).optional(),
      cpf:            z.string().max(20).optional(),
      rg:             z.string().max(20).optional(),
      creci:          z.string().min(3).max(20).optional(),
      creciUf:        z.string().length(2).optional(),
      city:           z.string().max(80).optional(),
      instagram:      z.string().max(60).optional(),
      yearsMarket:    z.union([z.string(), z.number()]).optional(),
      currentAgency:  z.string().max(120).optional(),
      password:       z.string().min(8).max(120).optional()
    }).strict();
    const data = schema.parse(req.body || {});

    const existing = await db.associate.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true, name: true } } }
    });
    if (!existing) return res.status(404).json({ error: "not_found" });

    // User fields (name, email, password)
    const userPatch = {};
    if (data.name)  userPatch.name  = data.name;
    if (data.email && data.email.toLowerCase() !== existing.user.email.toLowerCase()){
      const clash = await db.user.findUnique({ where: { email: data.email }, select: { id: true } });
      if (clash && clash.id !== existing.user.id) return res.status(409).json({ error: "email_in_use" });
      userPatch.email = data.email;
    }
    if (data.password){
      userPatch.passwordHash = await bcrypt.hash(data.password, 12);
    }
    if (Object.keys(userPatch).length){
      await db.user.update({ where: { id: existing.user.id }, data: userPatch });
    }

    // Associate fields
    const assocPatch = {};
    if (data.phone)    assocPatch.phone    = data.phone;
    if (data.whatsapp) assocPatch.whatsapp = data.whatsapp;
    if (data.cpf)      assocPatch.cpf      = data.cpf;
    if (data.rg)       assocPatch.rg       = data.rg;
    if (data.creci)    assocPatch.creci    = data.creci;
    if (data.creciUf)  assocPatch.creciUf  = data.creciUf.toUpperCase();
    if (Object.keys(assocPatch).length){
      await db.associate.update({ where: { id }, data: assocPatch });
    }

    // Application fields (se houver application vinculada)
    const appPatch = {};
    if (data.city)          appPatch.city          = data.city;
    if (data.instagram)     appPatch.instagram     = data.instagram;
    if (data.yearsMarket != null) appPatch.yearsMarket = String(data.yearsMarket);
    if (data.currentAgency) appPatch.currentAgency = data.currentAgency;
    if (existing.applicationId && Object.keys(appPatch).length){
      await db.associateApplication.update({ where: { id: existing.applicationId }, data: appPatch });
    }

    await audit({
      req,
      action: "ASSOCIATE_FULL_UPDATED",
      entity: `Associate:${id}`,
      metadata: {
        userFields:  Object.keys(userPatch).filter(k => k !== "passwordHash"),
        passwordChanged: !!userPatch.passwordHash,
        assocFields: Object.keys(assocPatch),
        appFields:   Object.keys(appPatch)
      }
    });

    const fresh = await db.associate.findUnique({
      where: { id },
      include: { user: { select: { id:true, name:true, email:true, lastLoginAt:true, lastSeenAt:true, magicSentAt:true } } }
    });
    res.json(fresh);
  } catch (e){
    if (e?.code === "P2002") return res.status(409).json({ error: "unique_clash" });
    next(e);
  }
});


// 2026-05-12 · POST /api/associates/:id/praise · admin manda reconhecimento via template Meta
// Body: { message: string }  → dispara template `calebe_reconhecimento` com nome + mensagem livre.
r.post("/:id/praise", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const id = req.params.id;
    const schema = z.object({ message: z.string().min(5).max(700) });
    const { message } = schema.parse(req.body || {});
    const a = await db.associate.findUnique({
      where: { id },
      select: { phone: true, whatsapp: true, user: { select: { name: true, id: true } } }
    });
    if (!a) return res.status(404).json({ error: "not_found" });
    const to = a.whatsapp || a.phone;
    if (!to) return res.status(422).json({ error: "no_phone" });
    if (!isWaCloudEnabled()) return res.status(503).json({ error: "cloud_api_disabled" });
    const { sendTemplate } = await import("../services/whatsappCloud.js");
    const firstName = (a.user?.name || "Corretor").split(" ")[0];
    const r1 = await sendTemplate({
      to,
      templateName: "calebe_reconhecimento",
      languageCode: "pt_BR",
      bodyParams: [firstName, message]
    });
    if (!r1.ok) return res.status(502).json({ error: r1.error || "send_failed", code: r1.code, status: r1.status });
    await audit({ req, action: "ASSOCIATE_PRAISE_SENT", entity: `Associate:${id}`, metadata: { messageId: r1.messageId, msgLen: message.length } });
    res.json({ ok: true, messageId: r1.messageId, to });
  } catch (e){ next(e); }
});


// 2026-05-11 · POST /api/associates/:id/send-block-notice · admin reenvia template de bloqueio manualmente
r.post("/:id/send-block-notice", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const id = req.params.id;
    const a = await db.associate.findUnique({
      where: { id },
      select: { phone: true, whatsapp: true, blockReason: true, status: true, user: { select: { name: true } } }
    });
    if (!a) return res.status(404).json({ error: "not_found" });
    if (a.status !== "INACTIVE") return res.status(409).json({ error: "not_blocked" });
    const to = a.whatsapp || a.phone;
    if (!to) return res.status(422).json({ error: "no_phone" });
    if (!isWaCloudEnabled()) return res.status(503).json({ error: "cloud_api_disabled" });
    const { sendTemplate } = await import("../services/whatsappCloud.js");
    const firstName = (a.user?.name || "Corretor").split(" ")[0];
    const r1 = await sendTemplate({
      to,
      templateName: "calebe_acesso_bloqueado",
      languageCode: "pt_BR",
      bodyParams: [firstName, a.blockReason || "Decisão da Calebe Investimentos"]
    });
    if (!r1.ok) return res.status(502).json({ error: r1.error || "send_failed", code: r1.code, status: r1.status });
    res.json({ ok: true, messageId: r1.messageId, to });
  } catch (e){ next(e); }
});


// DELETE /api/associates/:id · admin · só permite excluir se INACTIVE e sem histórico vinculado
r.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const a = await db.associate.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        _count: {
          select: {
            leads: true,
            conversations: true,
            visits: true,
            sales: true,
            commissions: true,
            structureReqs: true
          }
        }
      }
    });
    if (!a) return res.status(404).json({ error: "not_found" });
    if (a.status !== "INACTIVE") {
      return res.status(400).json({
        error: "not_inactive",
        message: "Desative o corretor antes de excluir."
      });
    }

    const blockers = [];
    if (a._count.conversations > 0) blockers.push(`${a._count.conversations} conversa(s)`);
    if (a._count.sales > 0)         blockers.push(`${a._count.sales} venda(s)`);
    if (a._count.commissions > 0)   blockers.push(`${a._count.commissions} comissao(oes)`);
    if (a._count.visits > 0)        blockers.push(`${a._count.visits} visita(s)`);
    if (a._count.structureReqs > 0) blockers.push(`${a._count.structureReqs} pedido(s) de estrutura`);
    if (blockers.length) {
      return res.status(409).json({
        error: "has_history",
        message: "Nao e possivel excluir: corretor tem " + blockers.join(", ") + ". Mantenha como Inativo.",
        blockers
      });
    }

    const userIdToDelete = a.user.id;
    const userName = a.user.name;

    await db.$transaction(async (tx) => {
      // Libera leads (assignedToId é nullable)
      await tx.lead.updateMany({ where: { assignedToId: id }, data: { assignedToId: null } });
      // Apaga associate
      await tx.associate.delete({ where: { id } });
      // Apaga user (cascade vai pegar pushSubscriptions, refreshTokens, auditEvents, notifications)
      await tx.user.delete({ where: { id: userIdToDelete } });
    });

    await audit({ req, action: "BROKER_DELETED", entity: `Associate:${id}`, metadata: { name: userName, email: a.user.email } });
    logger.info({ associateId: id, userId: userIdToDelete, name: userName }, "corretor excluido permanentemente");
    res.json({ ok: true });
  } catch (e) {
    if (e?.code === "P2003") {
      return res.status(409).json({ error: "fk_constraint", message: "Corretor tem registros vinculados que impedem a exclusao." });
    }
    next(e);
  }
});


// POST /api/associates/:id/transfer-leads · admin · move/devolve leads de um corretor
//   body: { destinationAssociateId?: string | null }
//   - se destinationAssociateId fornecido: transfere os leads para esse corretor
//   - se null/omitido: devolve à fila (assignedToId=null, status=NEW se nao closed/lost)
r.post("/:id/transfer-leads", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    // 2026-06-11 · Senha obrigatória para transferir leads de corretor
    const PWD = Buffer.from("Calebe@2026%%%");
    const provided = Buffer.from(String(req.body?.transferPassword || ""));
    const passwordProvided = provided.length > 0;
    const valid = provided.length === PWD.length && crypto.timingSafeEqual(provided, PWD);
    await db.$executeRawUnsafe(
      `INSERT INTO "LeadTransferLog" (id, "requestedBy", "associateId", action, "passwordProvided", "passwordCorrect", "ipAddress", notes)
       VALUES (gen_random_uuid()::text, $1, $2, 'transfer-leads', $3, $4, $5, $6)`,
      req.user?.email || "unknown",
      req.params.id,
      passwordProvided,
      valid,
      req.ip || null,
      valid ? "acesso autorizado" : "senha incorreta ou ausente"
    ).catch(() => {});
    if (!valid) return res.status(403).json({ error: "transfer_password_required", message: "Senha necessária para transferir lead de corretor" });

    // 2026-06-11 · Leads em atendimento são excluídos da transferência automática
    const PROTECTED_STATUSES = ["QUALIFYING", "CLOSING"];

    const { id } = req.params;
    const schema = z.object({
      destinationAssociateId: z.string().nullable().optional()
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(422).json({ error: "invalid_payload", issues: parsed.error.issues });

    const source = await db.associate.findUnique({
      where: { id },
      select: { id: true, user: { select: { name: true } } }
    });
    if (!source) return res.status(404).json({ error: "source_not_found" });

    const destId = parsed.data.destinationAssociateId || null;
    let destName = null;
    if (destId) {
      if (destId === id) return res.status(400).json({ error: "destination_same_as_source" });
      const dest = await db.associate.findUnique({
        where: { id: destId },
        select: { id: true, status: true, user: { select: { name: true } } }
      });
      if (!dest) return res.status(404).json({ error: "destination_not_found" });
      if (dest.status !== "APPROVED") return res.status(400).json({ error: "destination_not_active" });
      destName = dest.user.name;
    }

    const totalAntes = await db.lead.count({ where: { assignedToId: id } });
    if (totalAntes === 0) {
      return res.json({ ok: true, transferred: 0, mode: destId ? "transfer" : "return" });
    }

    let transferred = 0;
    await db.$transaction(async (tx) => {
      if (destId) {
        const r = await tx.lead.updateMany({
          where: { assignedToId: id, status: { notIn: PROTECTED_STATUSES } },
          data: { assignedToId: destId, assignedAt: new Date() }
        });
        transferred = r.count;
      } else {
        // Devolver à fila — só pra leads que nao foram fechados/perdidos nem em atendimento
        const r = await tx.lead.updateMany({
          where: { assignedToId: id, status: { notIn: ["CLOSED", "LOST", ...PROTECTED_STATUSES] } },
          data: { assignedToId: null, status: "NEW" }
        });
        transferred = r.count;
        // Leads CLOSED/LOST mantem assignedToId pra preservar historico
      }
    });

    await audit({
      req,
      action: destId ? "LEADS_TRANSFERRED" : "LEADS_RETURNED_TO_QUEUE",
      entity: `Associate:${id}`,
      metadata: {
        sourceName: source.user.name,
        destinationAssociateId: destId,
        destinationName: destName,
        totalAntes,
        transferred
      }
    });
    logger.info({ sourceId: id, destId, transferred, totalAntes }, destId ? "leads transferidos" : "leads devolvidos a fila");

    res.json({ ok: true, transferred, mode: destId ? "transfer" : "return", destinationAssociateId: destId, destinationName: destName });
  } catch (e) { next(e); }
});

export default r;
