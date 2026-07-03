// =============================================================================
// /api/dev · endpoints da seção Dev do admin
//   - GET /feedback                  · lista bug reports (parse de audit FEEDBACK_SUBMITTED)
//   - GET /audit                     · audit log recente filtrado por action/user
//   - GET /messages/delivery-stats   · tabela escala do problema (Hoje/7d/Histórico)
//   - POST /feedback/analyze         · análise técnica via LLM Anthropic (lib/llm.js)
// Permissões: ADMIN (DEV via Role seria ideal, mas reusa ADMIN pra não exigir migration)
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { logger } from "../utils/logger.js";
import { chamarLLM, llmConfigurado } from "../lib/llm.js";

const r = Router();

// -----------------------------------------------------------------------------
// GET /api/dev/feedback?limit=200
// Parse de audit events com action=FEEDBACK_SUBMITTED. metadata tem:
//   { type, currentUrl, userAgent, screenshotUrl, descriptionLen, descriptionPreview, adminsNotified }
// -----------------------------------------------------------------------------
// 2026-06-03 · IDs ocultos do painel DEV (audit_events é imutável · não dá
// pra deletar, então filtramos aqui). Adicionar IDs manualmente quando um
// "feedback" não-bug precisar sumir da fila do DEV.
const HIDDEN_FEEDBACK_IDS = new Set([
  "cmpy0jslx00vm14ew295m2l5a", // teste do adm "testando o erro"
  "cmpxxwwb000ffzb0ru46hexhw", // "Não consegui baixar o app" · esperado (app em revisão)
]);

r.get("/feedback", requireAuth, requireRole("ADMIN", "DEV"), async (req, res, next) => {
  try {
    const take = Math.min(Number(req.query.limit) || 100, 500);
    const skip = Number(req.query.offset) || 0;
    const events = await db.auditEvent.findMany({
      where: {
        action: "FEEDBACK_SUBMITTED",
        id: { notIn: Array.from(HIDDEN_FEEDBACK_IDS) }
      },
      orderBy: { createdAt: "desc" },
      take, skip,
      include: { user: { select: { id: true, name: true, email: true, role: true } } }
    });
    const data = events.map((e) => {
      const m = e.metadata || {};
      return {
        id: e.id,
        type: m.type || "outro",
        description: m.descriptionPreview || "",
        descriptionLen: m.descriptionLen || 0,
        screenshotUrl: m.screenshotUrl || null,
        currentUrl: m.currentUrl || null,
        userAgent: m.userAgent || null,
        adminsNotified: m.adminsNotified || 0,
        sender: e.user ? { id: e.user.id, name: e.user.name, email: e.user.email, role: e.user.role } : null,
        actorEmail: e.actorEmail,
        createdAt: e.createdAt,
      };
    });
    res.json({ data, total: data.length });
  } catch (e) { next(e); }
});

// -----------------------------------------------------------------------------
// GET /api/dev/audit?limit=200&action=...
// -----------------------------------------------------------------------------
r.get("/audit", requireAuth, requireRole("ADMIN", "DEV"), async (req, res, next) => {
  try {
    const take = Math.min(Number(req.query.limit) || 200, 1000);
    const skip = Number(req.query.offset) || 0;
    const where = {};
    if (req.query.action) where.action = String(req.query.action);
    if (req.query.userId) where.userId = String(req.query.userId);
    if (req.query.since) {
      const since = new Date(String(req.query.since));
      if (!isNaN(since.getTime())) where.createdAt = { gte: since };
    }
    const events = await db.auditEvent.findMany({
      where, orderBy: { createdAt: "desc" }, take, skip,
      include: { user: { select: { id: true, name: true, email: true, role: true } } }
    });
    res.json({
      data: events.map((e) => ({
        id: e.id,
        action: e.action,
        entity: e.entity,
        actor: e.user ? `${e.user.name} (${e.user.email})` : e.actorEmail,
        actorRole: e.user?.role || null,
        ipAddress: e.ipAddress,
        metadata: e.metadata,
        createdAt: e.createdAt,
      })),
      total: events.length
    });
  } catch (e) { next(e); }
});

// -----------------------------------------------------------------------------
// GET /api/dev/messages/delivery-stats
// Tabela "escala do problema" — tentativas frustradas por período.
//
// "Tentativa frustrada" = outbound do corretor (direction='outbound' AND
// fromRole='associate') em uma conversation que NÃO tinha inbound prévio do lead
// no momento do envio. É o padrão "janela WhatsApp fechada / sem binding" que faz
// a mensagem ir pro /dev/null silenciosamente (warning já logado em conversations.js).
//
// Hoje: contagem absoluta + corretores únicos + leads únicos.
// Para 7d e Histórico: só contagem total (cardinality alta + custo de DISTINCT).
// -----------------------------------------------------------------------------
async function frustratedCount(since) {
  // outbound sem inbound prévio na mesma conversation
  const rows = since
    ? await db.$queryRaw`
        SELECT COUNT(*)::int AS n FROM "Message" m
        WHERE m.direction = 'outbound' AND m."fromRole" = 'associate'
          AND m."createdAt" >= ${since}
          AND NOT EXISTS (
            SELECT 1 FROM "Message" m2
            WHERE m2."conversationId" = m."conversationId"
              AND m2.direction = 'inbound'
              AND m2."createdAt" < m."createdAt"
          )
      `
    : await db.$queryRaw`
        SELECT COUNT(*)::int AS n FROM "Message" m
        WHERE m.direction = 'outbound' AND m."fromRole" = 'associate'
          AND NOT EXISTS (
            SELECT 1 FROM "Message" m2
            WHERE m2."conversationId" = m."conversationId"
              AND m2.direction = 'inbound'
              AND m2."createdAt" < m."createdAt"
          )
      `;
  return Number(rows[0]?.n || 0);
}

