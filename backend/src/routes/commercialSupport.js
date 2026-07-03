// =============================================================================
// /api/commercial-support · Ajuda Comercial Calebe (2026-06-16)
// Evolui o ConversationAssist (kind="COMMERCIAL"). Corretor pede apoio numa
// conversa; time Calebe autorizado (role ADMIN/DEV + flag commercialSupportAccess)
// gerencia no ADM. Logs via AuditEvent. Tarja verde no chat do corretor quando ATUANDO.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { decrypt } from "../crypto.js";
import { logger } from "../utils/logger.js";

const r = Router();

const ACTIVE = ["SOLICITADO", "EM_ANALISE", "ATUANDO"];
const ALL_STATUS = ["SOLICITADO", "EM_ANALISE", "ATUANDO", "FINALIZADO", "CANCELADO"];

// ---- Middleware: ADM autorizado (role ADMIN/DEV + flag commercialSupportAccess) ----
async function requireCommercialSupport(req, res, next) {
  try {
    if (req.user.role !== "ADMIN" && req.user.role !== "DEV") {
      return res.status(403).json({ error: "forbidden", message: "Acesso restrito ao módulo Ajuda Comercial." });
    }
    // 2026-07-03 · flag commercialSupportAccess removida do gate - TODO admin (e DEV) acessa (Elison).
    next();
  } catch (e) { next(e); }
}

const decryptPhone = (lead) => {
  try { return lead?.phoneEncrypted ? decrypt(lead.phoneEncrypted) : (lead?.phoneMasked || ""); }
  catch { return lead?.phoneMasked || ""; }
};
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";

// =========================== CORRETOR ===========================

// POST /api/commercial-support/request — corretor solicita apoio comercial no lead/conversa
r.post("/request", requireAuth, async (req, res, next) => {
  try {
    const { conversationId, justification } = z.object({
      conversationId: z.string().min(5),
      justification: z.string().max(1000).optional()
    }).parse(req.body);

    const conv = await db.conversation.findUnique({ where: { id: conversationId }, include: { lead: true } });
    if (!conv) return res.status(404).json({ error: "conversation_not_found" });

    // só o dono (ou admin) pode pedir
    if (req.user.role !== "ADMIN") {
      const a = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      if (conv.associateId !== a?.id) return res.status(403).json({ error: "forbidden" });
    }

    // dedup: já existe solicitação ativa para este lead?
    const existing = await db.conversationAssist.findFirst({
      where: { conversationId, kind: "COMMERCIAL", status: { in: ACTIVE } }
    });
    if (existing) {
      return res.status(409).json({ error: "already_active", message: "Este lead já possui uma solicitação de ajuda comercial em andamento." });
    }

    const cs = await db.conversationAssist.create({
      data: {
        conversationId, kind: "COMMERCIAL", requestedById: req.user.id,
        type: "Comercial",
        justification: (justification || "Solicitação de ajuda comercial.").slice(0, 1000),
        status: "SOLICITADO"
      }
    });
    await audit({ req, action: "COMMERCIAL_SUPPORT_REQUESTED", entity: `Conv:${conversationId}`, metadata: { assistId: cs.id, leadId: conv.leadId } });
    logger.info({ assistId: cs.id, convId: conversationId, by: req.user.email }, "🤝 ajuda comercial solicitada");
    res.status(201).json({ id: cs.id, status: cs.status, message: "Solicitação enviada. O time Calebe poderá analisar esta negociação e apoiar você no fechamento." });
  } catch (e) { next(e); }
});

// GET /api/commercial-support/conversation/:convId/active — estado da tarja (pro corretor)
r.get("/conversation/:convId/active", requireAuth, async (req, res, next) => {
  try {
    const cs = await db.conversationAssist.findFirst({
      where: { conversationId: req.params.convId, kind: "COMMERCIAL", status: { in: ACTIVE } },
      orderBy: { createdAt: "desc" },
      select: { status: true }
    });
    res.json({ active: !!cs, status: cs?.status || null, atuando: cs?.status === "ATUANDO" });
  } catch (e) { next(e); }
});

// =========================== ADM (gated) ===========================

