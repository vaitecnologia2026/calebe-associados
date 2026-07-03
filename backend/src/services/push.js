// services/push.js — Web Push (VAPID) helper.
// Envia notificações para todas as subscriptions de um usuário (ou role).
// Auto-limpa subscriptions com endpoint 404/410 (Gone).

import webpush from "web-push";
import { db } from "../db.js";
import { sendFcmToUser } from "./fcmPush.js";
import { isPushEventActive } from "./pushSettingsCache.js";

let configured = false;

function readVapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:contato@calebe.com.br";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

function ensureConfigured() {
  const env = readVapid();
  if (!env) return null;
  if (!configured) {
    webpush.setVapidDetails(env.subject, env.publicKey, env.privateKey);
    configured = true;
  }
  return env;
}

export function isPushConfigured() {
  return readVapid() !== null;
}

export function getVapidPublicKey() {
  return readVapid()?.publicKey ?? null;
}

/**
 * Envia push pra todos os devices do user. Best-effort: nunca lança.
 * @param {string} userId
 * @param {object} payload — { title, body, url?, kind?, tag?, leadId?, conversationId?, requireInteraction? }
 * @returns {Promise<{sent:number, removed:number}>}
 */
export async function sendPushToUser(userId, payload) {
  // 2026-06-22 · Guard por evento (PushNotificationSetting).
  // payload.eventKey vazio = sem guard (comportamento legacy preservado).
  // payload.eventKey definido + isActive=false no banco = bloqueia FCM + Web Push.
  // Fail-open: erros de cache/DB retornam true (push sempre passa em dúvida).
  if (payload && payload.eventKey) {
    const active = await isPushEventActive(payload.eventKey);
    if (!active) return { sent: 0, removed: 0, skipped: true };
  }

  // Fan-out FCM nativo em paralelo, independente do Web Push (VAPID).
  // Um user so-nativo (app iOS, sem subscription web) precisa receber FCM
  // mesmo que nao tenha VAPID configurado ou nenhuma pushSubscription web.
  const fcmPromise = sendFcmToUser(userId, payload).catch(() => ({ sent: 0 }));

  try {
    const env = ensureConfigured();
    if (!env) { await fcmPromise; return { sent: 0, removed: 0 }; }

    const subs = await db.pushSubscription.findMany({ where: { userId } });
    if (subs.length === 0) { await fcmPromise; return { sent: 0, removed: 0 }; }

    const body = JSON.stringify({
      title: payload.title || "Calebe",
      body: payload.body || "",
      url: payload.url || "/",
      kind: payload.kind || "generic",
      tag: payload.tag,
      icon: payload.icon,
      badge: payload.badge,
      image: payload.image,
      leadId: payload.leadId ?? null,
      conversationId: payload.conversationId ?? null,
      requireInteraction: !!payload.requireInteraction,
      vibrate: payload.vibrate
    });

    let sent = 0;
    const idsToRemove = [];

    await Promise.all(
      subs.map(async (s) => {
        const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.authKey } };
        try {
          await webpush.sendNotification(sub, body, { TTL: 60 * 60 * 12 });
          sent += 1;
        } catch (err) {
          const status = err && err.statusCode;
          if (status === 404 || status === 410) idsToRemove.push(s.id);
        }
      })
    );

    if (idsToRemove.length > 0) {
      await db.pushSubscription.deleteMany({ where: { id: { in: idsToRemove } } });
    }

    const fcm = await fcmPromise;
    return { sent: sent + (fcm.sent || 0), removed: idsToRemove.length };
  } catch {
    await fcmPromise.catch(() => {});
    return { sent: 0, removed: 0 };
  }
}

/** Envia push pra todos usuários com determinada role. */
export async function sendPushToRole(role, payload) {
  try {
    const users = await db.user.findMany({ where: { role, active: true }, select: { id: true } });
    const results = await Promise.all(users.map((u) => sendPushToUser(u.id, payload)));
    return results.reduce(
      (acc, r) => ({ sent: acc.sent + r.sent, removed: acc.removed + r.removed }),
      { sent: 0, removed: 0 }
    );
  } catch {
    return { sent: 0, removed: 0 };
  }
}

/** Envia push pro user dono de um Associate. */
export async function sendPushToAssociate(associateId, payload) {
  try {
    const a = await db.associate.findUnique({ where: { id: associateId }, select: { userId: true } });
    if (!a) return { sent: 0, removed: 0 };
    return sendPushToUser(a.userId, payload);
  } catch {
    return { sent: 0, removed: 0 };
  }
}
