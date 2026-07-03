// routes/push.js — endpoints REST de Web Push.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { getVapidPublicKey, isPushConfigured, sendPushToUser } from "../services/push.js";
import { isFcmConfigured } from "../services/fcmPush.js";
import { vaiFindOrCreateContact, vaiEnsureChatForContact, vaiSendChatMessage } from "../services/vaiClient.js";

const r = Router();

// =============================================================================
// FCM (push nativo Capacitor iOS/Android) — registro de token
// =============================================================================
const fcmRegisterSchema = z.object({
  token: z.string().min(40),
  platform: z.enum(["ios", "android"]).default("ios"),
});

r.post("/register-fcm", requireAuth, async (req, res, next) => {
  try {
    const parsed = fcmRegisterSchema.safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: "invalid_payload", issues: parsed.error.issues });
    const { token, platform } = parsed.data;
    const ua = (req.headers["user-agent"] || "").slice(0, 500);

    // Token e unico por instalacao. Reassocia ao ultimo user que logou.
    await db.fcmToken.upsert({
      where: { token },
      create: { userId: req.user.id, token, platform, userAgent: ua },
      update: { userId: req.user.id, platform, userAgent: ua, lastSeenAt: new Date() },
    });

    res.json({ ok: true });
  } catch (e) { next(e); }
});

r.post("/unregister-fcm", requireAuth, async (req, res, next) => {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token : null;
    if (token) await db.fcmToken.deleteMany({ where: { token, userId: req.user.id } });
    else await db.fcmToken.deleteMany({ where: { userId: req.user.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Público — client precisa antes de subscribe.
r.get("/vapid-public-key", (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(503).json({ error: "push_not_configured" });
  res.json({ publicKey: key });
});

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  platform: z.string().max(40).optional()
});

r.post("/subscribe", requireAuth, async (req, res, next) => {
  try {
    if (!isPushConfigured()) return res.status(503).json({ error: "push_not_configured" });
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: "invalid_payload", issues: parsed.error.issues });

    const ua = (req.headers["user-agent"] || "").slice(0, 500);
    const { endpoint, keys, platform } = parsed.data;

    await db.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: req.user.id,
        endpoint,
        p256dh: keys.p256dh,
        authKey: keys.auth,
        userAgent: ua,
        platform: platform || null
      },
      update: {
        userId: req.user.id,
        p256dh: keys.p256dh,
        authKey: keys.auth,
        userAgent: ua,
        platform: platform || null,
        lastSeenAt: new Date()
      }
    });

    res.json({ ok: true });
  } catch (e) { next(e); }
});

const unsubSchema = z.object({ endpoint: z.string().url() });
r.post("/unsubscribe", requireAuth, async (req, res, next) => {
  try {
    const parsed = unsubSchema.safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: "invalid_payload" });
    await db.pushSubscription.deleteMany({
      where: { endpoint: parsed.data.endpoint, userId: req.user.id }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

r.get("/devices", requireAuth, async (req, res, next) => {
  try {
    const data = await db.pushSubscription.findMany({
      where: { userId: req.user.id },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, endpoint: true, userAgent: true, platform: true, lastSeenAt: true, createdAt: true }
    });
    res.json({ data });
  } catch (e) { next(e); }
});

r.delete("/devices/:id", requireAuth, async (req, res, next) => {
  try {
    await db.pushSubscription.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

r.post("/test", requireAuth, async (req, res, next) => {
  try {
    const result = await sendPushToUser(req.user.id, {
      kind: "generic",
      title: "🔔 Notificações ativadas",
      body: "Tudo certo — você vai receber alertas de leads novos e respostas.",
      url: "/?screen=adm-notificacoes",
      tag: "calebe-test",
      requireInteraction: false
    });
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});


// =============================================================================
// ADMIN — diagnostico e teste de push nativo (FCM)
// =============================================================================

// Estado completo sem disparar push (web + nativo).
r.get("/admin/diag/:userId", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { userId } = req.params;
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true } });
    const webSubs = await db.pushSubscription.findMany({ where: { userId }, select: { id: true, platform: true, lastSeenAt: true } });
    const fcmTokens = await db.fcmToken.findMany({ where: { userId }, select: { id: true, platform: true, lastSeenAt: true, token: true } });
    res.json({
      user,
      web: { count: webSubs.length, platforms: [...new Set(webSubs.map(s => s.platform).filter(Boolean))] },
      fcm: {
        tokensCount: fcmTokens.length,
        tokens: fcmTokens.map(t => ({
          id: t.id, platform: t.platform, lastSeenAt: t.lastSeenAt,
          tokenPreview: t.token.slice(0, 16) + "..." + t.token.slice(-8),
        })),
      },
      firebase: { configured: isFcmConfigured() },
    });
  } catch (e) { next(e); }
});

// Dispara push real (web + nativo) pra um user, sem evento de negocio.
r.post("/admin/test-push/:userId", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { userId } = req.params;
    const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    if (!u) return res.status(404).json({ error: "user_not_found" });
    const result = await sendPushToUser(userId, {
      kind: "generic",
      title: String(req.body?.title || "🔔 Teste de push (Admin)"),
      body: String(req.body?.body || "Se chegou, o pipeline de notificacoes esta OK."),
      url: "/?screen=cors-notificacoes",
      tag: "calebe-fcm-test",
      requireInteraction: false,
    });
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// =============================================================================
// ADMIN — cobertura de notificações dos corretores
// =============================================================================
r.get("/admin/coverage", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const associates = await db.associate.findMany({
      where: { status: "APPROVED" },
      orderBy: [{ category: "desc" }],
      select: {
        id: true,
        category: true,
        phone: true,
        whatsapp: true,
        user: {
          select: {
            id: true, name: true, email: true, active: true,
            pushSubscriptions: {
              select: { id: true, platform: true, lastSeenAt: true },
              orderBy: { lastSeenAt: "desc" }
            }
          }
        }
      }
    });
    const data = associates
      .filter(a => a.user)
      .map(a => ({
        associateId: a.id,
        userId: a.user.id,
        name: a.user.name,
        email: a.user.email,
        active: a.user.active,
        category: a.category,
        phone: a.phone || a.whatsapp || null,
        deviceCount: a.user.pushSubscriptions.length,
        lastSeenAt: a.user.pushSubscriptions[0]?.lastSeenAt || null,
        platforms: [...new Set(a.user.pushSubscriptions.map(p => p.platform).filter(Boolean))]
      }))
      .sort((x, y) => {
        // Pendentes primeiro, depois ordenado por nome
        if ((x.deviceCount === 0) !== (y.deviceCount === 0)) return x.deviceCount === 0 ? -1 : 1;
        return x.name.localeCompare(y.name, "pt-BR");
      });
    res.json({ data });
  } catch (e) { next(e); }
});

