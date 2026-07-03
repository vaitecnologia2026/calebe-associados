// =============================================================================
// /api/dashboards · Painel TV + resumo admin + indicadores do corretor
// =============================================================================
import { Router } from "express";
import { db } from "../db.js";
import { readFileSync } from "node:fs";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { getTvMetrics, getAdminSummary } from "../services/metricsService.js";

const r = Router();

// GET /api/dashboards/tv — polling 10s · cache interno de 9s
r.get("/tv", requireAuth, async (_req, res, next) => {
  try { res.json(await getTvMetrics()); }
  catch (e){ next(e); }
});

// GET /api/dashboards/summary — para admin home
r.get("/summary", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const [tv, summary] = await Promise.all([getTvMetrics(), getAdminSummary()]);
    res.json({ ...tv, ...summary });
  } catch (e){ next(e); }
});

// GET /api/dashboards/associate — indicadores do corretor logado
// Retorna: total de leads atribuídos · distribuídos hoje · ativos · notificações não lidas
// 2026-06-09 · leadsAtRisk: leads que serão redistribuídos em breve (sem firstContactAt no prazo)
r.get("/associate", requireAuth, requireRole("ASSOCIATE"), async (req, res, next) => {
  try {
    const assoc = await db.associate.findUnique({
      where: { userId: req.user.id },
      select: { id: true, category: true, segment: true, status: true }
    });
    if (!assoc) return res.status(404).json({ error: "associate_not_found" });
    const today = new Date(); today.setHours(0,0,0,0);

    // Lê configurações de inatividade
    const [sMin, sMax, sActive] = await Promise.all([
      db.systemSetting.findUnique({ where: { key: "inactivity.minutes" } }),
      db.systemSetting.findUnique({ where: { key: "inactivity.maxRedistributions" } }),
      db.systemSetting.findUnique({ where: { key: "inactivity.active" } })
    ]);
    const inactivityMinutes = Number(sMin?.value ?? 1440);
    const maxRedist = Number(sMax?.value ?? 3);
    const inactivityActive = (sActive?.value ?? "true") === "true";

    // Leads em risco: sem firstContactAt, assignedAt há mais de 75% do prazo, abaixo do limite de redistribuições
    // Aviso dispara quando restar menos de 25% do tempo (6h para prazo de 24h)
    const warningThreshold = Math.floor(inactivityMinutes * 0.75);
    const cutoff = new Date(Date.now() - warningThreshold * 60 * 1000);

    const atRiskLeads = inactivityActive ? await db.lead.findMany({
      where: {
        assignedToId: assoc.id,
        firstContactAt: null,
        assignedAt: { lte: cutoff },
        redistributionCount: { lt: maxRedist },
        status: { in: ["NEW", "QUALIFYING"] },
        origin: { not: "MANUAL" },
        discardedAt: null
      },
      select: { id: true, name: true, assignedAt: true, redistributionCount: true },
      orderBy: { assignedAt: "asc" }
    }) : [];

    // Para cada lead em risco: quantas horas restam até redistribuição
    const now = Date.now();
    const atRiskWithHours = atRiskLeads.map(l => {
      const elapsedMin = Math.floor((now - new Date(l.assignedAt).getTime()) / 60_000);
      const hoursLeft = Math.max(0, Math.ceil((inactivityMinutes - elapsedMin) / 60));
      return { id: l.id, name: l.name, hoursLeft };
    });
    const minHoursLeft = atRiskWithHours.length > 0 ? Math.min(...atRiskWithHours.map(l => l.hoursLeft)) : null;

    const [leadsTotal, leadsDistributedToday, leadsActive, unreadNotifications] = await Promise.all([
      db.lead.count({ where: { assignedToId: assoc.id } }),
      db.distributionEntry.count({
        where: { associateId: assoc.id, state: "DISTRIBUTED", distributedAt: { gte: today } }
      }),
      db.lead.count({ where: { assignedToId: assoc.id, status: { in: ["NEW","QUALIFYING","NEGOTIATING","CLOSING"] } } }),
      db.notification.count({ where: { userId: req.user.id, readAt: null } })
    ]);
    res.json({
      associate: { id: assoc.id, category: assoc.category, segment: assoc.segment, status: assoc.status },
      leadsTotal,
      leadsDistributedToday,
      leadsActive,
      unreadNotifications,
      leadsAtRisk: atRiskWithHours.length,
      leadsAtRiskMinHoursLeft: minHoursLeft,
      leadsAtRiskList: atRiskWithHours.slice(0, 5) // top 5 mais urgentes
    });
  } catch (e){ next(e); }
});

