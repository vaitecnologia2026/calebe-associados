// =============================================================================
// /api/properties · imóveis, mídia e documentos (armazenamento local em disco)
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { sendPushToUser, sendPushToRole } from "../services/push.js";

const r = Router();

// =============================================================================
// Metadados extras (empreendimento, unidades, preços secundários, visibilidade).
// Armazenados como JSON na primeira posição do array `features` com marcador
// __META__= (temporário até migration de novas colunas). splitMeta separa o JSON
// dos features reais e mergeMeta faz o caminho inverso.
// =============================================================================
const META_PREFIX = "__META__=";
function splitMeta(features){
  const arr = Array.isArray(features) ? features : [];
  let meta = null;
  const rest = [];
  for (const f of arr){
    if (typeof f === "string" && f.startsWith(META_PREFIX) && !meta){
      try { meta = JSON.parse(f.slice(META_PREFIX.length)); } catch { meta = null; }
    } else { rest.push(f); }
  }
  return { meta, features: rest };
}
function mergeMeta(features, meta){
  const rest = Array.isArray(features) ? features.filter(f => !(typeof f === "string" && f.startsWith(META_PREFIX))) : [];
  if (meta && Object.keys(meta).length) return [META_PREFIX + JSON.stringify(meta), ...rest];
  return rest;
}
// Enriquecimento do objeto retornado ao cliente: features "limpos" + _meta separado.
// 2026-05-27 · F2 fix · auto-deriva coverImageUrl da primeira mídia quando admin
// não cadastrou capa custom. Evita card sem foto quando há mídia mas não há capa.
function enrichProperty(p){
  if (!p) return p;
  const { meta, features } = splitMeta(p.features);
  const _meta = meta || {};
  if (!_meta.coverImageUrl && Array.isArray(p.media) && p.media.length > 0){
    const firstImage = p.media.find(m => m.mediaType === "image") || p.media[0];
    if (firstImage?.url) _meta.coverImageUrl = firstImage.url;
  }
  return { ...p, features, _meta };
}

// Raiz do projeto: dois níveis acima de backend/src/routes
const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const MIDIAS_DIR     = path.join(PROJECT_ROOT, "Midias");
const DOCUMENTOS_DIR = path.join(PROJECT_ROOT, "Documentos");
for (const d of [MIDIAS_DIR, DOCUMENTOS_DIR]){
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
}

function sanitizeFilename(name){
  return String(name || "").replace(/[^\w.\- ]/g, "_").replace(/\s+/g, "_").slice(0, 120);
}

const diskUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tipo = req.params.tipo === "documento" ? DOCUMENTOS_DIR : MIDIAS_DIR;
      const dir  = path.join(tipo, req.params.id);
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `${randomUUID()}-${sanitizeFilename(file.originalname)}`);
    }
  }),
  // 2026-05-15 · bumpado de 50MB → 100MB pra fotos hi-res do iPhone e videos.
  // Nginx aceita ate 60M (client_max_body_size em /etc/nginx/sites-enabled/calebe).
  // Vou tambem subir nginx pra 120M abaixo.
  limits: { fileSize: 100 * 1024 * 1024 }  // 100MB por arquivo
});

