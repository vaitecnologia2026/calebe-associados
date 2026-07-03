// Worker: varre leads inativos e redistribui a cada 60 segundos.
import { sweepInactivity } from "../services/redistributionEngine.js";
import { logger } from "../utils/logger.js";

const INTERVAL_MS = 60 * 1000;

export function startInactivityWorker(){
  // 2026-05-28 · CRITICAL FIX · PM2 cluster_mode com 4 instancias rodava 4x o worker
  // em paralelo SEM lock distribuido. Race condition redistribuia o mesmo lead pra
  // brokers diferentes em milissegundos (~3.5x redistribuicoes por lead) e disparava
  // WhatsApp duplicado · brokers recebiam "novo lead" e ao logar nao havia nada.
  // Storm registrada em 2026-05-28 11:01: 609 redistribuicoes / 175 leads em 1 min.
  // Solucao: apenas a primeira instancia executa o cron. PM2 seta NODE_APP_INSTANCE
  // automaticamente em cluster_mode (valores "0","1","2","3").
  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== "0"){
    logger.info({ instance: process.env.NODE_APP_INSTANCE }, "▶ inactivity worker · standby (apenas instancia 0 executa)");
    return;
  }
  logger.info({ instance: process.env.NODE_APP_INSTANCE || "single" }, "▶ inactivity redistribution worker iniciado");
  const tick = async () => {
    try { const r = await sweepInactivity(); if (r.redistributed > 0) logger.info(r, "leads redistribuidos"); }
    catch (e){ logger.error({ err: e }, "inactivity worker error"); }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, INTERVAL_MS);
}
