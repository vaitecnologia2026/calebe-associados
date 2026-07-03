// =============================================================================
// leadReactivationWorker · recicla o backlog de leads (snapshot em
// lead_reactivation_backlog) de volta pra fila de distribuição, PAGINADO.
// Mantém a fila abastecida até TARGET; o leadQueueWorker redistribui no ritmo
// real (~capacidade/dia). Cada lead é reciclado UMA vez (done=true) → o worker
// PARA sozinho quando o backlog esvazia. Sem churn, sem drenar os corretores
// (o lead só troca de dono quando é de fato redistribuído).
//   Liga/desliga: env REACTIVATION_ENABLED=1
// =============================================================================
import { db } from "../db.js";
import { logger } from "../utils/logger.js";

const enabled       = () => process.env.REACTIVATION_ENABLED === "1";
const INTERVAL_MS   = Number(process.env.REACTIVATION_INTERVAL_MS || 30 * 60 * 1000); // 30 min
const TARGET_PENDING= Number(process.env.REACTIVATION_TARGET_QUEUE || 350);
const MAX_PER_TICK  = Number(process.env.REACTIVATION_MAX_PER_TICK || 120);

async function tick(){
  if (!enabled()) return;
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const pend = await db.distributionEntry.count({
      where: { state: { in: ["PENDING","SCHEDULED"] }, scheduledFor: { lte: today } }
    });
    const need = Math.min(TARGET_PENDING - pend, MAX_PER_TICK);
    if (need <= 0) return;
    const rows = await db.$queryRawUnsafe(`SELECT lead_id FROM lead_reactivation_backlog WHERE done=false LIMIT ${need}`);
    if (!rows.length) return;
    let n = 0;
    for (const { lead_id } of rows){
      try {
        await db.distributionEntry.upsert({
          where:  { leadId: lead_id },
          create: { leadId: lead_id, scheduledFor: today, state: "PENDING" },
          update: { state: "PENDING", scheduledFor: today, associateId: null, distributedAt: null, attemptCount: 0, notes: "reativacao" }
        });
        await db.lead.update({ where: { id: lead_id }, data: { status: "NEW", firstContactAt: null, redistributionCount: 0 } });
        await db.$executeRawUnsafe(`UPDATE lead_reactivation_backlog SET done=true, done_at=now() WHERE lead_id=$1`, lead_id);
        n++;
      } catch (e){
        logger.warn({ err: e.message, lead_id }, "[reativacao] lead falhou · marcando done p/ nao travar");
        await db.$executeRawUnsafe(`UPDATE lead_reactivation_backlog SET done=true, done_at=now() WHERE lead_id=$1`, lead_id).catch(()=>{});
      }
    }
    const rest = await db.$queryRawUnsafe(`SELECT count(*)::int c FROM lead_reactivation_backlog WHERE done=false`);
    logger.info({ reciclados: n, filaAntes: pend, restam: rest[0]?.c }, "♻ [reativacao] lote processado");
  } catch (e){
    logger.error({ err: e.message }, "[reativacao] tick falhou");
  }
}

export function startReactivationWorker(){
  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== "0") return; // só 1 instância no cluster
  logger.info({ enabled: enabled(), targetQueue: TARGET_PENDING, maxPerTick: MAX_PER_TICK, intervalMin: INTERVAL_MS/60000 }, "♻ leadReactivationWorker iniciado");
  setInterval(tick, INTERVAL_MS);
  setTimeout(tick, 20000); // primeiro lote ~20s após boot
}