r.get("/", requireAuth, async (req, res, next) => {
  try {
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Number(req.query.offset) || 0;
    const where = {
      ...(req.query.status ? { status: req.query.status } : {}),
      ...(req.query.city   ? { city: { contains: String(req.query.city), mode: "insensitive" } } : {}),
      ...(req.query.special ? { isSpecial: req.query.special === "true" } : {})
    };
    const isAdmin = req.user.role === "ADMIN";
    // Admin enxerga tudo. Corretor só vê o que foi APROVADO para ele + o que ele mesmo enviou.
    let myAssociateId = null;
    if (!isAdmin){
      const a = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      myAssociateId = a?.id || null;
    }
    const raw = await db.property.findMany({
      where, orderBy: { createdAt: "desc" },
      include: { media: { orderBy: { order: "asc" } } }
    });
    let enriched = raw.map(enrichProperty);
    // Filtros derivados do submission status (o dado está em _meta.submission)
    if (req.query.submission){
      const s = String(req.query.submission).toUpperCase();
      // Admin pode usar ?submission=PENDING, APPROVED_PUBLIC, APPROVED_PRIVATE, DENIED
      enriched = enriched.filter(p => (p._meta?.submission?.status || "APPROVED_PUBLIC") === s);
    } else if (!isAdmin){
      // 2026-05-27 · F2 fix · APPROVED_PRIVATE com lista vazia/ausente vira público.
      // Era armadilha do admin: marcar privado e esquecer de listar corretores → ninguém via.
      // Solução: lista vazia = "ainda não restrito" → mostra pra todos. Privado SÓ funciona
      // se admin explicitamente listar quem pode ver.
      enriched = enriched.filter(p => {
        const sub = p._meta?.submission;
        const st = sub?.status || "APPROVED_PUBLIC";
        if (st === "APPROVED_PUBLIC") return true;
        if (st === "APPROVED_PRIVATE"){
          const list = Array.isArray(sub?.visibleToAssociateIds) ? sub.visibleToAssociateIds : [];
          // Lista vazia = trata como público (defensivo · evita imóvel "invisível pra todos")
          if (list.length === 0) return true;
          if (list.includes(myAssociateId)) return true;
        }
        // Corretor vê o que ele mesmo enviou (mesmo pendente/denegado) pra acompanhar
        if (sub?.submittedById && sub.submittedById === myAssociateId) return true;
        return false;
      });
    }
    const total = enriched.length;
    const data  = enriched.slice(skip, skip + take);
    res.json({ data, total });
  } catch (e){ next(e); }
});

// GET /api/properties/by-code/:code · PÚBLICO · usado pelo link de afiliado (LP do imóvel)
// permite que cliente não-autenticado acesse a landing de um imóvel compartilhado pelo corretor.
// IMPORTANTE: declarar ANTES de /:id para Express não confundir o path.
// 2026-05-27 · F2 fix · 3 melhorias cirúrgicas:
//   1. valida submission.status · PENDING/DENIED retornam 404 (não vazam imóvel não-aprovado)
//   2. fs.readdir/stat ASYNC (não bloqueia event loop · era síncrono no caminho da request)
//   3. coverImageUrl auto-derivado do 1º media[] quando _meta.coverImageUrl vazio
r.get("/by-code/:code", async (req, res, next) => {
  try {
    const p = await db.property.findUnique({
      where: { code: req.params.code },
      include: { media: { orderBy: { order: "asc" } } }
    });
    if (!p) return res.status(404).json({ error: "not_found" });

    // 2026-05-27 · Bloqueia LP de imóvel não aprovado · evita vazamento
    const { meta: _checkMeta } = splitMeta(p.features || []);
    const subStatus = _checkMeta?.submission?.status || "APPROVED_PUBLIC";
    if (subStatus === "PENDING" || subStatus === "DENIED"){
      return res.status(404).json({ error: "not_published" });
    }

    // 2026-05-27 · Documentos · async pra não bloquear event loop
    let documents = [];
    try {
      const fsp = await import("node:fs/promises");
      const dir = path.join(DOCUMENTOS_DIR, p.id);
      const names = await fsp.readdir(dir).catch(() => []);
      const items = await Promise.all(
        names.map(async n => {
          try {
            const st = await fsp.stat(path.join(dir, n));
            if (!st.isFile()) return null;
            return { filename: n, url: `/documentos/${p.id}/${n}`, size: st.size, createdAt: st.birthtime };
          } catch { return null; }
        })
      );
      documents = items.filter(Boolean);
    } catch { /* falha ao listar documentos nao deve quebrar a LP · segue com [] */ }

    const enriched = enrichProperty(p);
    // 2026-05-27 · Auto-deriva coverImageUrl quando admin esqueceu de cadastrar
    if (!enriched._meta?.coverImageUrl && Array.isArray(p.media) && p.media.length > 0){
      const firstImage = p.media.find(m => m.mediaType === "image") || p.media[0];
      if (firstImage?.url){
        enriched._meta = { ...(enriched._meta || {}), coverImageUrl: firstImage.url };
      }
    }
    res.json({ ...enriched, documents });
  } catch (e){ next(e); }
});