// =============================================================================
// 2026-05-12 · /api/dashboards/active-brokers · ranking de engajamento
//
// Computa "engagementScore" pra cada corretor APPROVED e retorna ranking.
// Usado em:
//   - KPIs do /chat-monitor (online + nunca-logaram)
//   - Widget "Top corretores ativos" da admin home
//   - Modal de transferência (ordenar destinos)
//
// Score = (online_now * 50) + (logins_30d * 10) + (msgs_outbound_30d * 0.5)
//       + (conversas_tocadas_30d * 5) + (vendas_30d * 30)
// Cap em 999. Quem nunca logou = -1 (sinaliza inelegível).
// =============================================================================
r.get("/active-brokers", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
  try {
    // 2026-05-12 · Ranking reset · ignora atividade antes do RANKING_CUTOFF_AT.
    // Permite "zerar" o ranking sem deletar dados históricos.
    const cutoff = process.env.RANKING_CUTOFF_AT ? new Date(process.env.RANKING_CUTOFF_AT) : null;
    const thirtyDaysAgo = new Date(Date.now() - 30*24*60*60*1000);
    // Usa o MAIS RECENTE entre cutoff e 30d atrás (na prática · cutoff manda enquanto for futuro/recente)
    const windowStart = cutoff && cutoff > thirtyDaysAgo ? cutoff : thirtyDaysAgo;
    const fiveMinAgo  = new Date(Date.now() - 5*60*1000);

    const associates = await db.associate.findMany({
      where: { status: { in: ["APPROVED","INACTIVE"] } },
      select: {
        id: true, category: true, segment: true, status: true,
        user: { select: { id: true, name: true, email: true, lastLoginAt: true, lastSeenAt: true, magicSentAt: true, magicUsedAt: true } }
      }
    });

    const userIds  = associates.map(a => a.user.id);
    const assocIds = associates.map(a => a.id);

    const [msgsByAssoc, convsByAssoc, salesByAssoc, loginsByUser] = await Promise.all([
      db.$queryRaw`
        SELECT c."associateId" AS id, COUNT(*)::int AS n
        FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
        WHERE m.direction = 'outbound' AND m."fromRole" = 'associate'
          AND m."createdAt" >= ${windowStart}
          AND c."associateId" = ANY(${assocIds})
        GROUP BY c."associateId"
      `,
      db.$queryRaw`
        SELECT c."associateId" AS id, COUNT(DISTINCT c.id)::int AS n
        FROM "Conversation" c JOIN "Message" m ON m."conversationId" = c.id
        WHERE m.direction = 'outbound' AND m."fromRole" = 'associate'
          AND m."createdAt" >= ${windowStart}
          AND c."associateId" = ANY(${assocIds})
        GROUP BY c."associateId"
      `,
      db.sale.groupBy({
        by: ["associateId"],
        where: { status: "APPROVED", createdAt: { gte: windowStart }, associateId: { in: assocIds } },
        _count: { _all: true }
      }),
      db.$queryRaw`
        SELECT "userId" AS id, COUNT(*)::int AS n
        FROM "AuditEvent"
        WHERE action IN ('USER_LOGIN','LOGIN_SUCCESS','login_success')
          AND "createdAt" >= ${windowStart}
          AND "userId" = ANY(${userIds})
        GROUP BY "userId"
      `
    ]);

    const msgMap   = new Map(msgsByAssoc.map(r => [r.id, r.n]));
    const convMap  = new Map(convsByAssoc.map(r => [r.id, r.n]));
    const saleMap  = new Map(salesByAssoc.map(r => [r.associateId, r._count._all]));
    const loginMap = new Map(loginsByUser.map(r => [r.id, r.n]));

    const ranking = associates.map(a => {
      const u = a.user;
      const isOnline   = u.lastSeenAt && new Date(u.lastSeenAt).getTime() > fiveMinAgo.getTime();
      const everLogged = !!u.lastLoginAt;
      const blocked    = a.status === "INACTIVE";
      const msgs30     = msgMap.get(a.id)   || 0;
      const convs30    = convMap.get(a.id)  || 0;
      const sales30    = saleMap.get(a.id)  || 0;
      const logins30   = loginMap.get(u.id) || 0;
      const score = blocked ? 0
        : !everLogged ? -1
        : Math.min(999, Math.round(
            (isOnline ? 50 : 0) +
            (logins30 * 10) +
            (msgs30 * 0.5) +
            (convs30 * 5) +
            (sales30 * 30)
          ));
      return {
        id: a.id, userId: u.id, name: u.name, email: u.email,
        category: a.category, segment: a.segment, status: a.status,
        online: !!isOnline, everLogged, blocked,
        lastSeenAt: u.lastSeenAt, lastLoginAt: u.lastLoginAt,
        msgs30, convs30, sales30, logins30,
        score
      };
    }).sort((a,b) => b.score - a.score);

    // 2026-05-12 · KPIs de HOJE (BRT 0h até agora)
    const todayBrt = new Date();
    todayBrt.setHours(0,0,0,0);
    // Ajusta UTC pro fuso BRT (UTC-3) · banco grava UTC, mas "hoje" é BRT.
    const todayStart = new Date(todayBrt.getTime() + 3*60*60*1000); // 00h BRT em UTC

    const [convStartedToday, convRepliedToday, brokersOnlineToday] = await Promise.all([
      // Conversas onde a 1ª mensagem outbound (do corretor) foi hoje
      db.$queryRaw`
        SELECT COUNT(DISTINCT c.id)::int AS n
        FROM "Conversation" c
        WHERE EXISTS (
          SELECT 1 FROM "Message" m
          WHERE m."conversationId" = c.id
            AND m.direction = 'outbound'
            AND m."fromRole" = 'associate'
            AND m."createdAt" >= ${todayStart}
            AND m."createdAt" < ${new Date(todayStart.getTime() + 24*60*60*1000)}
        )
      `,
      // Conversas que tiveram pelo menos 1 inbound do lead hoje
      db.$queryRaw`
        SELECT COUNT(DISTINCT m."conversationId")::int AS n
        FROM "Message" m
        WHERE m.direction = 'inbound'
          AND m."fromRole" = 'lead'
          AND m."createdAt" >= ${todayStart}
          AND m."createdAt" < ${new Date(todayStart.getTime() + 24*60*60*1000)}
      `,
      // Corretores únicos com lastSeenAt hoje
      db.user.count({
        where: { role: "ASSOCIATE", lastSeenAt: { gte: todayStart } }
      })
    ]);

    const kpis = {
      total: ranking.length,
      online: ranking.filter(r => r.online).length,
      blocked: ranking.filter(r => r.blocked).length,
      neverLogged: ranking.filter(r => !r.everLogged && !r.blocked).length,
      // Diários (BRT)
      conversationsStartedToday: convStartedToday[0]?.n || 0,
      conversationsRepliedToday: convRepliedToday[0]?.n || 0,
      brokersOnlineToday
    };
    res.json({ kpis, ranking });
  } catch (e){ next(e); }
});