async function frustratedTodayDetailed(since) {
  // Hoje: também conta corretores únicos e leads únicos afetados
  const rows = await db.$queryRaw`
    SELECT
      COUNT(*)::int AS total,
      COUNT(DISTINCT c."associateId")::int AS corretores,
      COUNT(DISTINCT c."leadId")::int AS leads
    FROM "Message" m
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE m.direction = 'outbound' AND m."fromRole" = 'associate'
      AND m."createdAt" >= ${since}
      AND NOT EXISTS (
        SELECT 1 FROM "Message" m2
        WHERE m2."conversationId" = m."conversationId"
          AND m2.direction = 'inbound'
          AND m2."createdAt" < m."createdAt"
      )
  `;
  const r0 = rows[0] || {};
  return { total: Number(r0.total || 0), corretores: Number(r0.corretores || 0), leads: Number(r0.leads || 0) };
}

r.get("/messages/delivery-stats", requireAuth, requireRole("ADMIN", "DEV"), async (_req, res, next) => {
  try {
    const now = new Date();
    const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
    const start7d    = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);

    const [hoje, ult7d, total] = await Promise.all([
      frustratedTodayDetailed(startToday),
      frustratedCount(start7d),
      frustratedCount(null),
    ]);

    res.json({
      rows: [
        { period: "Hoje",            total: hoje.total, corretores: hoje.corretores, leads: hoje.leads },
        { period: "Últimos 7 dias",  total: ult7d,      corretores: null, leads: null },
        { period: "Total histórico", total: total,      corretores: null, leads: null },
      ],
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (e) { next(e); }
});

// -----------------------------------------------------------------------------
// POST /api/dev/feedback/analyze
// Análise técnica do bug report via LLM (Anthropic se configurado em Setting ia.apiKey).
// body: { description, type?, currentUrl?, userAgent? }
// -----------------------------------------------------------------------------
const analyzeSchema = z.object({
  description: z.string().min(10).max(8000),
  type: z.string().optional(),
  currentUrl: z.string().optional(),
  userAgent: z.string().optional(),
});
r.post("/feedback/analyze", requireAuth, requireRole("ADMIN", "DEV"), async (req, res, next) => {
  try {
    if (!await llmConfigurado()) {
      return res.status(503).json({ error: "ia_nao_configurada", message: "Configure a chave da API em /admin/config > Integrações & IA." });
    }
    const input = analyzeSchema.parse(req.body || {});
    const system = [
      "Você é um engenheiro de software sênior fazendo triagem de bug report do CRM Calebe Associados.",
      "Analise o relato e retorne EM PORTUGUÊS, em texto puro (sem markdown), 4 seções curtas:",
      "",
      "1) CAUSA PROVÁVEL (1-3 linhas)",
      "2) SEVERIDADE (Critico / Alto / Médio / Baixo) + justificativa curta",
      "3) PASSOS DE REPRODUÇÃO sugeridos (3-5 linhas no máximo)",
      "4) HIPÓTESES DE FIX (1-3 caminhos técnicos)",
      "",
      "Regras:",
      "- Seja conciso, sem floreio.",
      "- Se faltar info, declare explicitamente o que falta.",
      "- Stack: React + Vite + TS + Tailwind no frontend; Express + Prisma + Postgres no backend.",
      "- Mensageria via VAI CRM + WhatsApp Cloud API (Meta).",
    ].join("\n");
    const userMsg = [
      `Categoria: ${input.type || "outro"}`,
      input.currentUrl ? `URL: ${input.currentUrl}` : null,
      input.userAgent  ? `UA: ${input.userAgent.slice(0, 200)}` : null,
      "",
      "Descrição do usuário:",
      input.description,
    ].filter(Boolean).join("\n");

    const texto = await chamarLLM({
      system,
      messages: [{ role: "user", content: userMsg }],
      maxTokens: 1000,
    });
    res.json({ analise: texto, model: "anthropic" });
  } catch (e) {
    logger.warn({ err: e.message }, "feedback/analyze · erro");
    if (e.message && e.message.includes("anthropic_")) {
      return res.status(502).json({ error: "llm_error", message: e.message });
    }
    next(e);
  }
});

export default r;
