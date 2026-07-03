// =============================================================================
// Agendador simples da fila — helpers de consulta.
// =============================================================================
import { db } from "../db.js";

export async function getQueueByDay(){
  const rows = await db.distributionEntry.findMany({
    where: { state: { in: ["PENDING", "SCHEDULED"] } },
    include: { lead: { select: { segment: true, source: true } } }
  });
  const bucket = {};
  for (const r of rows){
    const iso = r.scheduledFor.toISOString().slice(0,10);
    if (!bucket[iso]) bucket[iso] = { total: 0, bySegment: {}, bySource: {} };
    bucket[iso].total++;
    const seg = r.lead?.segment || "—";
    const src = r.lead?.source  || "—";
    bucket[iso].bySegment[seg] = (bucket[iso].bySegment[seg] || 0) + 1;
    bucket[iso].bySource[src]  = (bucket[iso].bySource[src]  || 0) + 1;
  }
  return Object.keys(bucket).sort().map(day => ({ day, ...bucket[day] }));
}

export async function getDistributionHistory(days = 30){
  const since = new Date(); since.setDate(since.getDate() - days); since.setHours(0,0,0,0);
  return db.distributionEntry.groupBy({
    by: ["scheduledFor", "state"],
    where: { scheduledFor: { gte: since } },
    _count: { _all: true }
  });
}
