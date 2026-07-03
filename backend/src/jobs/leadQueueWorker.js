// Worker: processa fila de distribuicao a cada 2 minutos.
import { distributeToday } from "../services/distributionEngine.js";
import { logger } from "../utils/logger.js";

const INTERVAL_MS = 2 * 60 * 1000;

export function startLeadQueueWorker(){
  // 2026-05-28 · Mesmo fix do inactivityWorker · evita race entre 4 instancias PM2 cluster.
  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== "0"){
    logger.info({ instance: process.env.NODE_APP_INSTANCE }, "▶ lead queue worker · standby (apenas instancia 0 executa)");
    return;
  }
  logger.info("▶ lead queue worker iniciado");
  const tick = async () => {
    try { const r = await distributeToday(); if (r.total > 0) logger.info({ r }, "queue processed"); }
    catch (e){ logger.error({ err: e }, "queue worker error"); }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, INTERVAL_MS);
}
