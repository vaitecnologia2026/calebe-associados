// =============================================================================
// /api/campaigns · Central de Campanhas (bolsão de leads + disparo WhatsApp)
// 2026-07-01 · Fase 1: pool + funil + criar/rodar campanha + resultado ao vivo.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { encrypt, normalizePhone } from "../crypto.js";
import { listTemplates, getPhoneNumbersQuality } from "../services/whatsappCloud.js";
import { runCampaign } from "../services/campaignRunner.js";

const r = Router();
const HEALTH_PATH = new URL("../../data/healthy_phones.json", import.meta.url).pathname;

const SUPPORT_IDS = new Set(["1143966188797246", "1155522184305211"]);
function allNumbers(){
  try {
    const j = JSON.parse(readFileSync(HEALTH_PATH, "utf8"));
    return (j.all || []).map(n => ({ id: n.id, number: n.number, quality: n.quality, msgs24h: n.msgs24h ?? 0 }));
  } catch { return []; }
}

// Critério do bolsão · fica num só lugar (usado no funil e no snapshot).
// Exclui negociação/fechamento e leads em atendimento ATIVO (aceito + msg recente).
const POOL_WHERE = `
  l."discardedAt" IS NULL
  AND l.status NOT IN ('NEGOTIATING','CLOSING','CLOSED')
  AND NOT (COALESCE(c.accepted,false) AND c."lastMessageAt" > now() - interval '2 days')
`;

// ---------- Funil do bolsão -------------------------------------------------
r.get("/pool", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const rows = await db.$queryRawUnsafe(`
      WITH base AS (
        SELECT l.id, l.status, l."assignedToId", l."firstContactAt", l."noWhatsApp", l."discardedAt",
               c."lastInboundAt", c."lastMessageAt", c.accepted
        FROM "Lead" l
        LEFT JOIN LATERAL (
          SELECT * FROM "Conversation" x WHERE x."leadId"=l.id ORDER BY x."lastMessageAt" DESC NULLS LAST LIMIT 1
        ) c ON true
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE COALESCE("noWhatsApp",false)=false)::int AS com_whatsapp,
        COUNT(*) FILTER (WHERE "firstContactAt" IS NOT NULL)::int AS abordados,
        COUNT(*) FILTER (WHERE "lastInboundAt" IS NOT NULL)::int AS responderam,
        COUNT(*) FILTER (WHERE status IN ('QUALIFYING','NEGOTIATING','CLOSING','CLOSED'))::int AS em_atendimento,
        COUNT(*) FILTER (WHERE status IN ('NEGOTIATING','CLOSING','CLOSED'))::int AS em_negociacao,
        COUNT(*) FILTER (WHERE status='CLOSED')::int AS ganho,
        COUNT(*) FILTER (WHERE "discardedAt" IS NULL AND status NOT IN ('NEGOTIATING','CLOSING','CLOSED')
          AND NOT (COALESCE(accepted,false) AND "lastMessageAt" > now()-interval '2 days'))::int AS disponivel,
        COUNT(*) FILTER (WHERE "assignedToId" IS NULL AND status='NEW' AND COALESCE("noWhatsApp",false)=false)::int AS bolsao_livre,
        COUNT(*) FILTER (WHERE "firstContactAt" IS NULL AND COALESCE("noWhatsApp",false)=false)::int AS nao_abordado,
        COUNT(*) FILTER (WHERE "noWhatsApp"=true)::int AS sem_whatsapp
      FROM base
    `);
    const p = rows[0] || {};
    p.funnel = [
      { key: "total",          label: "Bolsão · base total", value: p.total },
      { key: "com_whatsapp",   label: "Com WhatsApp",         value: p.com_whatsapp },
      { key: "abordados",      label: "Abordados",            value: p.abordados },
      { key: "responderam",    label: "Responderam",          value: p.responderam },
      { key: "em_atendimento", label: "Em atendimento",       value: p.em_atendimento },
      { key: "em_negociacao",  label: "Em negociação",        value: p.em_negociacao },
      { key: "ganho",          label: "Ganho · fechado",      value: p.ganho }
    ];
    res.json(p);
  } catch (e){ next(e); }
});

