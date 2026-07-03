// =============================================================================
// Middlewares de autenticação e autorização.
// =============================================================================
import { verifyAccessToken } from "./jwt.js";

export function requireAuth(req, res, next){
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "unauthenticated" });
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role, name: payload.name };
    next();
  } catch (e) {
    return res.status(401).json({ error: "invalid_token", reason: e.message });
  }
}

// Uso: requireRole("ADMIN")  ·  requireRole("ADMIN", "LEGAL")
export function requireRole(...roles){
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "unauthenticated" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "forbidden", need: roles });
    next();
  };
}

// Garante que o usuário é o dono OU é admin (para endpoints como /leads/my)
export function requireSelfOrAdmin(getUserIdFromReq){
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "unauthenticated" });
    if (req.user.role === "ADMIN") return next();
    const target = getUserIdFromReq(req);
    if (target === req.user.id) return next();
    return res.status(403).json({ error: "forbidden" });
  };
}