// GET /api/commercial-support — lista com filtros
r.get("/", requireAuth, requireCommercialSupport, async (req, res, next) => {
  try {
    const { status, broker, client, phone, assigned, dateFrom, dateTo } = req.query;
    const where = { kind: "COMMERCIAL" };
    if (status && ALL_STATUS.includes(String(status))) where.status = String(status);
    if (assigned) where.assignedCalebeUserId = String(assigned);
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(String(dateFrom));
      if (dateTo) where.createdAt.lte = new Date(String(dateTo) + "T23:59:59");
    }
    const rows = await db.conversationAssist.findMany({
      where, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 500,
      include: {
        conversation: { include: { lead: true, associate: { include: { user: { select: { name: true } } } } } },
        requestedBy: { select: { id: true, name: true, email: true } }
      }
    });
    // nomes dos responsáveis Calebe
    const calebeIds = [...new Set(rows.map(x => x.assignedCalebeUserId).filter(Boolean))];
    const calebeUsers = calebeIds.length ? await db.user.findMany({ where: { id: { in: calebeIds } }, select: { id: true, name: true } }) : [];
    const calebeMap = new Map(calebeUsers.map(u => [u.id, u.name]));

    let data = rows.map(x => {
      const lead = x.conversation?.lead;
      const assoc = x.conversation?.associate;
      return {
        id: x.id, status: x.status, conversationId: x.conversationId, leadId: x.conversation?.leadId,
        clientName: lead?.name || "—", clientPhone: decryptPhone(lead),
        brokerName: assoc?.user?.name || "—", brokerPhone: assoc?.whatsapp || assoc?.phone || "",
        origin: lead?.origin || null,
        requestedAt: x.createdAt, acceptedAt: x.acceptedAt,
        assignedCalebe: x.assignedCalebeUserId ? (calebeMap.get(x.assignedCalebeUserId) || "—") : null,
        requestedBy: x.requestedBy?.name || "—",
        waitingMin: Math.round((Date.now() - new Date(x.createdAt).getTime()) / 60000)
      };
    });
    // filtros client-side (nome/telefone) — base pequena
    if (broker) data = data.filter(d => d.brokerName.toLowerCase().includes(String(broker).toLowerCase()));
    if (client) data = data.filter(d => d.clientName.toLowerCase().includes(String(client).toLowerCase()));
    if (phone) { const q = String(phone).replace(/\D/g, ""); data = data.filter(d => (d.clientPhone + d.brokerPhone).replace(/\D/g, "").includes(q)); }

    // contadores por status (pro kanban/cards)
    const counts = {}; for (const s of ALL_STATUS) counts[s] = 0;
    for (const d of data) counts[d.status] = (counts[d.status] || 0) + 1;
    res.json({ data, counts, total: data.length });
  } catch (e) { next(e); }
});

// GET /api/commercial-support/:id — detalhe (sem mensagens; conversa vem do endpoint de conversas)
r.get("/:id", requireAuth, requireCommercialSupport, async (req, res, next) => {
  try {
    const x = await db.conversationAssist.findFirst({
      where: { id: req.params.id, kind: "COMMERCIAL" },
      include: {
        conversation: { include: { lead: true, associate: { include: { user: { select: { id: true, name: true } } } } } },
        requestedBy: { select: { id: true, name: true, email: true } },
        notes: { orderBy: { createdAt: "desc" } }
      }
    });
    if (!x) return res.status(404).json({ error: "not_found" });
    const lead = x.conversation?.lead; const assoc = x.conversation?.associate;
    // resolve nomes dos autores de notas + responsável
    const userIds = [...new Set([x.assignedCalebeUserId, ...x.notes.map(n => n.userId)].filter(Boolean))];
    const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const uMap = new Map(users.map(u => [u.id, u.name]));
    // logs (AuditEvent)
    const logs = await db.auditEvent.findMany({
      where: { metadata: { path: ["assistId"], equals: x.id } },
      orderBy: { createdAt: "asc" }, take: 100,
      select: { action: true, actorEmail: true, createdAt: true }
    }).catch(() => []);

    await audit({ req, action: "COMMERCIAL_SUPPORT_VIEWED", entity: `Conv:${x.conversationId}`, metadata: { assistId: x.id } });
    res.json({
      id: x.id, status: x.status, conversationId: x.conversationId, leadId: x.conversation?.leadId,
      clientName: lead?.name || "—", clientPhone: decryptPhone(lead),
      brokerName: assoc?.user?.name || "—", brokerPhone: assoc?.whatsapp || assoc?.phone || "",
      origin: lead?.origin || null, justification: x.justification,
      requestedBy: x.requestedBy?.name || "—",
      requestedAt: x.createdAt, inAnalysisAt: x.inAnalysisAt, acceptedAt: x.acceptedAt, finishedAt: x.resolvedAt,
      assignedCalebeUserId: x.assignedCalebeUserId,
      assignedCalebe: x.assignedCalebeUserId ? (uMap.get(x.assignedCalebeUserId) || "—") : null,
      notes: x.notes.map(n => ({ id: n.id, note: n.note, author: uMap.get(n.userId) || "—", createdAt: n.createdAt })),
      logs
    });
  } catch (e) { next(e); }
});