r.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const p = await db.property.findUnique({ where: { id: req.params.id }, include: { media: { orderBy: { order: "asc" } } } });
    if (!p) return res.status(404).json({ error: "not_found" });
    res.json(enrichProperty(p));
  } catch (e){ next(e); }
});

// Campos estendidos (empreendimento, unidades, preços alternativos, visibilidade na LP).
// Armazenados em features[0] via META_PREFIX até migration de colunas dedicadas.
const submissionSchema = z.object({
  status:           z.enum(["APPROVED_PUBLIC","APPROVED_PRIVATE","PENDING","DENIED"]).optional(),
  submittedById:    z.string().nullable().optional(),
  submittedByName:  z.string().nullable().optional(),
  submittedAt:      z.string().nullable().optional(),
  approvedByUserId: z.string().nullable().optional(),
  approvedAt:       z.string().nullable().optional(),
  visibleToAssociateIds: z.array(z.string()).optional(),
  denialReason:     z.string().nullable().optional()
}).partial();
const ownerSchema = z.object({
  name:  z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  notes: z.string().max(2000).optional()
}).partial();
const metaSchema = z.object({
  empreendimento:  z.string().max(200).optional(),
  units:           z.number().int().nonnegative().optional(),
  priceList:       z.union([z.number(), z.string()]).optional(),
  priceCash:       z.union([z.number(), z.string()]).optional(),
  commissionValue: z.union([z.number(), z.string()]).optional(),
  visibility:      z.record(z.boolean()).optional(),
  submission:      submissionSchema.optional(),
  owner:           ownerSchema.optional(),
  // 2026-05-14 · video do imovel (YouTube/Vimeo URL) + capa custom opcional
  videoUrl:        z.string().max(500).optional().nullable(),
  coverImageUrl:   z.string().max(500).optional().nullable()
}).partial();

const propSchema = z.object({
  code: z.string().min(2),
  title: z.string().min(3),
  neighborhood: z.string().min(2),
  city: z.string().min(2),
  value: z.union([z.number(), z.string()]),
  commission: z.string().default("2,5%"),
  propertyType: z.string().default("Apartamento"),
  area: z.string().optional(),
  bedrooms: z.number().int().optional(),
  suites: z.number().int().optional(),
  garages: z.number().int().optional(),
  description: z.string().optional(),
  features: z.array(z.string()).default([]),
  isSpecial: z.boolean().default(false),
  // Vínculo com empreendimento (nível 1) + campos específicos da unidade
  developmentId: z.string().nullable().optional(),
  unitNumber:    z.string().max(50).nullable().optional(),
  tower:         z.string().max(80).nullable().optional(),
  floor:         z.number().int().nullable().optional(),
  unitType:      z.string().max(60).nullable().optional(),
  priceList:     z.union([z.number(), z.string()]).nullable().optional(),
  priceCash:     z.union([z.number(), z.string()]).nullable().optional(),
  _meta: metaSchema.optional()
});

// 2026-05-15 · ADMIN-only (decisao do Ricardo) · so admin cadastra/edita imoveis.
// Corretor nao envia imovel — admin cadastra e libera pra todos ou pra um especifico.
r.post("/", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const parsed = propSchema.parse(req.body);
    const { _meta, features, ...rest } = parsed;

    // Preenche workflow de submissão · ADMIN auto-aprova · ASSOCIATE fica pendente.
    const meta = { ...(_meta || {}) };
    const isAdmin = req.user.role === "ADMIN";
    let submittedById = null, submittedByName = null;
    if (!isAdmin){
      const assoc = await db.associate.findUnique({
        where: { userId: req.user.id },
        include: { user: { select: { name: true } } }
      });
      submittedById = assoc?.id || null;
      submittedByName = assoc?.user?.name || req.user.name || null;
    }
    meta.submission = {
      status: isAdmin ? "APPROVED_PUBLIC" : "PENDING",
      submittedById,
      submittedByName,
      submittedAt: new Date().toISOString(),
      approvedByUserId: isAdmin ? req.user.id : null,
      approvedAt:       isAdmin ? new Date().toISOString() : null,
      visibleToAssociateIds: [],
      denialReason: null
    };

    const data = { ...rest, features: mergeMeta(features, meta) };
    const p = await db.property.create({ data });
    sendPushToRole("ADMIN", {
      eventKey: "property.created",
      kind: "property_created",
      title: "🏠 Imóvel cadastrado",
      body: `${p.title || p.code || "Novo imóvel"} adicionado ao catálogo`,
      url: `/?screen=adm-imoveis&property=${p.id}`,
      tag: `property-${p.id}`,
    }).catch(()=>{});
    res.status(201).json(enrichProperty(p));
  } catch (e){ next(e); }
});

