// =============================================================================
// /api/assists · F1 Éder · janela exclusiva pro corretor de suporte interno
//
// Fluxo:
//   1. Corretor parceiro pede ajuda em uma conversa específica:
//      POST /api/conversations/:id/request-assist  (montado em conversations.js)
//      → cria ConversationAssist apontando pro corretor com isInternalSupport=true
//      → SSE assist.requested · push · notification
//
//   2. Suporte (Éder) lista pedidos:
//      GET /api/assists                   · pendentes dele
//      GET /api/assists?status=RESOLVED   · histórico
//      GET /api/assists?status=ALL        · tudo
//
//   3. Suporte abre conversa assistida:
//      GET /api/conversations  (em conversations.js) inclui assistidas
//      GET /api/conversations/:id/messages valida assist ativo como permissão
//
//   4. Suporte marca como resolvido:
//      PATCH /api/assists/:id/resolve  { note? }
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { logger } from "../utils/logger.js";
import { sseToUser, sseToAdmins } from "../services/sseHub.js";
import { sendPushToUser } from "../services/push.js";

const r = Router();

const ASSIST_TYPES = ["Avaliação", "Negociação", "Apoio", "Outro"];

// ----- Helper · resolve corretor de suporte ativo ---------------------------
// Estratégia atual: pega o primeiro Associate com isInternalSupport=true,
// status=APPROVED e user.active. Round-robin entre N suportes pode entrar depois.
export async function pickInternalSupport(){
  return db.associate.findFirst({
    where: {
      isInternalSupport: true,
      status: "APPROVED",
      user: { is: { active: true } }
    },
    include: { user: { select: { id: true, name: true, email: true } } }
  });
}

// ----- POST /api/conversations/:id/request-assist ---------------------------
// Não montado aqui · ver wireRequestAssist abaixo (chamado pelo conversations.js).
export function wireRequestAssist(router){
  const requestSchema = z.object({
    type: z.enum(ASSIST_TYPES),
    justification: z.string().min(5).max(2000)
  });

  router.post("/:id/request-assist", requireAuth, requireRole("ASSOCIATE","ADMIN"), async (req, res, next) => {
    try {
      const body = requestSchema.parse(req.body || {});
      const conv = await db.conversation.findUnique({
        where: { id: req.params.id },
        include: {
          lead: { select: { id: true, name: true, segment: true, phoneMasked: true } },
          associate: { include: { user: { select: { id: true, name: true } } } }
        }
      });
      if (!conv) return res.status(404).json({ error: "conversation_not_found" });

      // Permissão · ADMIN pode pedir em qualquer conv; ASSOCIATE só na própria
      if (req.user.role !== "ADMIN"){
        const mine = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
        if (conv.associateId !== mine?.id) return res.status(403).json({ error: "forbidden" });
      }

      // Bloqueia se o próprio user é o suporte interno (não faz sentido pedir pra si mesmo)
      const myAssoc = await db.associate.findUnique({ where: { userId: req.user.id }, select: { isInternalSupport: true } });
      if (myAssoc?.isInternalSupport){
        return res.status(400).json({ error: "self_request_blocked", message: "Suporte interno não pede ajuda a si mesmo." });
      }

      // Resolve quem vai assistir
      const support = await pickInternalSupport();
      if (!support){
        return res.status(503).json({ error: "no_support_available", message: "Nenhum corretor de suporte disponível no momento." });
      }

      // Dedup · se já existe pedido PENDING pra essa conv e esse assistant, retorna ele
      const existing = await db.conversationAssist.findFirst({
        where: { conversationId: conv.id, status: "PENDING", assistantUserId: support.user.id }
      });
      if (existing){
        return res.status(200).json({
          id: existing.id,
          assistantName: support.user.name,
          alreadyExists: true,
          message: "Já existe um pedido de ajuda em aberto pra essa conversa."
        });
      }

      const assist = await db.conversationAssist.create({
        data: {
          conversationId: conv.id,
          assistantUserId: support.user.id,
          requestedById: req.user.id,
          type: body.type,
          justification: body.justification,
          status: "PENDING"
        }
      });

      await audit({
        req,
        action: "ASSIST_REQUESTED",
        entity: `ConversationAssist:${assist.id}`,
        metadata: {
          conversationId: conv.id,
          leadId: conv.leadId,
          type: body.type,
          assistantUserId: support.user.id
        }
      });

      // SSE · suporte vê na hora
      try {
        sseToUser(support.user.id, "assist.requested", {
          assistId: assist.id,
          conversationId: conv.id,
          leadId: conv.leadId,
          leadName: conv.lead.name,
          requestedByName: req.user.name,
          type: body.type,
          justification: body.justification,
          at: new Date().toISOString()
        });
        sseToAdmins("assist.requested", {
          assistId: assist.id,
          conversationId: conv.id,
          requestedByName: req.user.name,
          assistantName: support.user.name,
          type: body.type
        });
      } catch {}

      // Notificação persistida · suporte vê na sino mesmo se offline
      db.notification.create({
        data: {
          userId: support.user.id,
          type: "assist_request",
          title: `${req.user.name} pediu sua ajuda`,
          body: `${body.type} · ${conv.lead.name}`,
          link: `/?screen=cors-leads&assist=${assist.id}&conv=${conv.id}`
        }
      }).catch(() => {});

      // Web Push best-effort
      sendPushToUser(support.user.id, {
        eventKey: "assist.requested",
        kind: "assist_request",
        title: `🆘 ${req.user.name} pediu ajuda`,
        body: `${body.type} · ${conv.lead.name}`,
        url: `/?screen=cors-leads&assist=${assist.id}&conv=${conv.id}`,
        tag: `assist-${assist.id}`,
        requireInteraction: true
      }).catch((e) => logger.warn({ err: e.message, assistId: assist.id }, "push assist_request falhou"));

      logger.info({
        assistId: assist.id, convId: conv.id, leadId: conv.leadId,
        from: req.user.email, to: support.user.email, type: body.type
      }, "🆘 ASSIST · pedido criado");

      res.status(201).json({
        id: assist.id,
        assistantName: support.user.name,
        assistantUserId: support.user.id,
        type: body.type,
        status: assist.status,
        createdAt: assist.createdAt
      });
    } catch (e){ next(e); }
  });
}

