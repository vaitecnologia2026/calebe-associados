// =============================================================================
// JWT · access token curto + refresh token com rotação
// =============================================================================
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { db } from "../db.js";
import { sha256Hex } from "../crypto.js";

// 2026-07-02 · fail-fast: sem segredo real (>=16 chars) o BOOT falha. Antes, o
// fallback "dev_access"/"dev_refresh" gerava tokens forjaveis silenciosamente
// se o .env estivesse incompleto (qualquer um poderia mintar token admin).
for (const _k of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]){
  const _v = process.env[_k];
  if (!_v || _v.length < 16){
    throw new Error(`FATAL: ${_k} ausente ou muito curto no .env (min. 16 chars) — boot abortado por seguranca`);
  }
}
const ACCESS_SECRET  = () => process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET;
// 2026-06-08 · 15m → 8h porque corretores reclamavam de relogin.
// 2026-06-25 · 8h → 7d. Mesmo com refresh, casos como Safari ITP, PWA fechada >
// 7 dias sem interação, etc. tiravam o cookie httpOnly e caíam no relogin.
// 7d cobre uma semana inteira de uso sem nem precisar do refresh.
// Refresh continua 30d como rede de segurança final.
const ACCESS_EXPIRES  = process.env.JWT_ACCESS_EXPIRES_IN  || "7d";
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || "30d";

export function signAccessToken(user){
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    ACCESS_SECRET(),
    { expiresIn: ACCESS_EXPIRES, issuer: "calebe-crm", audience: "calebe-app" }
  );
}

export function verifyAccessToken(token){
  return jwt.verify(token, ACCESS_SECRET(), { issuer: "calebe-crm", audience: "calebe-app" });
}

// Refresh token: valor aleatório de 48 bytes (base64url) · NUNCA guardamos o token em claro.
// O DB guarda só o sha256 + family (para detectar reuso de token revogado).
export function generateRefreshToken(){
  return randomBytes(48).toString("base64url");
}

export async function issueRefreshToken({ userId, family, req }){
  const token = generateRefreshToken();
  const expiresAt = new Date(Date.now() + parseDuration(REFRESH_EXPIRES));
  await db.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      family: family || randomBytes(16).toString("hex"),
      expiresAt,
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"]?.slice(0, 512)
    }
  });
  return { token, expiresAt };
}

export async function rotateRefreshToken({ oldToken, req }){
  const hash = sha256Hex(oldToken);
  const existing = await db.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (!existing) {
    // Possível reuso/roubo · revoga family inteira por segurança
    return { ok: false, reason: "token_unknown" };
  }
  if (existing.revoked || existing.expiresAt < new Date()){
    // Reuso detectado · revoga toda a family
    await db.refreshToken.updateMany({ where: { family: existing.family }, data: { revoked: true } });
    return { ok: false, reason: "token_revoked_or_expired" };
  }
  // Revoga o token antigo · emite um novo na mesma family
  await db.refreshToken.update({ where: { id: existing.id }, data: { revoked: true } });
  const novo = await issueRefreshToken({ userId: existing.userId, family: existing.family, req });
  return { ok: true, userId: existing.userId, ...novo };
}

export async function revokeRefreshToken(token){
  if (!token) return;
  const hash = sha256Hex(token);
  await db.refreshToken.updateMany({
    where: { tokenHash: hash, revoked: false },
    data:  { revoked: true }
  });
}

export async function revokeAllUserTokens(userId){
  await db.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } });
}

// parse "15m" → 900_000 (ms)
function parseDuration(str){
  const m = /^(\d+)([smhd])$/.exec(str);
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  return { s: n*1000, m: n*60*1000, h: n*3600*1000, d: n*86400*1000 }[m[2]];
}

// Config cookie — httpOnly · Secure em produção · SameSite Lax
// 2026-06-04 · Era `strict` em prod. Corretores reportaram que ao sair do app
// (trocar pra WhatsApp/voltar pro Calebe) eram deslogados. Safari iOS PWA não
// envia cookies `SameSite=Strict` em navegação top-level (voltar de outro app
// conta como top-level), então o POST /api/auth/refresh chegava sem o `rt` →
// refresh 401 → clearAuth → relogin. `Lax` mantém proteção CSRF (cookie não
// vai em sub-requests cross-site) mas permite top-level navigation legítima.
export function refreshCookieOptions(){
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: parseDuration(REFRESH_EXPIRES)
  };
}
// 2026-05-13 · Express 5 reclama de maxAge em clearCookie · separa as opcoes.
// Why: warning ruido em log + futuro breaking change.
export function refreshCookieClearOptions(){
  const { maxAge, ...rest } = refreshCookieOptions();
  return rest;
}
