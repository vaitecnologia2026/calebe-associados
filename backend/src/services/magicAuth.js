// =============================================================================
// services/magicAuth.js · Magic link de primeiro acesso pro corretor associado
//
// Fluxo:
//   1. Admin aprova ou pede reenvio → generateMagicToken(userId)
//      - Gera token único urlsafe 32 chars
//      - Salva sha256(token) em User.magicTokenHash, expira em 7d
//   2. Sistema envia WhatsApp via Cloud API com template `calebe_acesso_aprovado`
//      - URL button leva pra https://app.calebe.tech/primeiro-acesso?token=<token>
//   3. Corretor abre o link → frontend valida com GET /api/auth/magic/:token
//   4. Corretor cria senha → POST /api/auth/magic/redeem → login automático
// =============================================================================
import { randomBytes, createHash } from "node:crypto";
import { db } from "../db.js";
import { logger } from "../utils/logger.js";
import { sendTemplate, isEnabled as isWaCloudEnabled } from "./whatsappCloud.js";
import { normalizePhone } from "../crypto.js";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const TEMPLATE_NAME = "calebe_acesso_aprovado";
const TEMPLATE_LANG = "pt_BR";
const APP_URL = process.env.APP_PUBLIC_URL || "https://app.calebe.tech";

/** Gera token urlsafe (~32 chars) sem ambiguidades. */
function _genUrlSafeToken(bytes = 24){
  return randomBytes(bytes).toString("base64url");
}

/** Hash usado pra armazenar (nunca guardar token em claro). */
function _hash(token){
  return createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Cria um magic link novo pro usuário. Sobrescreve qualquer token anterior
 * desse user (apenas um magic ativo por vez).
 * @returns {Promise<{token: string, expiresAt: Date}>}
 */
export async function createMagicToken(userId){
  const token = _genUrlSafeToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await db.user.update({
    where: { id: userId },
    data: {
      magicTokenHash: _hash(token),
      magicExpiresAt: expiresAt,
      magicUsedAt: null,
      magicSentAt: new Date()
    }
  });
  return { token, expiresAt };
}

/** Valida e retorna o User pra um token (ou null/erro). */
export async function findUserByMagicToken(token){
  if (!token || typeof token !== "string") return { error: "missing_token", status: 400 };
  const h = _hash(token);
  const user = await db.user.findFirst({
    where: { magicTokenHash: h },
    select: { id:true, email:true, name:true, role:true, active:true, magicExpiresAt:true, magicUsedAt:true }
  });
  if (!user) return { error: "invalid_token", status: 404 };
  if (!user.active) return { error: "user_inactive", status: 409 };
  if (user.magicUsedAt) return { error: "token_already_used", status: 410 };
  if (!user.magicExpiresAt || user.magicExpiresAt < new Date()){
    return { error: "token_expired", status: 410 };
  }
  return { user };
}

/** Marca token como usado e atualiza senha. Devolve user.id. */
export async function consumeMagicToken({ token, newPasswordHash }){
  const r = await findUserByMagicToken(token);
  if (r.error) return r;
  await db.user.update({
    where: { id: r.user.id },
    data: {
      passwordHash: newPasswordHash,
      magicUsedAt: new Date(),
      lastLoginAt: new Date()
    }
  });
  return { userId: r.user.id, email: r.user.email, role: r.user.role, name: r.user.name };
}

/**
 * Envia o magic link via WhatsApp Cloud API (template calebe_acesso_aprovado).
 * @returns {Promise<{ok: true, messageId, to} | {ok: false, error, status, body?}>}
 */
export async function sendMagicLinkWhatsApp(user, associate){
  if (!isWaCloudEnabled()){
    return { ok: false, error: "whatsapp_cloud_disabled" };
  }

  const rawPhone = associate?.whatsapp || associate?.phone;
  if (!rawPhone){
    return { ok: false, error: "no_phone", status: 422 };
  }
  const to = normalizePhone(rawPhone);
  if (!to || to.length < 10){
    return { ok: false, error: "phone_invalid", status: 422 };
  }

  // Gera token + persiste
  const { token } = await createMagicToken(user.id);

  // Primeiro nome pra deixar pessoal
  const firstName = (user.name || "Corretor").split(" ")[0];

  const r = await sendTemplate({
    to,
    templateName: TEMPLATE_NAME,
    languageCode: TEMPLATE_LANG,
    bodyParams: [firstName],
    urlButtonParams: [{ index: 0, value: token }]
  });

  if (r.ok){
    logger.info({ userId: user.id, email: user.email, to, messageId: r.messageId }, "🔐 magic_link · enviado");
    return { ok: true, messageId: r.messageId, to };
  }
  logger.warn({ userId: user.id, email: user.email, to, err: r.error, code: r.code, status: r.status }, "❌ magic_link · falha");
  return { ok: false, error: r.error, status: r.status, body: r.body, code: r.code };
}

/** Verifica preview do link gerado (utilitário, não pra prod). */
export function buildPrimeiroAcessoUrl(token){
  return `${APP_URL}/primeiro-acesso?token=${encodeURIComponent(token)}`;
}
