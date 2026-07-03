// PrismaClient singleton com log controlado e graceful shutdown.
import { PrismaClient } from "@prisma/client";

const isProd = process.env.NODE_ENV === "production";

const _prisma = new PrismaClient({
  // 2026-05-27 · Fase 0 instrumentação · capturamos eventos de query mesmo em
  // produção pra alimentar o ring buffer de slow queries (routes/metrics.js).
  log: [
    { level: "query", emit: "event" },
    { level: "warn",  emit: "stdout" },
    { level: "error", emit: "stdout" }
  ]
});

// 2026-05-27 · Slow query tracker (Fase 0 · instrumentação)
// Mantém em memória as últimas N queries que excederam o threshold. Exposto
// pelo endpoint GET /api/_metrics. Zero overhead extra fora desse listener.
const SLOW_QUERY_THRESHOLD_MS = Number(process.env.SLOW_QUERY_MS || 150);
const SLOW_QUERY_BUFFER_SIZE  = Number(process.env.SLOW_QUERY_BUFFER || 100);
export const _slowQueriesRingBuffer = [];
export const _queryStats = { total: 0, totalMs: 0, slow: 0 };
_prisma.$on("query", (e) => {
  try {
    _queryStats.total++;
    _queryStats.totalMs += e.duration;
    if (e.duration >= SLOW_QUERY_THRESHOLD_MS){
      _queryStats.slow++;
      _slowQueriesRingBuffer.push({
        ts: new Date().toISOString(),
        durationMs: e.duration,
        sql: String(e.query || "").slice(0, 3500),
        params: String(e.params || "").slice(0, 500),
        target: e.target || null
      });
      if (_slowQueriesRingBuffer.length > SLOW_QUERY_BUFFER_SIZE){
        _slowQueriesRingBuffer.shift();
      }
    }
  } catch { /* listener nunca pode quebrar a query */ }
});

// 2026-05-18 · Middleware: quando uma Conversation é criada/upsertada e o
// Associate dela tem autoReleasePhone=true, força phoneReleased=true.
// Centraliza a regra em 1 lugar — evita esquecer em algum r.post/upsert futuro.
_prisma.$use(async (params, next) => {
  const isConvCreate = params.model === "Conversation" && ["create","upsert","createMany"].includes(params.action);
  if (!isConvCreate) return next(params);
  try {
    const data = params.action === "upsert" ? (params.args?.create || {}) : (params.args?.data || {});
    const associateId = data?.associateId || data?.associate?.connect?.id;
    if (!associateId) return next(params);
    // Se já vier explicitamente phoneReleased=true, não precisa lookup.
    if (data.phoneReleased === true) return next(params);
    const assoc = await _prisma.associate.findUnique({
      where: { id: associateId },
      select: { autoReleasePhone: true }
    });
    if (assoc?.autoReleasePhone){
      if (params.action === "create" || params.action === "createMany"){
        params.args.data = { ...(params.args.data || {}), phoneReleased: true };
      } else if (params.action === "upsert"){
        params.args.create = { ...(params.args.create || {}), phoneReleased: true };
      }
    }
  } catch (e){
    // Falha do middleware nunca pode bloquear a criação · log e segue.
    console.warn("[db middleware] auto-release phone falhou:", e.message);
  }
  return next(params);
});

export const db = _prisma;

// Graceful shutdown — garante que conexões abertas fecham ao SIGTERM/SIGINT.
const close = async () => { await db.$disconnect(); };
process.on("SIGTERM", close);
process.on("SIGINT", close);
process.on("beforeExit", close);