// Admin dispara um push de TESTE pra um corretor específico (sem afetar leads reais)
r.post("/admin/test/:userId", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { userId } = req.params;
    const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    if (!u) return res.status(404).json({ error: "user_not_found" });
    const subs = await db.pushSubscription.count({ where: { userId } });
    if (subs === 0) return res.status(409).json({ error: "no_subscription" });
    const result = await sendPushToUser(userId, {
      kind: "generic",
      title: "🔔 Push de teste (Admin)",
      body: `Olá ${(u.name || "").split(" ")[0]}, este é um teste enviado pelo admin pra confirmar que as notificações estão chegando.`,
      url: "/?screen=cors-notificacoes",
      tag: "calebe-admin-test",
      requireInteraction: false
    });
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

r.post("/admin/send-tutorial/:userId", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { userId } = req.params;
    const u = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, role: true,
        associate: { select: { phone: true, whatsapp: true } }
      }
    });
    if (!u) return res.status(404).json({ error: "user_not_found" });
    if (u.role !== "ASSOCIATE") return res.status(400).json({ error: "not_associate" });
    const phone = u.associate?.phone || u.associate?.whatsapp;
    if (!phone) return res.status(400).json({ error: "no_phone_registered" });

    const url = process.env.APP_PUBLIC_URL || "https://app.calebe.tech";
    const firstName = String(u.name || "").trim().split(/\s+/)[0] || "";
    const text =
`Olá, ${firstName}! 👋

Você é Associado Calebe e queremos garantir que você não perca nenhum lead novo.

*Como ativar notificações no celular:*

1️⃣ Abra ${url} no Chrome (Android) ou Safari (iPhone)
2️⃣ Faça login com: ${u.email}
3️⃣ Quando aparecer o aviso "Instalar Calebe", toque em *Instalar*
   (No iPhone: Compartilhar → "Adicionar à Tela de Início")
4️⃣ Abra o app pelo ícone que apareceu na tela inicial
5️⃣ No menu, toque em *Notificações*
6️⃣ Toque em *Ativar* e aceite a permissão do sistema

Pronto! ✅ Você vai receber alertas de leads novos e respostas mesmo com o app fechado.

Qualquer dúvida, é só responder esta mensagem.`;

    try {
      const contact = await vaiFindOrCreateContact({ name: u.name, phone, email: u.email });
      if (!contact?.id) throw new Error("contact_no_id");
      const chat = await vaiEnsureChatForContact(contact.id);
      const chatId = chat?.id;
      if (!chatId) throw new Error("chat_no_id");
      const sent = await vaiSendChatMessage(chatId, { content: text, type: "text" });
      return res.json({ ok: true, contactId: contact.id, chatId, messageId: sent?.id });
    } catch (e) {
      return res.status(502).json({ error: "vai_send_failed", message: e.message });
    }
  } catch (e) { next(e); }
});

export default r;
