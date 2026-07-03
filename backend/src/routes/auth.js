// =============================================================================
// /api/auth · login, refresh, logout, me, forgot-password
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, refreshCookieOptions, refreshCookieClearOptions } from "../auth/jwt.js";
import { requireAuth } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { logger } from "../utils/logger.js";
import { sendMagicLinkWhatsApp } from "../services/magicAuth.js";
import { dropLeadsOnLogin } from "../services/loginLeadDrop.js";

const r = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4)
});

// POST /api/auth/login
r.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email } });
    if (!user || !user.active) return res.status(401).json({ error: "invalid_credentials" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid_credentials" });

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    // Atualiza lastActive do associate (se aplicável)
    let associate = null;
    if (user.role === "ASSOCIATE"){
      await db.associate.updateMany({ where: { userId: user.id }, data: { lastActiveAt: new Date() } });
      associate = await db.associate.findUnique({ where: { userId: user.id }, select: { id: true } });
      // 2026-06-03 · Drop automático de 30 leads no 1º login do dia (background).
      if (associate?.id) dropLeadsOnLogin(associate.id).catch(() => {});
    }

    const accessToken = signAccessToken(user);
    const { token: refreshToken } = await issueRefreshToken({ userId: user.id, req });
    res.cookie("rt", refreshToken, refreshCookieOptions());
    await audit({ userId: user.id, req, action: "LOGIN", entity: `User:${user.id}` });

    // 2026-06-25 · refreshToken devolvido também no body como fallback pra
    // ambientes onde o cookie httpOnly é dropado (Safari ITP, WKWebView, PWA
    // standalone reaberta após 7d+). Frontend guarda em localStorage e manda
    // no body de /refresh se o cookie sumir.
    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role, name: user.name, commercialSupportAccess: user.commercialSupportAccess, commercialOnly: user.commercialOnly, ...(associate ? { associate: { id: associate.id } } : {}) }
    });
  } catch (e){ next(e); }
});

// POST /api/auth/refresh
// 2026-06-25 · Aceita refresh token tanto via cookie httpOnly `rt` quanto via
// body { refreshToken } como fallback. Frontend tenta o cookie primeiro
// (sempre via credentials:include); se o cookie foi dropado pelo navegador
// (Safari ITP, WKWebView, modo privado), o body cobre. Resposta inclui o NOVO
// refreshToken no body — front atualiza o localStorage pra manter rotação.
r.post("/refresh", async (req, res, next) => {
  try {
    const token = req.cookies?.rt || req.body?.refreshToken || null;
    if (!token) return res.status(401).json({ error: "no_refresh" });
    const r2 = await rotateRefreshToken({ oldToken: token, req });
    if (!r2.ok) {
      res.clearCookie("rt", refreshCookieClearOptions());
      return res.status(401).json({ error: "invalid_refresh", reason: r2.reason });
    }
    const user = await db.user.findUnique({ where: { id: r2.userId } });
    if (!user || !user.active) return res.status(401).json({ error: "user_inactive" });
    let associate = null;
    if (user.role === "ASSOCIATE"){
      associate = await db.associate.findUnique({ where: { userId: user.id }, select: { id: true } });
      // 2026-06-03 · Cobre quem já tem sessão e abre o app (refresh) · 1x/dia garantido pelo claim.
      if (associate?.id) dropLeadsOnLogin(associate.id).catch(() => {});
    }
    const accessToken = signAccessToken(user);
    res.cookie("rt", r2.token, refreshCookieOptions());
    res.json({
      accessToken,
      refreshToken: r2.token,
      user: { id: user.id, email: user.email, role: user.role, name: user.name, commercialSupportAccess: user.commercialSupportAccess, commercialOnly: user.commercialOnly, ...(associate ? { associate: { id: associate.id } } : {}) }
    });
  } catch (e){ next(e); }
});

// POST /api/auth/logout
// 2026-06-25 · Aceita refresh token via cookie OU body (mesmo motivo do /refresh).
r.post("/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.rt || req.body?.refreshToken || null;
    if (token) await revokeRefreshToken(token);
    res.clearCookie("rt", refreshCookieClearOptions());
    if (req.user) await audit({ req, action: "LOGOUT", entity: `User:${req.user.id}` });
    res.json({ ok: true });
  } catch (e){ next(e); }
});