// 2026-05-12 · GET /api/dashboards/response-time-today
// Tempo médio entre o 1º outbound do corretor e o 1º inbound do lead, hoje (BRT).
// Mede a "velocidade de quebrar gelo" do time.
r.get("/response-time-today", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const todayBrt = new Date(); todayBrt.setHours(0,0,0,0);
    const todayStart = new Date(todayBrt.getTime() + 3*60*60*1000); // 00h BRT em UTC

    // Pega conversas com 1º outbound de associate hoje + 1º inbound de lead também
    const rows = await db.$queryRaw`
      WITH first_out AS (
        SELECT "conversationId", MIN("createdAt") AS t
        FROM "Message"
        WHERE direction = 'outbound' AND "fromRole" = 'associate'
          AND "createdAt" >= ${todayStart}
        GROUP BY "conversationId"
      ),
      first_in AS (
        SELECT "conversationId", MIN("createdAt") AS t
        FROM "Message"
        WHERE direction = 'inbound' AND "fromRole" = 'lead'
          AND "createdAt" >= ${todayStart}
        GROUP BY "conversationId"
      )
      SELECT
        AVG(EXTRACT(EPOCH FROM (fi.t - fo.t)))::float AS avg_seconds,
        COUNT(*)::int AS samples,
        MIN(EXTRACT(EPOCH FROM (fi.t - fo.t)))::float AS min_seconds,
        MAX(EXTRACT(EPOCH FROM (fi.t - fo.t)))::float AS max_seconds
      FROM first_out fo
      JOIN first_in fi ON fi."conversationId" = fo."conversationId"
      WHERE fi.t > fo.t
    `;
    const r0 = rows[0] || { avg_seconds: null, samples: 0 };
    res.json({
      samples: r0.samples || 0,
      avgSeconds: r0.avg_seconds || null,
      minSeconds: r0.min_seconds || null,
      maxSeconds: r0.max_seconds || null,
      avgFormatted: r0.avg_seconds ? formatSeconds(r0.avg_seconds) : "—"
    });
  } catch (e){ next(e); }
});