r.patch("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const body = req.body || {};
    const update = { ...body };
    // Se o cliente enviou _meta ou features, mescla com o que já está no banco.
    if ("_meta" in body || "features" in body){
      const current = await db.property.findUnique({ where: { id: req.params.id }, select: { features: true } });
      const { meta: currentMeta, features: currentFeatures } = splitMeta(current?.features || []);
      const nextMeta = ("_meta" in body) ? { ...(currentMeta || {}), ...(body._meta || {}) } : currentMeta;
      const nextFeatures = ("features" in body) ? body.features : currentFeatures;
      update.features = mergeMeta(nextFeatures, nextMeta);
      delete update._meta;
    }
    const p = await db.property.update({ where: { id: req.params.id }, data: update });
    res.json(enrichProperty(p));
  } catch (e){ next(e); }
});

// POST /api/properties/:id/approval · admin aprova/nega imóvel enviado pelo corretor
// body: { action: "approve_public"|"approve_private"|"deny", reason?: string }
r.post("/:id/approval", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { action, reason } = z.object({
      action: z.enum(["approve_public","approve_private","deny"]),
      reason: z.string().max(1000).optional()
    }).parse(req.body);
    if (action === "deny" && !(reason && reason.trim().length)){
      return res.status(400).json({ error: "reason_required" });
    }
    const current = await db.property.findUnique({ where: { id: req.params.id }, select: { features: true } });
    if (!current) return res.status(404).json({ error: "not_found" });
    const { meta: currentMeta, features: currentFeatures } = splitMeta(current.features || []);
    const submission = { ...(currentMeta?.submission || {}) };
    submission.approvedByUserId = req.user.id;
    submission.approvedAt       = new Date().toISOString();
    submission.denialReason     = null;
    if (action === "approve_public"){
      submission.status = "APPROVED_PUBLIC";
      submission.visibleToAssociateIds = [];
    } else if (action === "approve_private"){
      submission.status = "APPROVED_PRIVATE";
      // Libera apenas para o corretor que enviou.
      submission.visibleToAssociateIds = submission.submittedById ? [submission.submittedById] : [];
    } else if (action === "deny"){
      submission.status = "DENIED";
      submission.denialReason = reason.trim();
    }
    const nextMeta = { ...(currentMeta || {}), submission };
    const p = await db.property.update({
      where: { id: req.params.id },
      data: { features: mergeMeta(currentFeatures, nextMeta) }
    });
    // Push pro corretor que submeteu (se houver e ainda existir).
    if (submission.submittedById){
      const submitter = await db.associate.findUnique({
        where: { id: submission.submittedById },
        select: { userId: true }
      });
      if (submitter?.userId){
        if (action === "deny"){
          sendPushToUser(submitter.userId, {
            eventKey: "property.denied",
            kind: "property_denied",
            title: "❌ Imóvel reprovado",
            body: reason ? `Motivo: ${reason.slice(0, 100)}` : `${p.title || p.code || "Imóvel"} reprovado`,
            url: `/?screen=cors-imoveis&property=${p.id}`,
            tag: `property-${p.id}`,
          }).catch(()=>{});
        } else {
          sendPushToUser(submitter.userId, {
            eventKey: "property.approved",
            kind: "property_approved",
            title: "✅ Imóvel aprovado",
            body: `${p.title || p.code || "Imóvel"} liberado`,
            url: `/?screen=cors-imoveis&property=${p.id}`,
            tag: `property-${p.id}`,
          }).catch(()=>{});
        }
      }
    }
    res.json(enrichProperty(p));
  } catch (e){ next(e); }
});

