// =============================================================================
// /api/distribution · regras, percentuais, fila, histórico, inatividade
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { distributeToday, distributeExtra, getDailyCapacity, computeTargetMix } from "../services/distributionEngine.js";
import { sweepInactivity } from "../services/redistributionEngine.js";
import { getQueueByDay, getDistributionHistory } from "../services/queueScheduler.js";
import { audit } from "../utils/audit.js";

const r = Router();

// ---------- Regras / percentuais / cotas -------------------------------------
r.get("/rules", requireAuth, async (_req, res, next) => {
  try {
    const rules = await db.distributionRule.findMany({ orderBy: { priority: "asc" } });
    res.json({ rules });
  } catch (e){ next(e); }
});

r.patch("/rules/:category", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const category = z.enum(["BRONZE","SILVER","GOLD","DIAMOND"]).parse(req.params.category);
    const { dailyQuota, percentage, priority } = z.object({
      dailyQuota: z.number().int().min(0).max(50).optional(),
      percentage: z.number().int().min(0).max(100).optional(),
      priority:   z.number().int().min(1).max(10).optional()
    }).parse(req.body);
    const updated = await db.distributionRule.update({
      where: { category },
      data: {
        ...(dailyQuota !== undefined ? { dailyQuota } : {}),
        ...(percentage !== undefined ? { percentage } : {}),
        ...(priority   !== undefined ? { priority   } : {})
      }
    });
    await audit({ req, action: "DIST_RULE_UPDATED", entity: `DistRule:${category}`, metadata: { dailyQuota, percentage, priority } });
    res.json(updated);
  } catch (e){ next(e); }
});

// Atualiza TODOS os percentuais de uma vez (valida soma = 100)
r.patch("/percentages", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const body = z.object({
      DIAMOND: z.number().int().min(0).max(100),
      GOLD:    z.number().int().min(0).max(100),
      SILVER:  z.number().int().min(0).max(100),
      BRONZE:  z.number().int().min(0).max(100)
    }).parse(req.body);
    const sum = body.DIAMOND + body.GOLD + body.SILVER + body.BRONZE;
    if (sum !== 100) return res.status(422).json({ error: "sum_must_be_100", current: sum });
    await db.$transaction(Object.entries(body).map(([cat, pct]) =>
      db.distributionRule.update({ where: { category: cat }, data: { percentage: pct } })
    ));
    await audit({ req, action: "DIST_PERCENTAGES_UPDATED", entity: "DistRule:ALL", metadata: body });
    res.json({ ok: true, percentages: body });
  } catch (e){ next(e); }
});

// Inatividade (settings)
r.patch("/inactivity-settings", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { minutes, maxRedistributions, active } = z.object({
      minutes: z.number().int().min(1).max(1440).optional(),
      maxRedistributions: z.number().int().min(1).max(10).optional(),
      active: z.boolean().optional()
    }).parse(req.body);
    const ups = [];
    if (minutes !== undefined)            ups.push(db.systemSetting.upsert({ where: { key: "inactivity.minutes" },            create: { key: "inactivity.minutes", value: minutes },            update: { value: minutes } }));
    if (maxRedistributions !== undefined) ups.push(db.systemSetting.upsert({ where: { key: "inactivity.maxRedistributions" }, create: { key: "inactivity.maxRedistributions", value: maxRedistributions }, update: { value: maxRedistributions } }));
    if (active !== undefined)             ups.push(db.systemSetting.upsert({ where: { key: "inactivity.active" },             create: { key: "inactivity.active", value: active },             update: { value: active } }));
    await Promise.all(ups);
    await audit({ req, action: "INACTIVITY_SETTINGS_UPDATED", entity: "Settings:inactivity", metadata: { minutes, maxRedistributions, active } });
    res.json({ ok: true });
  } catch (e){ next(e); }
});

// ---------- Fila e histórico -------------------------------------------------
r.get("/queue", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const queue = await getQueueByDay();
    const capacity = await getDailyCapacity();
    const mix = await computeTargetMix();
    res.json({ queue, capacity, targetMix: mix.alvo });
  } catch (e){ next(e); }
});

r.get("/history", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 180);
    const history = await getDistributionHistory(days);
    const redistributions = await db.redistributionLog.findMany({
      take: 100, orderBy: { timestamp: "desc" },
      include: { lead: { select: { name: true, segment: true } } }
    });
    res.json({ history, redistributions });
  } catch (e){ next(e); }
});

// ---------- Ações manuais (admin) --------------------------------------------
r.post("/run", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const r2 = await distributeToday();
    await audit({ req, action: "DIST_RUN_MANUAL", entity: "Distribution", metadata: r2 });
    res.json({ ok: true, distributed: r2 });
  } catch (e){ next(e); }
});

r.post("/rebalance", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const r2 = await sweepInactivity();
    await audit({ req, action: "DIST_REBALANCE_MANUAL", entity: "Redistribution", metadata: r2 });
    res.json({ ok: true, ...r2 });
  } catch (e){ next(e); }
});