function formatSeconds(s){
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s/60)}min`;
  return `${(s/3600).toFixed(1)}h`;
}


// GET /api/dashboards/strategic?days=N | ?from=YYYY-MM-DD&to=YYYY-MM-DD — centro de comando ADM.
// Janela: days (1/7/30/90) OU range personalizado. Só leitura. 2026-06-05.
r.get("/strategic", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const Q = (sql) => db.$queryRawUnsafe(sql);
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const from = re.test(String(req.query.from || "")) ? String(req.query.from) : null;
    const to = re.test(String(req.query.to || "")) ? String(req.query.to) : null;
    const useRange = !!(from && to);
    const days = [1, 7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 1;
    const W = (col) => useRange
      ? `${col} >= '${from}'::date AND ${col} < ('${to}'::date + interval '1 day')`
      : `${col} > now() - interval '${days} days'`;
    const [funnel, conv, leak, offenders, inactive, ops, resp, msg, msgTrend, releases, applications, team, sales, visits, ranking, trend] = await Promise.all([
      Q(`SELECT status, count(*)::int n FROM "Lead" GROUP BY status`),
      Q(`SELECT count(*)::int total, count(*) FILTER (WHERE accepted)::int accepted, count(*) FILTER (WHERE "lastInboundAt" IS NOT NULL)::int responded FROM "Conversation"`),
      Q(`SELECT count(*) FILTER (WHERE accepted=false AND "lastInboundAt" IS NOT NULL)::int responded_unaccepted, count(*) FILTER (WHERE accepted=false AND "lastInboundAt" > now()-interval '24 hours')::int hot_open FROM "Conversation"`),
      Q(`SELECT u.name, count(*)::int n FROM "Conversation" c JOIN "Associate" a ON a.id=c."associateId" JOIN "User" u ON u.id=a."userId" WHERE c.accepted=false AND c."lastInboundAt" IS NOT NULL GROUP BY u.name ORDER BY count(*) DESC LIMIT 10`),
      Q(`SELECT count(DISTINCT l."assignedToId")::int brokers, count(*)::int leads FROM "Lead" l JOIN "Associate" a ON a.id=l."assignedToId" JOIN "User" u ON u.id=a."userId" WHERE l.status='NEW' AND (u."lastLoginAt" IS NULL OR u."lastLoginAt" < now()-interval '3 days')`),
      Q(`SELECT count(*) FILTER (WHERE action='LEAD_DISTRIBUTED')::int distributed, count(*) FILTER (WHERE action='CONVERSATION_ACCEPTED')::int accepted, count(*) FILTER (WHERE action='LOGIN')::int logins, count(*) FILTER (WHERE action='LEAD_STATUS_CHANGED')::int tabulacoes FROM "AuditEvent" WHERE ${W('"createdAt"')}`),
      Q(`SELECT count(*)::int n FROM "Conversation" WHERE ${W('"lastInboundAt"')}`),
      Q(`SELECT count(*) FILTER (WHERE direction='inbound')::int inbound, count(*) FILTER (WHERE direction='outbound')::int outbound, count(*)::int total FROM "Message" WHERE ${W('"createdAt"')}`),
      Q(`SELECT to_char(d,'DD/MM') d, n FROM (SELECT ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date d, count(*)::int n FROM "Message" WHERE ${W('"createdAt"')} GROUP BY 1 ORDER BY 1) t`),
      Q(`SELECT count(*) FILTER (WHERE status='PENDING')::int pending, count(*)::int total FROM "PhoneReleaseRequest"`),
      Q(`SELECT count(*) FILTER (WHERE status='PENDING')::int pending FROM "AssociateApplication"`),
      Q(`SELECT (SELECT count(*) FROM "Associate" WHERE status='APPROVED')::int total, (SELECT count(*) FROM "Associate" WHERE "approvedAt" > now()-interval '7 days')::int new7d, (SELECT count(*) FROM "Associate" WHERE "approvedAt" > now()-interval '30 days')::int new30d, (SELECT count(*) FROM "Associate" a JOIN "User" u ON u.id=a."userId" WHERE a.status='APPROVED' AND (u."lastLoginAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date=(now() AT TIME ZONE 'America/Sao_Paulo')::date)::int online_today, (SELECT count(*) FROM "Associate" a JOIN "User" u ON u.id=a."userId" WHERE a.status='APPROVED' AND u."lastSeenAt" > now() - interval '5 minutes')::int online_now, (SELECT count(*) FROM "Associate" a JOIN "User" u ON u.id=a."userId" WHERE a.status='APPROVED' AND (u."lastLoginAt" IS NULL OR u."lastLoginAt" < now()-interval '7 days'))::int inactive7d`),
      Q(`SELECT status, count(*)::int n, coalesce(sum("finalValue"::numeric),0)::float v FROM "Sale" GROUP BY status`),
      Q(`SELECT status, count(*)::int n FROM "Visit" GROUP BY status`),
      Q(`WITH ld AS (SELECT "assignedToId" aid, count(*) FILTER (WHERE status='NEW')::int new_held FROM "Lead" GROUP BY 1), sl AS (SELECT "associateId" aid, count(*) FILTER (WHERE status='APPROVED')::int sales FROM "Sale" GROUP BY 1), lk AS (SELECT "associateId" aid, count(*)::int leak FROM "Conversation" WHERE accepted=false AND "lastInboundAt" IS NOT NULL GROUP BY 1) SELECT u.name, coalesce(sl.sales,0)::int sales, coalesce(lk.leak,0)::int leak, coalesce(ld.new_held,0)::int new_held FROM "Associate" a JOIN "User" u ON u.id=a."userId" LEFT JOIN ld ON ld.aid=a.id LEFT JOIN sl ON sl.aid=a.id LEFT JOIN lk ON lk.aid=a.id WHERE a.status='APPROVED' ORDER BY sales DESC, new_held DESC LIMIT 12`),
      Q(`SELECT to_char(d,'DD/MM') d, dist, acc FROM (SELECT ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date d, count(*) FILTER (WHERE action='LEAD_DISTRIBUTED')::int dist, count(*) FILTER (WHERE action='CONVERSATION_ACCEPTED')::int acc FROM "AuditEvent" WHERE ${W('"createdAt"')} AND action IN ('LEAD_DISTRIBUTED','CONVERSATION_ACCEPTED') GROUP BY 1 ORDER BY 1) t`),
    ]);
    res.json({ period: useRange ? `${from}..${to}` : days, funnel, conv: conv[0], leak: leak[0], offenders, inactive: inactive[0], ops: ops[0], resp24h: (resp[0] && resp[0].n) || 0, msg24h: msg[0], msgTrend, releases: releases[0], applications: applications[0], team: team[0], sales, visits, ranking, trend });
  } catch (e){ next(e); }
});