// ----- GET /api/assists -----------------------------------------------------
// Lista pedidos onde o usuário logado é o suporte (assistant) OU foi o
// solicitante. ADMIN vê todos.
//   ?status=PENDING | RESOLVED | ALL  (default: PENDING)
//   ?as=mine_to_handle | mine_requested  (filtro de papel)
r.get("/", requireAuth, async (req, res, next) => {
  try {
    const statusQ = String(req.query.status || "PENDING").toUpperCase();
    const asQ    = String(req.query.as || "mine_to_handle").toLowerCase();

    const where = {};
    if (statusQ !== "ALL"){
      where.status = statusQ;
    }
    if (req.user.role !== "ADMIN"){
      if (asQ === "mine_requested"){
        where.requestedById = req.user.id;
      } else {
        where.assistantUserId = req.user.id;
      }
    }

    const data = await db.conversationAssist.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        conversation: {
          include: {
            lead: { select: { id: true, name: true, phoneMasked: true, segment: true, status: true, city: true } },
            associate: { include: { user: { select: { id: true, name: true, email: true } } } }
          }
        },
        requestedBy: { select: { id: true, name: true, email: true } },
        assistant:   { select: { id: true, name: true, email: true } }
      }
    });
    res.json({ data, total: data.length });
  } catch (e){ next(e); }
});

// ----- GET /api/assists/:id -------------------------------------------------
r.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const assist = await db.conversationAssist.findUnique({
      where: { id: req.params.id },
      include: {
        conversation: {
          include: {
            lead: true,
            associate: { include: { user: { select: { id: true, name: true, email: true } } } }
          }
        },
        requestedBy: { select: { id: true, name: true, email: true } },
        assistant:   { select: { id: true, name: true, email: true } }
      }
    });
    if (!assist) return res.status(404).json({ error: "not_found" });

    // Permissão · ADMIN, assistant ou requester podem ver
    const allowed = req.user.role === "ADMIN"
      || assist.assistantUserId === req.user.id
      || assist.requestedById   === req.user.id;
    if (!allowed) return res.status(403).json({ error: "forbidden" });

    res.json(assist);
  } catch (e){ next(e); }
});

