// =============================================================================
// /api/_metrics · Fase 0 · Instrumentação leve
//
// GET /api/_metrics             · resumo (memory, event loop lag, query stats)
// GET /api/_metrics?slow=1      · adiciona lista das últimas N slow queries
// GET /api/_metrics/health      · liveness simples (200 ok)
//
// Auth: header X-Metrics-Token (env METRICS_TOKEN). Sem auth pra ser usável
// por uptime monitors básicos · com token vê detalhes.
// =============================================================================
import { Router } from "express";
import { monitorEventLoopDelay } from "node:perf_hooks";
import os from "node:os";
import { _slowQueriesRingBuffer, _queryStats, db } from "../db.js";
import { requireAuth } from "../auth/middleware.js";

const r = Router();

// Event Loop lag monitor · um por processo
// resolution=20 ⇒ amostra a cada 20ms (overhead negligenciável)
const loopMon = monitorEventLoopDelay({ resolution: 20 });
loopMon.enable();

// Reset periódico do histograma (a cada 60s) pra refletir estado recente.
// Sem isso o p99 fica grudado em valores antigos.
setInterval(() => {
  try { loopMon.reset(); } catch {}
}, 60_000).unref();

const STARTED_AT = Date.now();

function getEventLoopStats(){
  // Valores em ns · convertemos pra ms
  const ns2ms = (n) => Math.round((Number(n) || 0) / 1e6 * 100) / 100;
  return {
    min:    ns2ms(loopMon.min),
    mean:   ns2ms(loopMon.mean),
    max:    ns2ms(loopMon.max),
    p50:    ns2ms(loopMon.percentile(50)),
    p90:    ns2ms(loopMon.percentile(90)),
    p99:    ns2ms(loopMon.percentile(99)),
    stddev: ns2ms(loopMon.stddev)
  };
}

function getMemoryStats(){
  const m = process.memoryUsage();
  const mb = (n) => Math.round(n / 1024 / 1024 * 10) / 10;
  return {
    rssMb:        mb(m.rss),
    heapUsedMb:   mb(m.heapUsed),
    heapTotalMb:  mb(m.heapTotal),
    externalMb:   mb(m.external),
    arrayBuffersMb: mb(m.arrayBuffers || 0)
  };
}

function isAuthorized(req){
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return true;        // sem token configurado · público
  const given = req.headers["x-metrics-token"] || req.query.token;
  return given === expected;
}

r.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

r.get("/", (req, res) => {
  // Resumo sempre disponível mesmo sem token (info não-sensível)
  const out = {
    ok: true,
    pid: process.pid,
    pm2InstanceId: Number(process.env.NODE_APP_INSTANCE ?? -1),
    nodeEnv: process.env.NODE_ENV || "dev",
    uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
    startedAt: new Date(STARTED_AT).toISOString(),
    memory: getMemoryStats(),
    eventLoop: getEventLoopStats(),
    cpu: {
      loadavg1m: os.loadavg()[0],
      loadavg5m: os.loadavg()[1],
      loadavg15m: os.loadavg()[2],
      cores: os.cpus().length
    },
    queries: {
      total: _queryStats.total,
      slow: _queryStats.slow,
      avgMs: _queryStats.total > 0
        ? Math.round((_queryStats.totalMs / _queryStats.total) * 100) / 100
        : 0,
      bufferSize: _slowQueriesRingBuffer.length,
      threshold: Number(process.env.SLOW_QUERY_MS || 150)
    }
  };

  // Detalhes sensíveis só com token
  if (req.query.slow && isAuthorized(req)){
    out.slowQueries = _slowQueriesRingBuffer.slice().reverse(); // mais recentes primeiro
  }

  res.json(out);
});

// 2026-07-02 · instrumentacao de uso de telas (contador por rota/dia/perfil).
r.post("/route-view", requireAuth, async (req, res) => {
  try {
    const path = String(req.body && req.body.path || "").slice(0, 120);
    if (!path) return res.json({ ok: true });
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const role = (req.user && req.user.role) || "?";
    await db.routeHit.upsert({
      where: { path_day_role: { path, day, role } },
      create: { path, day, role, count: 1 },
      update: { count: { increment: 1 }, updatedAt: new Date() },
    }).catch(() => {});
  } catch { /* nunca bloqueia */ }
  res.json({ ok: true });
});

export default r;