// 2026-06-07 · Feed ao vivo da TV: corretor entrou · lead respondeu · negociacao quente.
r.get("/tv-feed", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const Q = (sql) => db.$queryRawUnsafe(sql);
    const [entrou, respondeu, quentesStage, quentesEng] = await Promise.all([
      Q(`SELECT u.id, u.name, u."lastSeenAt" at FROM "User" u JOIN "Associate" a ON a."userId"=u.id WHERE a.status='APPROVED' AND u."lastSeenAt" > now() - interval '8 minutes' ORDER BY u."lastSeenAt" DESC LIMIT 25`),
      Q(`SELECT c.id, l.name lead, u.name corretor, c."lastInboundAt" at FROM "Conversation" c JOIN "Lead" l ON l.id=c."leadId" LEFT JOIN "Associate" a ON a.id=c."associateId" LEFT JOIN "User" u ON u.id=a."userId" WHERE c."lastInboundAt" > now() - interval '8 minutes' ORDER BY c."lastInboundAt" DESC LIMIT 25`),
      Q(`SELECT l.id, l.name lead, u.name corretor, l.status::text FROM "Lead" l LEFT JOIN "Associate" a ON a.id=l."assignedToId" LEFT JOIN "User" u ON u.id=a."userId" WHERE l.status IN ('NEGOTIATING','CLOSING') AND l."updatedAt" > now() - interval '6 hours' ORDER BY l."updatedAt" DESC LIMIT 25`),
      Q(`SELECT c.id, l.name lead, u.name corretor, count(m.id)::int respostas FROM "Conversation" c JOIN "Lead" l ON l.id=c."leadId" LEFT JOIN "Associate" a ON a.id=c."associateId" LEFT JOIN "User" u ON u.id=a."userId" JOIN "Message" m ON m."conversationId"=c.id AND m.direction=\'inbound\' AND m."createdAt" > now() - interval \'60 minutes\' GROUP BY c.id, l.name, u.name HAVING count(m.id) >= 3 ORDER BY count(m.id) DESC LIMIT 25`),
    ]);
    res.json({ entrou, respondeu, quentes: { stage: quentesStage, engajados: quentesEng } });
  } catch (e){ next(e); }
});

