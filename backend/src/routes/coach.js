// =============================================================================
// /api/coach · proxy pra IA Coach (calebe.tech)
//
// Frontend de vaidavenda (public/index.html) chama essas rotas; backend faz
// proxy autenticado pra app-calebe via INTERNAL_API_KEY. Mantem isolamento.
// =============================================================================
import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { logger } from "../utils/logger.js";

const r = Router();

const COACH_BASE = process.env.COACH_BASE_URL || "https://calebe.tech";
const INTERNAL_KEY = process.env.COACH_API_KEY || "2b2b90d281590888dca18d1655b4bdc809e4c6ee8c33c0ea048a5ce33e98860a";

/**
 * GET /api/coach/suggestions?convId=<id>
 * Retorna sugestoes pendentes pra conversa corretor (Conversation.id em vaidavenda).
 */
r.get("/suggestions", requireAuth, async (req, res, next) => {
  try {
    const convId = String(req.query.convId || "").trim();
    if (!convId) return res.status(400).json({ error: "convId required" });
    const chave = `corretor:${convId}`;
    const url = `${COACH_BASE}/api/coach/suggestions?conversa_chave=${encodeURIComponent(chave)}`;
    const upstream = await fetch(url, { headers: { "x-api-key": INTERNAL_KEY } });
    const data = await upstream.json().catch(() => []);
    res.status(upstream.status).json(data);
  } catch (e) {
    logger.warn({ err: e.message }, "coach proxy GET falhou");
    next(e);
  }
});

/**
 * PATCH /api/coach/suggestions/:id
 * Body: { action: "use" | "dismiss" }
 */
r.patch("/suggestions/:id", requireAuth, async (req, res, next) => {
  try {
    const url = `${COACH_BASE}/api/coach/suggestions/${encodeURIComponent(req.params.id)}`;
    const upstream = await fetch(url, {
      method: "PATCH",
      headers: { "x-api-key": INTERNAL_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {})
    });
    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (e) {
    logger.warn({ err: e.message }, "coach proxy PATCH falhou");
    next(e);
  }
});

export default r;