// ----- PATCH /api/assists/:id/resolve ---------------------------------------
const resolveSchema = z.object({
  note: z.string().max(2000).optional()
});
r.patch("/:id/resolve", requireAuth, async (req, res, next) => {
  try {
    const body = resolveSchema.parse(req.body || {});
    const assist = await db.conversationAssist.findUnique({ where: { id: req.params.id } });
    if (!assist) return res.status(404).json({ error: "not_found" });

    // Quem pode resolver: ADMIN, o próprio assistente, ou o solicitante
    const allowed = req.user.role === "ADMIN"
      || assist.assistantUserId === req.user.id
      || assist.requestedById   === req.user.id;
    if (!allowed) return res.status(403).json({ error: "forbidden" });

    if (assist.status === "RESOLVED"){
      return res.status(200).json({ id: assist.id, status: "RESOLVED", already: true });
    }

    const updated = await db.conversationAssist.update({
      where: { id: assist.id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedById: req.user.id,
        resolutionNote: body.note || null
      }
    });

    await audit({
      req,
      action: "ASSIST_RESOLVED",
      entity: `ConversationAssist:${assist.id}`,
      metadata: { conversationId: assist.conversationId, note: body.note || null }
    });

    // SSE pra ambos lados
    try {
      sseToUser(assist.requestedById,   "assist.resolved", { assistId: assist.id, conversationId: assist.conversationId, by: req.user.name });
      sseToUser(assist.assistantUserId, "assist.resolved", { assistId: assist.id, conversationId: assist.conversationId, by: req.user.name });
      sseToAdmins("assist.resolved", { assistId: assist.id, conversationId: assist.conversationId });
    } catch {}

    res.json({ id: updated.id, status: updated.status, resolvedAt: updated.resolvedAt });
  } catch (e){ next(e); }
});

// ----- PATCH /api/assists/:id/cancel ----------------------------------------
// Solicitante pode cancelar um pedido (e.g. já resolveu sozinho).
r.patch("/:id/cancel", requireAuth, async (req, res, next) => {
  try {
    const assist = await db.conversationAssist.findUnique({ where: { id: req.params.id } });
    if (!assist) return res.status(404).json({ error: "not_found" });

    const allowed = req.user.role === "ADMIN" || assist.requestedById === req.user.id;
    if (!allowed) return res.status(403).json({ error: "forbidden" });

    if (assist.status !== "PENDING"){
      return res.status(409).json({ error: "not_pending", currentStatus: assist.status });
    }

    const updated = await db.conversationAssist.update({
      where: { id: assist.id },
      data: { status: "CANCELLED", resolvedAt: new Date(), resolvedById: req.user.id }
    });

    await audit({
      req,
      action: "ASSIST_CANCELLED",
      entity: `ConversationAssist:${assist.id}`,
      metadata: { conversationId: assist.conversationId }
    });

    try {
      sseToUser(assist.assistantUserId, "assist.cancelled", { assistId: assist.id, conversationId: assist.conversationId });
      sseToAdmins("assist.cancelled", { assistId: assist.id, conversationId: assist.conversationId });
    } catch {}

    res.json({ id: updated.id, status: updated.status });
  } catch (e){ next(e); }
});

// ----- Helpers exportados pra uso em conversations.js ------------------------

/**
 * Retorna IDs (Conversation.id) onde o user logado é assistant ATIVO.
 * Usado em GET /api/conversations pra incluir conversas assistidas na listagem.
 */
export async function getActiveAssistConvIdsForUser(userId){
  const rows = await db.conversationAssist.findMany({
    where: { assistantUserId: userId, status: "PENDING" },
    select: { conversationId: true }
  });
  return rows.map(r => r.conversationId);
}

/**
 * Verifica se o user pode VER (read) uma conversa via assist ativo.
 * Retorna o registro ConversationAssist ou null.
 */
export async function findActiveAssistForUser({ conversationId, userId }){
  return db.conversationAssist.findFirst({
    where: { conversationId, assistantUserId: userId, status: "PENDING" }
  });
}

export default r;