r.post("/:id/media", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { url, mediaType, order } = z.object({
      url: z.string().url(), mediaType: z.enum(["image","video"]).default("image"), order: z.number().int().default(0)
    }).parse(req.body);
    const m = await db.propertyMedia.create({ data: { propertyId: req.params.id, url, mediaType, order } });
    res.status(201).json(m);
  } catch (e){ next(e); }
});

r.delete("/:propertyId/media/:mediaId", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const media = await db.propertyMedia.findUnique({
      where: { id: req.params.mediaId },
      select: { id: true, url: true, propertyId: true }
    });
    if (!media) return res.status(404).json({ error: "media_not_found" });
    if (media.propertyId !== req.params.propertyId) return res.status(400).json({ error: "media_property_mismatch" });

    if (req.user.role !== "ADMIN"){
      const prop = await db.property.findUnique({ where: { id: media.propertyId }, select: { features: true } });
      const { meta } = splitMeta(prop?.features || []);
      const myAssoc = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      if (!myAssoc?.id || meta?.submission?.submittedById !== myAssoc.id){
        return res.status(403).json({ error: "forbidden" });
      }
    }

    await db.propertyMedia.delete({ where: { id: media.id } });

    try {
      const m = String(media.url || "").match(/^\/midias\/([^\/]+)\/([^\/]+)$/);
      if (m && m[1] === media.propertyId){
        const safeName = path.basename(m[2]);
        const filePath = path.join(MIDIAS_DIR, m[1], safeName);
        if (filePath.startsWith(MIDIAS_DIR) && fs.existsSync(filePath)){
          fs.unlinkSync(filePath);
        }
      }
    } catch (e){
      console.warn("[properties] failed to unlink media file:", e.message);
    }

    res.json({ ok: true });
  } catch (e){ next(e); }
});

// -----------------------------------------------------------------------------
// UPLOAD LOCAL DE ARQUIVOS (Midias/<id>/... e Documentos/<id>/...)
// -----------------------------------------------------------------------------
// POST /api/properties/:id/upload/midia         · fotos/videos (multipart "files")
// POST /api/properties/:id/upload/documento     · docs (multipart "files")
// GET  /api/properties/:id/documentos           · lista arquivos na pasta Documentos/<id>
// GET  /api/properties/:id/midias               · lista arquivos da pasta Midias/<id>
// DELETE /api/properties/:id/documentos/:name   · remove documento específico
// -----------------------------------------------------------------------------
r.post("/:id/upload/:tipo", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  if (!["midia","documento"].includes(req.params.tipo)){
    return res.status(400).json({ error: "invalid_type" });
  }
  // Admin upload livre · corretor só pode upload no imóvel que ele próprio enviou.
  try {
    const exists = await db.property.findUnique({ where: { id: req.params.id }, select: { id: true, features: true } });
    if (!exists) return res.status(404).json({ error: "property_not_found" });
    if (req.user.role !== "ADMIN"){
      const { meta } = splitMeta(exists.features || []);
      const myAssoc = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      if (!myAssoc?.id || meta?.submission?.submittedById !== myAssoc.id){
        return res.status(403).json({ error: "forbidden" });
      }
    }
  } catch (e){ return next(e); }
  diskUpload.array("files", 100)(req, res, async (err) => {
    if (err){
      console.error("[upload-midia] multer err:", err.code, err.field, err.message, "ct=", req.headers["content-type"], "len=", req.headers["content-length"]);
      return res.status(400).json({ error: "upload_failed", message: err.message, code: err.code, field: err.field });
    }
    const files = req.files || [];
    if (!files.length){
      console.error("[upload-midia] no_files · keys=", Object.keys(req.body || {}), "ct=", req.headers["content-type"]);
      return res.status(400).json({ error: "no_files" });
    }
    try {
      // Se for mídia, também cria registros PropertyMedia apontando para URL pública
      const out = [];
      for (const f of files){
        const publicUrl = req.params.tipo === "midia"
          ? `/midias/${req.params.id}/${f.filename}`
          : `/documentos/${req.params.id}/${f.filename}`;
        if (req.params.tipo === "midia"){
          const ext = path.extname(f.originalname || "").toLowerCase();
          const videoExts = [".mp4",".mov",".avi",".mkv",".webm",".m4v"];
          const isVideo = (f.mimetype || "").startsWith("video/") || videoExts.includes(ext);
          const created = await db.propertyMedia.create({
            data: {
              propertyId: req.params.id,
              url: publicUrl,
              mediaType: isVideo ? "video" : "image",
              order: out.length
            }
          });
          out.push({ id: created.id, filename: f.filename, url: publicUrl, mediaType: created.mediaType, size: f.size });
        } else {
          out.push({ filename: f.filename, url: publicUrl, mimetype: f.mimetype, size: f.size });
        }
      }
      res.status(201).json({ uploaded: out.length, files: out });
    } catch (e){ next(e); }
  });
});

