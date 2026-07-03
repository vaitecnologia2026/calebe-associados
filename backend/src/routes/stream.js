// =============================================================================
// /api/stream · SSE para push real-time (inbound/outbound msgs, novos leads).
// Auth: Authorization Bearer OU ?access_token= (EventSource não manda headers).
// =============================================================================
import { Router } from "express";
import { verifyAccessToken } from "../auth/jwt.js";
import { sseSubscribe, sseStats } from "../services/sseHub.js";

const r = Router();

r.get("/", (req, res) => {
  const header = req.headers.authorization || "";
  const tokenFromHeader = header.startsWith("Bearer ") ? header.slice(7) : null;
  const tokenFromQuery  = req.query.access_token || req.query.token;
  const token = tokenFromHeader || tokenFromQuery;
  if (!token) return res.status(401).json({ error: "unauthenticated" });
  let payload;
  try { payload = verifyAccessToken(String(token)); }
  catch (e){ return res.status(401).json({ error: "invalid_token", reason: e.message }); }
  const user = { id: payload.sub, email: payload.email, role: payload.role, name: payload.name };
  sseSubscribe(res, user);
});

r.get("/stats", (_req, res) => res.json(sseStats()));

export default r;