// Distribuição extra · admin puxa N leads da fila agora · filtros category | associateId
r.post("/extra", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const params = z.object({
      count: z.number().int().min(1).max(500),
      category: z.enum(["BRONZE","SILVER","GOLD","DIAMOND"]).nullish(),
      associateId: z.string().nullish()
    }).parse(req.body);
    const r2 = await distributeExtra({
      count: params.count,
      category: params.category || undefined,
      associateId: params.associateId || undefined
    });
    await audit({ req, action: "DIST_EXTRA_MANUAL", entity: "Distribution", metadata: { count: params.count, category: params.category, associateId: params.associateId, distributed: r2.distributed } });
    res.json({ ok: true, ...r2 });
  } catch (e){
    if (e.status) return res.status(e.status).json({ ok: false, error: e.message });
    next(e);
  }
});

// 2026-05-12 · GET /api/distribution/top-called-replied?period=all|today|7d|30d
// "Chamados" = conversations onde o corretor mandou pelo menos 1 outbound nesse período.
// "Respondidos" = conversations onde também houve pelo menos 1 inbound do lead nesse período.
// Taxa = respondidos/chamados.
// 2026-05-27 · F2 W9 · cache TTL 60s (por period). Eram a maioria das slow
// queries restantes (200-750ms). Analytics nao precisa tempo real · 60s OK.
const _topCalledCache = new Map(); // period → { data, builtAt }
const _TOP_CALLED_TTL_MS = Number(process.env.TOP_CALLED_TTL_MS || 60_000);
r.get("/top-called-replied", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const period = String(req.query.period || "all");

    // Cache HIT
    const _cached = _topCalledCache.get(period);
    if (_cached && Date.now() - _cached.builtAt < _TOP_CALLED_TTL_MS){
      return res.json({ ..._cached.data, _cacheHit: true, _cacheAgeMs: Date.now() - _cached.builtAt });
    }

    const now = new Date();
    let since = null;
    if (period === "today"){ since = new Date(now); since.setHours(0,0,0,0); }
    else if (period === "7d")  { since = new Date(now.getTime() - 7*24*60*60*1000); }
    else if (period === "30d") { since = new Date(now.getTime() - 30*24*60*60*1000); }
    // Aplica também o RANKING_CUTOFF_AT se configurado (zera ranking)
    const cutoff = process.env.RANKING_CUTOFF_AT ? new Date(process.env.RANKING_CUTOFF_AT) : null;
    if (cutoff && (!since || cutoff > since)) since = cutoff;

    const sinceClause = since ? db.$queryRaw`AND m."createdAt" >= ${since}` : db.$queryRaw``;

    // Conversas onde o corretor mandou outbound
    const calledRows = since
      ? await db.$queryRaw`
        SELECT c."associateId" AS aid, COUNT(DISTINCT c.id)::int AS n
        FROM "Conversation" c
        WHERE EXISTS (
          SELECT 1 FROM "Message" m
          WHERE m."conversationId" = c.id
            AND m.direction = 'outbound'
            AND m."fromRole" = 'associate'
            AND m."createdAt" >= ${since}
        )
        GROUP BY c."associateId"
      `
      : await db.$queryRaw`
        SELECT c."associateId" AS aid, COUNT(DISTINCT c.id)::int AS n
        FROM "Conversation" c
        WHERE EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id AND m.direction = 'outbound' AND m."fromRole" = 'associate')
        GROUP BY c."associateId"
      `;
    // Conversas onde houve outbound do corretor E inbound do lead (não importa a ordem)
    const repliedRows = since
      ? await db.$queryRaw`
        SELECT c."associateId" AS aid, COUNT(DISTINCT c.id)::int AS n
        FROM "Conversation" c
        WHERE EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id AND m.direction = 'outbound' AND m."fromRole" = 'associate' AND m."createdAt" >= ${since})
          AND EXISTS (SELECT 1 FROM "Message" m2 WHERE m2."conversationId" = c.id AND m2.direction = 'inbound' AND m2."fromRole" = 'lead' AND m2."createdAt" >= ${since})
        GROUP BY c."associateId"
      `
      : await db.$queryRaw`
        SELECT c."associateId" AS aid, COUNT(DISTINCT c.id)::int AS n
        FROM "Conversation" c
        WHERE EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id AND m.direction = 'outbound' AND m."fromRole" = 'associate')
          AND EXISTS (SELECT 1 FROM "Message" m2 WHERE m2."conversationId" = c.id AND m2.direction = 'inbound' AND m2."fromRole" = 'lead')
        GROUP BY c."associateId"
      `;

    const calledMap = new Map(calledRows.map(r => [r.aid, r.n]));
    const repliedMap = new Map(repliedRows.map(r => [r.aid, r.n]));
    const aids = [...calledMap.keys()];
    const assocs = aids.length
      ? await db.associate.findMany({ where: { id: { in: aids } }, select: { id: true, user: { select: { name: true, lastSeenAt: true } } } })
      : [];

    const data = assocs.map(a => {
      const called = calledMap.get(a.id) || 0;
      const replied = repliedMap.get(a.id) || 0;
      return {
        associateId: a.id, name: a.user.name, lastSeenAt: a.user.lastSeenAt,
        called, replied, responseRate: called > 0 ? replied / called : 0
      };
    }).sort((a,b) => b.called - a.called).slice(0, 10);

    // 2026-05-27 · F2 W9 · grava no cache TTL 60s
    const payload = { since: since?.toISOString() || null, period, data };
    _topCalledCache.set(period, { data: payload, builtAt: Date.now() });

    res.json(payload);
  } catch (e){ next(e); }
});

export default r;