// POST /api/auth/change-password
// Usuario logado (qualquer role) troca a propria senha. Valida senha atual antes
// de aplicar. Salt rounds = 12 (padrao do projeto, ver associates.js approve).
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128)
});
r.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    if (currentPassword === newPassword){
      return res.status(400).json({ error: "same_password" });
    }
    const user = await db.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.active) return res.status(401).json({ error: "user_inactive" });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid_current_password" });
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.user.update({ where: { id: user.id }, data: { passwordHash } });
    await audit({ userId: user.id, req, action: "PASSWORD_CHANGED", entity: `User:${user.id}` });
    res.json({ ok: true });
  } catch (e){ next(e); }
});

// POST /api/auth/forgot-password
// Recupera acesso via magic link no WhatsApp (Cloud API · template
// `calebe_acesso_aprovado`). Mensagem genérica é retornada em todos os casos
// (usuário existe ou não, ativo ou não, com ou sem telefone) para evitar
// account enumeration attacks.
//
// 2026-05-19 · Migrado de senha-temporária-via-VAI pra magic-link-via-Cloud-API.
// Motivo: 11 corretores ficaram travados em maio (8 tentativas o mais grave)
// porque o VAI entregava inconsistente. Magic link no Cloud API é o mesmo
// caminho que funciona pra primeiro-acesso e pro cron de nudge.
const forgotPasswordSchema = z.object({ email: z.string().email() });
r.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const genericMsg = "Se o e-mail estiver cadastrado, enviaremos um link de acesso pelo WhatsApp em alguns instantes.";

    const user = await db.user.findUnique({
      where: { email },
      include: { associate: { select: { id: true, phone: true, whatsapp: true } } }
    });

    if (!user || !user.active){
      logger.info({ email, reason: !user ? "user_not_found" : "user_inactive" }, "forgot_password · ignorado");
      return res.json({ ok: true, message: genericMsg });
    }

    const phone = user.associate?.whatsapp || user.associate?.phone || null;
    if (!phone){
      logger.warn({ email, userId: user.id }, "forgot_password · usuario sem telefone WhatsApp");
      await audit({ userId: user.id, req, action: "PASSWORD_RESET_REQUESTED_NO_PHONE", entity: `User:${user.id}` });
      return res.json({ ok: true, message: genericMsg });
    }

    await audit({ userId: user.id, req, action: "PASSWORD_RESET_BY_FORGOT", entity: `User:${user.id}` });

    // Best-effort fire-and-forget: não bloqueia a resposta.
    sendMagicLinkWhatsApp(user, user.associate).then(r => {
      if (r.ok){
        logger.info({ email, userId: user.id, messageId: r.messageId }, "🔐 forgot_password · magic link enviado");
      } else {
        logger.warn({ email, userId: user.id, err: r.error, code: r.code, status: r.status }, "forgot_password · magic link falhou");
      }
    }).catch(err => {
      logger.warn({ email, err: err?.message }, "forgot_password · envio magic link lançou exceção");
    });

    res.json({ ok: true, message: genericMsg });
  } catch (e){ next(e); }
});

// 2026-05-11 · POST /api/auth/heartbeat · cliente envia a cada 2min enquanto a
// aba tá aberta. Marca User.lastSeenAt = NOW(). Painel admin /corretores usa
// pra mostrar bolinha verde "online agora" (threshold 5min).
r.post("/heartbeat", requireAuth, async (req, res, next) => {
  try {
    await db.user.update({ where: { id: req.user.id }, data: { lastSeenAt: new Date() } });
    res.json({ ok: true, t: new Date().toISOString() });
  } catch (e){ next(e); }
});

// GET /api/auth/me
r.get("/me", requireAuth, async (req, res, next) => {
  try {
    const u = await db.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, role: true, name: true, lastLoginAt: true, commercialSupportAccess: true, commercialOnly: true,
        associate: { select: { id: true, category: true, segment: true, creci: true, creciUf: true, phone: true, whatsapp: true, bio: true, photoUrl: true, phoneAlertActive: true, cpf: true, rg: true, address: true, bankData: true, pixKey: true } }
      }
    });
    res.json(u);
  } catch (e){ next(e); }
});

export default r;
