// services/pushSettingsCache.js
// Cache em memória do estado isActive de cada PushNotificationSetting.
// TTL curto (60s) — reduz pressão no DB nos disparos de push, mas mantém
// reação rápida a toggles do admin sem precisar invalidar manualmente em
// outros processos. Invalidação manual via invalidatePushSettingsCache()
// é chamada DIRETO no handler PUT (mesma instância), pra refletir local
// instantâneo. Outras instâncias do pm2 cluster convergem em até 60s.
//
// Fail-open: qualquer erro (DB down, key inexistente, etc) deixa o push
// passar — push nunca pode quebrar por causa do guard.

import { db } from "../db.js";

const TTL_MS = 60 * 1000;

let cache = null;          // Map<string, boolean> | null
let fetchedAt = 0;         // epoch ms da última recarga
let inFlight = null;       // Promise da recarga atual (deduplica concorrência)

async function reload() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const rows = await db.pushNotificationSetting.findMany({
        select: { key: true, isActive: true },
      });
      const next = new Map();
      for (const r of rows) next.set(r.key, r.isActive);
      cache = next;
      fetchedAt = Date.now();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Retorna se o evento está ativo. Fail-open (true) em qualquer dúvida:
 *  - key vazia/nula → true
 *  - key não cadastrada → true
 *  - erro de DB     → true
 */
export async function isPushEventActive(key) {
  if (!key || typeof key !== "string") return true;
  try {
    if (!cache || Date.now() - fetchedAt > TTL_MS) await reload();
    if (!cache.has(key)) return true;
    return cache.get(key) === true;
  } catch {
    return true;
  }
}

/** Invalidação manual (chamada no PUT do admin). Próxima leitura recarrega. */
export function invalidatePushSettingsCache() {
  cache = null;
  fetchedAt = 0;
}