r.get("/:id/documentos", requireAuth, async (req, res, next) => {
  try {
    const dir = path.join(DOCUMENTOS_DIR, req.params.id);
    if (!fs.existsSync(dir)) return res.json({ data: [] });
    const files = fs.readdirSync(dir)
      .filter(n => fs.statSync(path.join(dir, n)).isFile())
      .map(n => {
        const st = fs.statSync(path.join(dir, n));
        return { filename: n, url: `/documentos/${req.params.id}/${n}`, size: st.size, createdAt: st.birthtime };
      });
    res.json({ data: files });
  } catch (e){ next(e); }
});

r.get("/:id/midias", requireAuth, async (req, res, next) => {
  try {
    const dir = path.join(MIDIAS_DIR, req.params.id);
    if (!fs.existsSync(dir)) return res.json({ data: [] });
    const files = fs.readdirSync(dir)
      .filter(n => fs.statSync(path.join(dir, n)).isFile())
      .map(n => ({ filename: n, url: `/midias/${req.params.id}/${n}` }));
    res.json({ data: files });
  } catch (e){ next(e); }
});

// DELETE /api/properties/:id · ADMIN-only · exclui imóvel + mídia + arquivos do disco
// Bloqueia se houver visits ou sales linkados (FK RESTRICT) · retorna 409 com counts
// Lead.linkedPropertyId é optional · prisma faz SetNull automaticamente
r.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const id = req.params.id;
    const property = await db.property.findUnique({
      where: { id },
      select: {
        id: true, code: true, title: true,
        _count: { select: { visits: true, sales: true, media: true, leads: true } }
      }
    });
    if (!property) return res.status(404).json({ error: "not_found" });

    if (property._count.visits > 0 || property._count.sales > 0){
      return res.status(409).json({
        error: "has_dependencies",
        message: `Imóvel tem ${property._count.visits} visita(s) e ${property._count.sales} venda(s) vinculada(s) · exclusão bloqueada para preservar histórico`,
        counts: property._count
      });
    }

    // Apaga arquivos físicos (Midias/<id>/* + Documentos/<id>/*) antes do delete do DB
    try {
      for (const baseDir of [MIDIAS_DIR, DOCUMENTOS_DIR]){
        const targetDir = path.join(baseDir, id);
        if (targetDir.startsWith(baseDir) && fs.existsSync(targetDir)){
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
      }
    } catch (e){
      console.warn("[properties] failed to delete disk files:", e.message);
    }

    // PropertyMedia rows cascateiam via Prisma (onDelete: Cascade no relation)
    await db.property.delete({ where: { id } });

    res.json({
      ok: true,
      deleted: { id, code: property.code, title: property.title },
      counts: property._count
    });
  } catch (e){ next(e); }
});

r.delete("/:id/documentos/:name", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const safeName = path.basename(req.params.name);
    const filePath = path.join(DOCUMENTOS_DIR, req.params.id, safeName);
    if (!filePath.startsWith(DOCUMENTOS_DIR)) return res.status(400).json({ error: "invalid_path" });
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e){ next(e); }
});

export default r;