// transição de status genérica
function transition({ to, action, stamp }) {
  return async (req, res, next) => {
    try {
      const x = await db.conversationAssist.findFirst({ where: { id: req.params.id, kind: "COMMERCIAL" } });
      if (!x) return res.status(404).json({ error: "not_found" });
      const data = { status: to };
      if (stamp === "accept") { data.assignedCalebeUserId = req.user.id; data.assistantUserId = req.user.id; data.acceptedAt = new Date(); }
      if (stamp === "in-analysis" && !x.inAnalysisAt) data.inAnalysisAt = new Date();
      if (to === "FINALIZADO") { data.resolvedAt = new Date(); data.resolvedById = req.user.id; }
      await db.conversationAssist.update({ where: { id: x.id }, data });
      await audit({ req, action, entity: `Conv:${x.conversationId}`, metadata: { assistId: x.id } });
      res.json({ ok: true, status: to });
    } catch (e) { next(e); }
  };
}
r.patch("/:id/in-analysis", requireAuth, requireCommercialSupport, transition({ to: "EM_ANALISE", action: "COMMERCIAL_SUPPORT_IN_ANALYSIS", stamp: "in-analysis" }));
r.patch("/:id/accept", requireAuth, requireCommercialSupport, transition({ to: "ATUANDO", action: "COMMERCIAL_SUPPORT_ACCEPTED", stamp: "accept" }));
r.patch("/:id/finish", requireAuth, requireCommercialSupport, transition({ to: "FINALIZADO", action: "COMMERCIAL_SUPPORT_FINISHED" }));
r.patch("/:id/cancel", requireAuth, requireCommercialSupport, transition({ to: "CANCELADO", action: "COMMERCIAL_SUPPORT_CANCELED" }));

// log de ação leve (cliente abriu whatsapp etc.) — opcional, não-bloqueante
r.post("/:id/log", requireAuth, requireCommercialSupport, async (req, res, next) => {
  try {
    const action = String(req.body?.action || "").slice(0, 48) || "COMMERCIAL_SUPPORT_ACTION";
    const x = await db.conversationAssist.findFirst({ where: { id: req.params.id, kind: "COMMERCIAL" }, select: { conversationId: true } });
    if (!x) return res.status(404).json({ error: "not_found" });
    await audit({ req, action, entity: `Conv:${x.conversationId}`, metadata: { assistId: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// notas internas
r.post("/:id/notes", requireAuth, requireCommercialSupport, async (req, res, next) => {
  try {
    const { note } = z.object({ note: z.string().min(1).max(2000) }).parse(req.body);
    const x = await db.conversationAssist.findFirst({ where: { id: req.params.id, kind: "COMMERCIAL" }, select: { id: true, conversationId: true } });
    if (!x) return res.status(404).json({ error: "not_found" });
    const n = await db.conversationAssistNote.create({ data: { assistId: x.id, userId: req.user.id, note } });
    await audit({ req, action: "COMMERCIAL_SUPPORT_NOTE_ADDED", entity: `Conv:${x.conversationId}`, metadata: { assistId: x.id } });
    res.status(201).json({ id: n.id, note: n.note, author: req.user.name, createdAt: n.createdAt });
  } catch (e) { next(e); }
});
r.get("/:id/notes", requireAuth, requireCommercialSupport, async (req, res, next) => {
  try {
    const notes = await db.conversationAssistNote.findMany({ where: { assistId: req.params.id }, orderBy: { createdAt: "desc" } });
    const ids = [...new Set(notes.map(n => n.userId))];
    const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const uMap = new Map(users.map(u => [u.id, u.name]));
    res.json({ data: notes.map(n => ({ id: n.id, note: n.note, author: uMap.get(n.userId) || "—", createdAt: n.createdAt })) });
  } catch (e) { next(e); }
});

export default r;
