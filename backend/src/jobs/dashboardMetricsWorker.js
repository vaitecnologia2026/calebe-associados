// Worker: aquece o cache de métricas do Painel TV.
// 2026-05-27 · Fase 2 Win 8 · tick 10s → 20s (TTL cache subiu pra 25s).
// Cache fica sempre quente (TTL > tick · margem de 5s). Configurável via env.
import { getTvMetrics } from "../services/metricsService.js";
import { logger } from "../utils/logger.js";

const INTERVAL_MS = Number(process.env.DASHBOARD_WORKER_INTERVAL_MS || 20_000);

export function startDashboardWorker(){
  logger.info("▶ dashboard metrics worker iniciado");
  const tick = async () => {
    try { await getTvMetrics(); }
    catch (e){ logger.warn({ err: e }, "dashboard tick error"); }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, INTERVAL_MS);
}
