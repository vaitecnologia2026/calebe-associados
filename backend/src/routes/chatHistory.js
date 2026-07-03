// =============================================================================
// /api/chat-history · histórico de conversas (banco dedicado :5433/chat)
// =============================================================================
import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { chatListConversations, chatListMessages, chatPool } from "../chatDb.js";

const r = Router();

r.get("/health", requireAuth, async (_req, res) => {
  if (!chatPool) return res.status(503).json({ ok: false, error: "chat_db_disabled" });
  try {
    await chatPool.query("SELECT 1");
    res.json({ ok: true });
  } catch (e){ res.status(503).json({ ok: false, error: e.message }); }
});

// GET /api/chat-history · lista conversas (admin vê todas; outros só as suas)
r.get("/", requireAuth, async (req, res, next) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const rows = await chatListConversations({
      userId: req.user.id,
      role:   req.user.role,
      limit, offset
    });
    res.json({ data: rows, limit, offset });
  } catch (e){ next(e); }
});

// GET /api/chat-history/:conversationId · mensagens completas da conversa
r.get("/:conversationId", requireAuth, async (req, res, next) => {
  try {
    const rows = await chatListMessages({
      conversationId: req.params.conversationId,
      limit:  Math.min(Number(req.query.limit) || 200, 1000),
      offset: Number(req.query.offset) || 0
    });
    res.json({ data: rows });
  } catch (e){ next(e); }
});

export default r;