// 2026-06-15 · Números OFICIAIS da Meta (WhatsApp): enviadas/entregues + custo billável.
// Cache de 30min — a Meta atualiza devagar e a API é lenta/limitada.
let _metaOfCache = { at: 0, data: null };
async function getMetaOficial(){
  if (_metaOfCache.data && Date.now() - _metaOfCache.at < 1800000) return _metaOfCache.data;
  try {
    const token = process.env.WHATSAPP_CLOUD_TOKEN;
    const waba = process.env.WHATSAPP_WABA_ID || "910162028578816";
    const V = process.env.WHATSAPP_GRAPH_VERSION || "v25.0";
    const day = 86400, now = Math.floor(Date.now()/1000), start = now - 41*day;
    const g = async (u) => (await fetch(u, { headers: { Authorization: "Bearer " + token } })).json();
    const jm = await g(`https://graph.facebook.com/${V}/${waba}?fields=analytics.start(${start}).end(${now}).granularity(DAY)`);
    let sent = 0, delivered = 0; for (const pt of (jm.analytics?.data_points || [])) { sent += pt.sent || 0; delivered += pt.delivered || 0; }
    const jp = await g(`https://graph.facebook.com/${V}/${waba}?fields=pricing_analytics.start(${start}).end(${now}).granularity(DAILY)`);
    let vol = 0, cost = 0; for (const pt of (jp.pricing_analytics?.data?.[0]?.data_points || [])) { vol += pt.volume || 0; cost += pt.cost || 0; }
    const data = { sent, delivered, billable: vol, costUsd: Math.round(cost * 100) / 100, fetchedAt: new Date().toISOString() };
    _metaOfCache = { at: Date.now(), data };
    return data;
  } catch (e) { return _metaOfCache.data || null; }
}

