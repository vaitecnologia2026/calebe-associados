// services/fcmPush.js — Firebase Cloud Messaging (push nativo iOS/Android).
// Complementa o Web Push (VAPID). Enquanto o Web Push entrega no Service Worker
// do PWA/desktop, o FCM entrega no app nativo Capacitor (token salvo via
// AppDelegate -> UserDefaults -> Capacitor Preferences -> POST /push/register-fcm).
//
// Lazy init: se FIREBASE_SERVICE_ACCOUNT(_PATH) nao estiver setado, vira no-op.
// Best-effort: nunca lanca; auto-limpa tokens invalidos.

import admin from "firebase-admin";
import fs from "node:fs";
import { db } from "../db.js";
import { logger } from "../utils/logger.js";

let initialized = false;
let initWarned = false;

function ensureInit() {
  if (initialized) return true;
  if (admin.apps.length > 0) { initialized = true; return true; }

  let credentialJson = null;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    credentialJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    try {
      credentialJson = fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf-8");
    } catch (err) {
      logger.error({ err: err.message }, "fcm: falha ao ler FIREBASE_SERVICE_ACCOUNT_PATH");
      return false;
    }
  }

  if (!credentialJson) {
    if (!initWarned) {
      logger.warn("fcm: FIREBASE_SERVICE_ACCOUNT(_PATH) nao configurado — push nativo desativado");
      initWarned = true;
    }
    return false;
  }

  try {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(credentialJson)) });
    initialized = true;
    return true;
  } catch (err) {
    logger.error({ err: err.message }, "fcm: falha ao inicializar firebase-admin");
    return false;
  }
}

export function isFcmConfigured() {
  return !!(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
}

/**
 * Envia push FCM pra todos os tokens nativos de um user. Best-effort.
 * @param {string} userId
 * @param {object} payload — { title, body, url?, kind?, leadId?, conversationId? }
 * @returns {Promise<{sent:number, success:number, failure:number, removed:number}>}
 */
export async function sendFcmToUser(userId, payload) {
  try {
    if (!ensureInit()) return { sent: 0, success: 0, failure: 0, removed: 0 };

    const rows = await db.fcmToken.findMany({ where: { userId }, select: { id: true, token: true } });
    if (rows.length === 0) return { sent: 0, success: 0, failure: 0, removed: 0 };

    const data = {};
    if (payload.url) data.url = String(payload.url);
    if (payload.kind) data.kind = String(payload.kind);
    if (payload.tag) data.tag = String(payload.tag);
    if (payload.leadId) data.leadId = String(payload.leadId);
    if (payload.conversationId) data.conversationId = String(payload.conversationId);

    const message = {
      notification: { title: payload.title || "Calebe", body: payload.body || "" },
      data,
      tokens: rows.map(r => r.token),
      apns: {
        payload: { aps: { sound: "default", badge: 1, "mutable-content": 1 } },
      },
      android: {
        priority: "high",
        notification: { sound: "default" },
      },
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    const invalidIds = [];
    resp.responses.forEach((res, idx) => {
      if (!res.success) {
        const code = res.error?.code;
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token" ||
          code === "messaging/invalid-argument"
        ) invalidIds.push(rows[idx].id);
      }
    });
    if (invalidIds.length) {
      await db.fcmToken.deleteMany({ where: { id: { in: invalidIds } } });
    }

    if (resp.failureCount > 0) {
      logger.info({ userId, success: resp.successCount, failure: resp.failureCount, removed: invalidIds.length }, "fcm: envio com falhas");
    }

    return { sent: rows.length, success: resp.successCount, failure: resp.failureCount, removed: invalidIds.length };
  } catch (err) {
    logger.error({ err: err.message }, "fcm: falha ao enviar");
    return { sent: 0, success: 0, failure: 0, removed: 0 };
  }
}