// ---------- Overview · funil AGREGADO das campanhas (zerado até haver disparo) ----
r.get("/overview", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const agg = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS campanhas,
        COALESCE(SUM("statSent"),0)::int AS disparado,
        COALESCE(SUM("statResponded"),0)::int AS respondeu,
        COALESCE(SUM("statFailed"),0)::int AS falhas,
        COALESCE(SUM("statNoWhatsapp"),0)::int AS sem_whatsapp
      FROM "Campaign"
    `);
    const funil = await db.$queryRawUnsafe(`
      SELECT
        COUNT(*) FILTER (WHERE l.status IN ('QUALIFYING','NEGOTIATING','CLOSING','CLOSED'))::int AS em_atendimento,
        COUNT(*) FILTER (WHERE l.status IN ('NEGOTIATING','CLOSING','CLOSED'))::int AS em_negociacao,
        COUNT(*) FILTER (WHERE l.status='CLOSED')::int AS ganho
      FROM "CampaignRecipient" cr JOIN "Lead" l ON l.id=cr."leadId"
      WHERE cr.status IN ('sent','responded')
    `);
    const a = agg[0] || {}, f = funil[0] || {};
    res.json({
      campanhas: a.campanhas || 0, disparado: a.disparado || 0, respondeu: a.respondeu || 0,
      falhas: a.falhas || 0, sem_whatsapp: a.sem_whatsapp || 0,
      em_atendimento: f.em_atendimento || 0, em_negociacao: f.em_negociacao || 0, ganho: f.ganho || 0,
      funnel: [
        { key: "disparado",      label: "Disparados",      value: a.disparado || 0 },
        { key: "respondeu",      label: "Responderam",     value: a.respondeu || 0 },
        { key: "em_atendimento", label: "Em atendimento",  value: f.em_atendimento || 0 },
        { key: "em_negociacao",  label: "Em negociação",   value: f.em_negociacao || 0 },
        { key: "ganho",          label: "Vendas (ganho)",  value: f.ganho || 0 }
      ]
    });
  } catch (e){ next(e); }
});

// ---------- Opções do formulário (números GREEN + templates) ----------------
r.get("/options", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const tpls = await listTemplates({ status: "APPROVED" }).catch(() => []);
    const templates = tpls.map(t => ({
      name: t.name,
      vars: (String((t.components || []).find(c => c.type === "BODY")?.text || "").match(/\{\{\d+\}\}/g) || []).length
    }));
    const meta = await getPhoneNumbersQuality().catch(() => ({}));
    const numbers = allNumbers()
      .filter(n => !SUPPORT_IDS.has(n.id))
      .map(n => ({ ...n, quality: meta[n.id]?.quality || n.quality || "UNKNOWN" }))
      .sort((a, b) => (a.quality === "GREEN" ? -1 : b.quality === "GREEN" ? 1 : 0));
    res.json({ numbers, templates });
  } catch (e){ next(e); }
});

// ---------- Criar campanha (snapshot dos alvos no bolsão) --------------------
const createSchema = z.object({
  name: z.string().min(1).max(120),
  phoneNumberIds: z.array(z.string()).default([]),
  templateName: z.string().min(1),
  languageCode: z.string().default("pt_BR"),
  targetCount: z.number().int().min(1).max(5000),
  intervalMs: z.number().int().min(1000).max(300000).default(8000),
  onlyNotContacted: z.boolean().default(true)
});
r.post("/", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const camp = await db.campaign.create({ data: { ...input, createdById: req.user.id } });

    const notContacted = input.onlyNotContacted ? `AND l."firstContactAt" IS NULL` : ``;
    const targets = await db.$queryRawUnsafe(`
      SELECT l.id FROM "Lead" l
      LEFT JOIN LATERAL (
        SELECT * FROM "Conversation" x WHERE x."leadId"=l.id ORDER BY x."lastMessageAt" DESC NULLS LAST LIMIT 1
      ) c ON true
      WHERE ${POOL_WHERE}
        AND COALESCE(l."noWhatsApp",false)=false
        AND l."phoneEncrypted" IS NOT NULL
        ${notContacted}
      ORDER BY l."createdAt" DESC
      LIMIT $1
    `, input.targetCount);

    if (targets.length){
      await db.campaignRecipient.createMany({ data: targets.map(t => ({ campaignId: camp.id, leadId: t.id })) });
    }
    await audit({ req, action: "CAMPAIGN_CREATED", entity: `Campaign:${camp.id}`, metadata: { name: camp.name, alvos: targets.length, template: camp.templateName } });
    res.json({ ...camp, recipients: targets.length });
  } catch (e){ next(e); }
});

// ---------- Start / Pause ----------------------------------------------------
r.post("/:id/start", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const camp = await db.campaign.findUnique({ where: { id: req.params.id } });
    if (!camp) return res.status(404).json({ error: "not_found" });
    if (camp.status === "done") return res.status(409).json({ error: "campanha_concluida" });
    await db.campaign.update({ where: { id: camp.id }, data: { status: "running", startedAt: camp.startedAt ?? new Date() } });
    runCampaign(camp.id); // fire-and-forget neste worker
    await audit({ req, action: "CAMPAIGN_STARTED", entity: `Campaign:${camp.id}` });
    res.json({ ok: true, status: "running" });
  } catch (e){ next(e); }
});
r.post("/:id/pause", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    await db.campaign.update({ where: { id: req.params.id }, data: { status: "paused" } });
    await audit({ req, action: "CAMPAIGN_PAUSED", entity: `Campaign:${req.params.id}` });
    res.json({ ok: true, status: "paused" });
  } catch (e){ next(e); }
});

// ---------- Listar + detalhe (stats ao vivo) --------------------------------
r.get("/", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const camps = await db.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    res.json({ data: camps });
  } catch (e){ next(e); }
});
r.get("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const camp = await db.campaign.findUnique({ where: { id: req.params.id } });
    if (!camp) return res.status(404).json({ error: "not_found" });
    const grp = await db.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: camp.id }, _count: true });
    const buckets = {}; grp.forEach(g => { buckets[g.status] = g._count; });
    res.json({ ...camp, buckets });
  } catch (e){ next(e); }
});

// ---------- Clientes que responderam ao disparo (+ corretor + conversa) -----
r.get("/:id/responses", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const recs = await db.$queryRawUnsafe(`
      SELECT cr."leadId", cr."respondedAt", cr."roletaStatus" AS "roletaStatus", cr."roletaAttempts" AS "roletaAttempts", l.name AS lead_name, u.name AS corretor,
        (SELECT c.id FROM "Conversation" c WHERE c."leadId"=l.id ORDER BY c."lastMessageAt" DESC NULLS LAST LIMIT 1) AS conv_id
      FROM "CampaignRecipient" cr
      JOIN "Lead" l ON l.id=cr."leadId"
      LEFT JOIN "Associate" a ON a.id=l."assignedToId"
      LEFT JOIN "User" u ON u.id=a."userId"
      WHERE cr."campaignId"=$1 AND cr.status='responded'
      ORDER BY cr."respondedAt" DESC NULLS LAST LIMIT 200
    `, req.params.id);
    res.json({ data: recs });
  } catch (e){ next(e); }
});

// ---------- Importar leads novos → bolsão -----------------------------------
const importSchema = z.object({
  leads: z.array(z.object({ name: z.string().min(1).max(120), phone: z.string().min(8).max(20) })).min(1).max(2000)
});
r.post("/import", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { leads } = importSchema.parse(req.body);
    let created = 0, invalidos = 0;
    for (const l of leads){
      const phone = normalizePhone(l.phone);
      if (!phone){ invalidos++; continue; }
      try {
        await db.lead.create({ data: { name: l.name.trim(), phoneEncrypted: encrypt(phone), status: "NEW", origin: "MANUAL" } });
        created++;
      } catch { invalidos++; }
    }
    await audit({ req, action: "CAMPAIGN_IMPORT", metadata: { created, invalidos } });
    res.json({ created, invalidos });
  } catch (e){ next(e); }
});

export default r;