// GET /api/dashboards/analitico — 2026-06-15 · relatorio analitico completo da base (admin).
// Cache de 20s pra aguentar polling em tempo real sem martelar o Postgres.
let _anCache = { at: 0, data: null };
r.get("/analitico", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
  try {
    if (_anCache.data && Date.now() - _anCache.at < 20000) return res.json({ ..._anCache.data, cached: true });
    const q = (sql) => db.$queryRawUnsafe(sql);
    const [overview, msgStatus, inboundRow, daily, callsHist, callsStats, failReasons, online, bySource, respRow] = await Promise.all([
      q(`SELECT (SELECT COUNT(*)::int FROM "Lead") leads_total,(SELECT COUNT(*)::int FROM "Lead" WHERE "noWhatsApp") leads_sem_wpp,(SELECT COUNT(*)::int FROM "Lead" WHERE status='NEW') new,(SELECT COUNT(*)::int FROM "Lead" WHERE status='QUALIFYING') qualifying,(SELECT COUNT(*)::int FROM "Lead" WHERE status='NEGOTIATING') negotiating,(SELECT COUNT(*)::int FROM "Lead" WHERE status='CLOSED') closed,(SELECT COUNT(*)::int FROM "Lead" WHERE status='LOST') lost,(SELECT COUNT(*)::int FROM "Associate" WHERE status='APPROVED') assoc,(SELECT MIN("createdAt")::date::text FROM "Message") inicio,(SELECT MAX("createdAt")::date::text FROM "Message") fim`),
      q(`SELECT COALESCE("messageStatus",'(sem)') status, COUNT(*)::int n FROM "Message" WHERE direction='outbound' GROUP BY 1 ORDER BY 2 DESC`),
      q(`SELECT COUNT(*)::int n FROM "Message" WHERE direction='inbound'`),
      q(`SELECT "createdAt"::date::text dia, COUNT(*)::int enviadas, COUNT(*) FILTER (WHERE "messageStatus" IN ('delivered','read'))::int entregues, COUNT(*) FILTER (WHERE "messageStatus"='failed')::int falhas FROM "Message" WHERE direction='outbound' GROUP BY 1 ORDER BY 1`),
      q(`WITH pl AS (SELECT c."leadId", COUNT(*)::int e FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId" WHERE m.direction='outbound' GROUP BY c."leadId") SELECT CASE WHEN e=1 THEN '1 vez' WHEN e=2 THEN '2 vezes' WHEN e=3 THEN '3 vezes' WHEN e BETWEEN 4 AND 5 THEN '4-5' WHEN e BETWEEN 6 AND 10 THEN '6-10' ELSE '10+' END faixa, COUNT(*)::int leads, MIN(e) ord FROM pl GROUP BY 1 ORDER BY MIN(e)`),
      q(`WITH pl AS (SELECT c."leadId", COUNT(*)::int e FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId" WHERE m.direction='outbound' GROUP BY c."leadId") SELECT COUNT(*)::int leads_contactados, COALESCE(ROUND(AVG(e),1),0)::float media, COALESCE(MAX(e),0)::int maximo, COALESCE(SUM(e),0)::int total_envios FROM pl`),
      q(`SELECT LEFT(COALESCE("errorReason",'(sem motivo)'),48) motivo, COUNT(*)::int n FROM "Message" WHERE direction='outbound' AND "messageStatus"='failed' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
      q(`SELECT COUNT(*) FILTER (WHERE u."lastSeenAt" >= NOW() - INTERVAL '5 minutes')::int agora, COUNT(*) FILTER (WHERE u."lastSeenAt" >= CURRENT_DATE)::int hoje, COUNT(*) FILTER (WHERE u."lastSeenAt" >= NOW() - INTERVAL '7 days')::int semana, COUNT(*) FILTER (WHERE u."lastSeenAt" IS NULL)::int nunca, COUNT(*)::int total FROM "Associate" a JOIN "User" u ON u.id=a."userId" WHERE a.status='APPROVED'`),
      q(`SELECT l.source, COUNT(DISTINCT c.id)::int conversas, COUNT(DISTINCT c.id) FILTER (WHERE EXISTS(SELECT 1 FROM "Message" mi WHERE mi."conversationId"=c.id AND mi.direction='inbound'))::int responderam FROM "Conversation" c JOIN "Lead" l ON l.id=c."leadId" GROUP BY 1 HAVING COUNT(DISTINCT c.id) > 30 ORDER BY 2 DESC LIMIT 10`),
      q(`SELECT COUNT(DISTINCT c."leadId")::int n FROM "Conversation" c WHERE EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId"=c.id AND m.direction='inbound')`)
    ]);
    // 2026-06-15 · Números WhatsApp em uso: suporte vs corretores + qualidade (do healthy_phones.json, cron horário)
    let numbers = [], numbersUpdatedAt = null;
    try {
      const hp = JSON.parse(readFileSync(process.env.HEALTHY_PHONES_FILE || "/root/vaidavenda-calebe/backend/data/healthy_phones.json", "utf8"));
      const SUPPORT = new Set(["1143966188797246", "1155522184305211"]);
      const greenSend = new Set((hp.greenIds || []).filter((id) => !SUPPORT.has(id)));
      numbers = (hp.all || []).map((n) => ({
        number: n.number, quality: n.quality,
        role: SUPPORT.has(n.id) ? "suporte" : "corretores",
        inPool: greenSend.has(n.id)
      })).sort((a, b) => (a.role === b.role ? 0 : a.role === "suporte" ? 1 : -1));
      numbersUpdatedAt = hp.updatedAt || null;
    } catch (e) { /* arquivo ausente · segue sem painel de números */ }
    const metaOficial = await getMetaOficial();
    const data = { metaOficial, numbers, numbersUpdatedAt, overview: overview[0], msgStatus, inbound: inboundRow[0].n, daily, callsHist, callsStats: callsStats[0], failReasons, online: online[0], bySource, responderam: respRow[0].n, generatedAt: new Date().toISOString() };
    _anCache = { at: Date.now(), data };
    res.json(data);
  } catch (e){ next(e); }
});

export default r;
