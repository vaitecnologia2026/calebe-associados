// =============================================================================
// /api/phone-release · corretor solicita liberação · admin aprova/nega
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { sseToUser, sseToAdmins } from "../services/sseHub.js";
import { sendPushToUser } from "../services/push.js";
import { decrypt } from "../crypto.js";

const r = Router();

// POST /api/phone-release · corretor solicita
const createSchema = z.object({
  conversationId: z.string().cuid(),
  justification:  z.string().min(5).max(1000)
});
r.post("/", requireAuth, requireRole("ASSOCIATE","ADMIN"), async (req, res, next) => {
  try {
    const { conversationId, justification } = createSchema.parse(req.body);
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true, associate: { select: { userId: true } } }
    });
    if (!conv) return res.status(404).json({ error: "conversation_not_found" });

    // Corretor só pode solicitar na sua própria conversa
    if (req.user.role === "ASSOCIATE" && conv.associate?.userId !== req.user.id){
      return res.status(403).json({ error: "forbidden" });
    }
    // Se já está liberado ou tem solicitação pendente, bloqueia
    if (conv.phoneReleased){
      return res.status(409).json({ error: "already_released" });
    }
    const pending = await db.phoneReleaseRequest.findFirst({
      where: { conversationId, status: "PENDING" }
    });
    if (pending) return res.status(409).json({ error: "already_pending", id: pending.id });

    const pr = await db.phoneReleaseRequest.create({
      data: {
        conversationId,
        leadId: conv.leadId,
        requestedById: req.user.id,
        justification,
        status: "PENDING"
      }
    });
    await audit({ req, action: "PHONE_RELEASE_REQUESTED", entity: `Conv:${conversationId}`, metadata: { requestId: pr.id } });

    // PUSH em tempo real · admins veem a solicitação na fila
    sseToAdmins("phone_release.created", {
      id: pr.id, conversationId, leadId: conv.leadId,
      leadName: conv.lead.name, justification,
      requestedBy: req.user.name, requestedById: req.user.id, at: pr.createdAt
    });

    res.status(201).json({ id: pr.id, status: pr.status });
  } catch (e){ next(e); }
});

// GET /api/phone-release · admin vê tudo · corretor vê suas
r.get("/", requireAuth, async (req, res, next) => {
  try {
    const where = req.user.role === "ADMIN" ? {} : { requestedById: req.user.id };
    if (req.query.status) where.status = req.query.status;
    const rows = await db.phoneReleaseRequest.findMany({
      where, orderBy: { createdAt: "desc" }, take: 100
    });
    // Enriquece com lead name + corretor name (em lote)
    const leadIds = [...new Set(rows.map(r => r.leadId))];
    const userIds = [...new Set(rows.map(r => r.requestedById))];
    const [leads, users] = await Promise.all([
      db.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true, phoneMasked: true, phoneEncrypted: true } }),
      db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    ]);
    const isAdmin = req.user.role === "ADMIN";
    const leadsById = Object.fromEntries(leads.map(l => {
      const phone = isAdmin && l.phoneEncrypted ? decrypt(l.phoneEncrypted) : undefined;
      return [l.id, { id: l.id, name: l.name, phoneMasked: l.phoneMasked, ...(phone ? { phone } : {}) }];
    }));
    const usersById = Object.fromEntries(users.map(u => [u.id, u]));
    const data = rows.map(r => ({
      ...r,
      lead: leadsById[r.leadId] || null,
      requestedBy: usersById[r.requestedById] || null
    }));
    res.json({ data, total: data.length });
  } catch (e){ next(e); }
});

// POST /api/phone-release/:id/approve
const decideSchema = z.object({ note: z.string().max(500).optional() });
r.post("/:id/approve", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { note } = decideSchema.parse(req.body || {});
    const pr = await db.phoneReleaseRequest.findUnique({ where: { id: req.params.id } });
    if (!pr) return res.status(404).json({ error: "not_found" });
    if (pr.status !== "PENDING") return res.status(409).json({ error: "already_decided", status: pr.status });

    const [updated] = await db.$transaction([
      db.phoneReleaseRequest.update({
        where: { id: pr.id },
        data: { status: "APPROVED", decidedById: req.user.id, decisionNote: note || null, decidedAt: new Date() }
      }),
      db.conversation.update({ where: { id: pr.conversationId }, data: { phoneReleased: true } })
    ]);
    await audit({ req, action: "PHONE_RELEASE_APPROVED", entity: `Conv:${pr.conversationId}`, metadata: { requestId: pr.id } });

    // PUSH · notifica corretor
    sseToUser(pr.requestedById, "phone_release.approved", {
      id: pr.id, conversationId: pr.conversationId, at: updated.decidedAt
    });
    sseToAdmins("phone_release.resolved", { id: pr.id, status: "APPROVED" });
    sendPushToUser(pr.requestedById, {
      eventKey: "phone_release.approved",
      kind: "phone_release_approved",
      title: "📞 Telefone liberado",
      body: "Admin liberou o telefone do lead",
      url: `/?screen=cors-leads&conv=${pr.conversationId}`,
      tag: `phone-${pr.id}`,
    }).catch(()=>{});

    res.json({ id: pr.id, status: "APPROVED" });
  } catch (e){ next(e); }
});

// POST /api/phone-release/:id/deny
r.post("/:id/deny", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { note } = decideSchema.parse(req.body || {});
    const pr = await db.phoneReleaseRequest.findUnique({ where: { id: req.params.id } });
    if (!pr) return res.status(404).json({ error: "not_found" });
    if (pr.status !== "PENDING") return res.status(409).json({ error: "already_decided", status: pr.status });

    const updated = await db.phoneReleaseRequest.update({
      where: { id: pr.id },
      data: { status: "DENIED", decidedById: req.user.id, decisionNote: note || null, decidedAt: new Date() }
    });
    await audit({ req, action: "PHONE_RELEASE_DENIED", entity: `Conv:${pr.conversationId}`, metadata: { requestId: pr.id, note } });

    sseToUser(pr.requestedById, "phone_release.denied", {
      id: pr.id, conversationId: pr.conversationId, note, at: updated.decidedAt
    });
    sseToAdmins("phone_release.resolved", { id: pr.id, status: "DENIED" });
    sendPushToUser(pr.requestedById, {
      eventKey: "phone_release.denied",
      kind: "phone_release_denied",
      title: "📞 Liberação negada",
      body: note ? `Motivo: ${note.slice(0, 100)}` : "Admin negou a liberação do telefone",
      url: `/?screen=cors-leads&conv=${pr.conversationId}`,
      tag: `phone-${pr.id}`,
    }).catch(()=>{});

    res.json({ id: pr.id, status: "DENIED" });
  } catch (e){ next(e); }
});

export default r;
