// =============================================================================
// Métricas para Dashboard e Painel TV · queries otimizadas e cacheadas.
// =============================================================================
import { db } from "../db.js";

// Cache in-memory · polling do painel TV evita stress no DB
// 2026-05-27 · Fase 2 Win 8 · TTL 9s → 25s. dashboardMetricsWorker tick 10s → 20s.
// Antes: TTL menor que o tick = cache miss garantido → 4 workers × 6 ticks/min
// = 24 cálculos completos por minuto, mesmo sem usuário olhando o painel.
// Depois: TTL maior que tick = cache sempre quente. Painel TV polleia o cache,
// não o DB. Configurável via env (METRICS_CACHE_TTL_MS).
let cache = { at: 0, data: null };
const TTL_MS = Number(process.env.METRICS_CACHE_TTL_MS || 25_000);

export async function getTvMetrics(){
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;

  const today = new Date(); today.setHours(0,0,0,0);
  const inicioMes = new Date(today); inicioMes.setDate(1);

  const [
    totalAssociates,
    leadsDistHoje,
    leadsNaFila,
    conversasAtivas,
    vendasHoje,
    topAssociates,
    porCategoria
  ] = await Promise.all([
    db.associate.count({ where: { status: "APPROVED" } }),
    db.distributionEntry.count({ where: { state: "DISTRIBUTED", distributedAt: { gte: today } } }),
    db.distributionEntry.count({ where: { state: { in: ["PENDING", "SCHEDULED"] } } }),
    db.conversation.count({
      where: { lead: { status: { in: ["NEW", "QUALIFYING", "NEGOTIATING", "CLOSING"] } } }
    }),
    // Vendas de hoje · exclui DRAFT (ainda em preenchimento) · conta SUBMITTED+IN_ANALYSIS+DRAFTING+APPROVED
    db.sale.count({ where: { createdAt: { gte: today }, status: { not: "DRAFT" } } }),
    db.associate.findMany({
      where: { status: "APPROVED" },
      take: 5,
      select: { id: true, category: true, user: { select: { name: true } }, _count: { select: { sales: true } } }
    }),
    db.associate.groupBy({
      by: ["category"],
      where: { status: "APPROVED" },
      _count: { _all: true }
    })
  ]);

  const topRanking = topAssociates
    .map(a => ({ id: a.id, name: a.user?.name || "—", category: a.category, sales: a._count.sales }))
    .sort((x,y) => y.sales - x.sales)
    .slice(0, 5);

  const porCatMap = Object.fromEntries(porCategoria.map(p => [p.category, p._count._all]));

  cache = {
    at: Date.now(),
    data: {
      totalAssociates,
      leadsDistributedToday: leadsDistHoje,
      leadsInQueue: leadsNaFila,
      activeConversations: conversasAtivas,
      salesToday: vendasHoje,
      topAssociates: topRanking,
      associatesByCategory: {
        DIAMOND: porCatMap.DIAMOND || 0,
        GOLD:    porCatMap.GOLD    || 0,
        SILVER:  porCatMap.SILVER  || 0,
        BRONZE:  porCatMap.BRONZE  || 0
      },
      refreshedAt: new Date().toISOString()
    }
  };
  return cache.data;
}

export async function getAdminSummary(){
  const today = new Date(); today.setHours(0,0,0,0);
  const year  = today.getFullYear();
  const startYear  = new Date(year, 0, 1);
  const startMonth = new Date(today); startMonth.setDate(1);
  const endMonth   = new Date(startMonth); endMonth.setMonth(endMonth.getMonth()+1);

  const [
    applPending, salesPending, commissionsPending, structurePending,
    cDueMonth, cPaidMonth, cReview, cBlocked,
    revenueYearAgg, commissionsPendingAgg, propertiesCount, leadsTotal
  ] = await Promise.all([
    db.associateApplication.count({ where: { status: "PENDING" } }),
    db.sale.count({ where: { status: "SUBMITTED" } }),
    db.commission.count({ where: { status: "pending" } }),
    db.structureRequest.count({ where: { status: "PENDING" } }),
    db.commission.aggregate({ _sum: { netValue: true }, where: { status: "approved", dueDate: { gte: startMonth, lt: endMonth } } }),
    db.commission.aggregate({ _sum: { netValue: true }, where: { status: "paid", paidAt: { gte: startMonth, lt: endMonth } } }),
    db.commission.aggregate({ _sum: { netValue: true }, where: { status: "pending" } }),
    db.commission.aggregate({ _sum: { netValue: true }, where: { status: "blocked" } }),
    db.sale.aggregate({ _sum: { finalValue: true }, where: { status: "APPROVED", createdAt: { gte: startYear } } }),
    db.commission.aggregate({ _sum: { netValue: true }, where: { status: { in: ["pending","approved"] } } }),
    db.property.count(),
    db.lead.count()
  ]);

  const num = (v) => v == null ? 0 : Number(v);
  return {
    applPending, salesPending, commissionsPending, structurePending,
    propertiesCount, leadsTotal,
    commissionsDueMonth:     num(cDueMonth._sum.netValue),
    commissionsPaidMonth:    num(cPaidMonth._sum.netValue),
    commissionsInReview:     num(cReview._sum.netValue),
    commissionsBlocked:      num(cBlocked._sum.netValue),
    revenueYear:             num(revenueYearAgg._sum.finalValue),
    commissionsPendingTotal: num(commissionsPendingAgg._sum.netValue)
  };
}
