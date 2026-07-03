// =============================================================================
// /api/ia · Assistente IA contextual
// -----------------------------------------------------------------------------
// Endpoints:
//   GET  /status      → { configurado, provider, model }
//   POST /assistente  → { texto, fonte: "ia" | "demo" }
//
// Gate: requireAuth + requireRole("ADMIN", "DEV"). Outro perfil recebe 403.
//
// Dois contextos distintos:
//   - ADMIN → contextoOperacao + buildSystemPrompt + respostaDemo
//     foco: leads, imóveis, corretores, vendas (visão de negócio)
//   - DEV   → contextoTecnico + buildSystemPromptDev + respostaDemoDev
//     foco: mensagens frustradas, bug reports, erros recentes, integrações
//
// Sem chave configurada → resposta demo (keyword matching sobre o contexto real).
// =============================================================================
import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { chamarLLM, llmConfigurado, statusLLM } from "../lib/llm.js";
import { logger } from "../utils/logger.js";

const r = Router();

// -----------------------------------------------------------------------------
// contextoOperacao(user)
// Monta um retrato leve do que importa pro ADMIN do CRM Calebe:
//   - leadsMes / leadsAguardando / leadsParados7d
//   - imoveisAtivos / imoveisSemCorretor (proxy: AVAILABLE sem leads vinculados)
//   - top3Corretores por leads em CLOSING/CLOSED no mês
//   - vendasMes (count + soma)
// Queries em paralelo com Promise.allSettled · falha de uma não derruba o ctx.
// -----------------------------------------------------------------------------
async function contextoOperacao(user){
  const agora = new Date();
  const inicioHoje = new Date(agora); inicioHoje.setHours(0, 0, 0, 0);
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const sete = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const cincoMin = new Date(Date.now() - 5 * 60 * 1000);

  const [
    leadsMes,
    leadsHoje,
    leadsAguardando,
    leadsParados7d,
    leadsNegociando,
    imoveisAtivos,
    imoveisDisponiveis,
    propertiesPendingApproval,
    vendasMesAgg,
    vendasHojeCount,
    salesSubmittedCount,
    commissionsPendingCount,
    commissionsApprovedAgg,
    applPending,
    structurePending,
    conversasAtivas,
    corretoresAprovados,
    corretoresOnline,
    topCorretoresRaw
  ] = await Promise.allSettled([
    db.lead.count({ where: { createdAt: { gte: inicioMes } } }),
    db.lead.count({ where: { createdAt: { gte: inicioHoje } } }),
    db.lead.count({ where: { assignedToId: null, status: "NEW" } }),
    db.lead.count({ where: { assignedToId: { not: null }, firstContactAt: null, assignedAt: { lt: sete } } }),
    db.lead.count({ where: { status: { in: ["NEGOTIATING", "CLOSING"] } } }),
    db.property.count({ where: { status: "AVAILABLE" } }),
    db.property.findMany({
      where: { status: "AVAILABLE" },
      select: { id: true, code: true, title: true, _count: { select: { leads: true } } },
      take: 200
    }),
    // Imóveis enviados por corretor aguardando aprovação · proxy via features META
    db.property.count({ where: { status: "AVAILABLE" } }).then(() => 0).catch(() => 0),
    db.sale.aggregate({
      where: { createdAt: { gte: inicioMes }, status: { in: ["APPROVED", "SUBMITTED"] } },
      _count: { _all: true },
      _sum: { finalValue: true }
    }),
    db.sale.count({ where: { createdAt: { gte: inicioHoje }, status: { not: "DRAFT" } } }),
    db.sale.count({ where: { status: "SUBMITTED" } }),
    db.commission.count({ where: { status: "pending" } }),
    db.commission.aggregate({ where: { status: "approved" }, _sum: { netValue: true }, _count: { _all: true } }),
    db.associateApplication.count({ where: { status: "PENDING" } }),
    db.structureRequest.count({ where: { status: "PENDING" } }),
    db.conversation.count({ where: { lead: { status: { in: ["NEW","QUALIFYING","NEGOTIATING","CLOSING"] } } } }),
    db.associate.count({ where: { status: "APPROVED" } }),
    db.user.count({ where: { lastSeenAt: { gte: cincoMin } } }),
    db.lead.groupBy({
      by: ["assignedToId"],
      where: {
        assignedToId: { not: null },
        status: { in: ["CLOSING", "CLOSED"] },
        updatedAt: { gte: inicioMes }
      },
      _count: { _all: true },
      orderBy: { _count: { assignedToId: "desc" } },
      take: 3
    })
  ]);

  const val = (s, fallback) => (s.status === "fulfilled" ? s.value : fallback);

  // Pós-processo: imóveis ativos sem nenhum lead vinculado (proxy de "sem corretor")
  const imoveisLista = val(imoveisDisponiveis, []);
  const imoveisSemLeads = Array.isArray(imoveisLista) ? imoveisLista.filter((p) => (p._count?.leads || 0) === 0) : [];

  // Resolve nomes dos top 3 corretores
  const topRaw = val(topCorretoresRaw, []);
  const ids = (Array.isArray(topRaw) ? topRaw : []).map((t) => t.assignedToId).filter(Boolean);
  let topCorretores = [];
  if (ids.length){
    try {
      const assocs = await db.associate.findMany({
        where: { id: { in: ids } },
        select: { id: true, user: { select: { name: true } } }
      });
      const byId = Object.fromEntries(assocs.map((a) => [a.id, a.user?.name || "—"]));
      topCorretores = topRaw.map((t) => ({ nome: byId[t.assignedToId] || "—", convertidos: t._count?._all || 0 }));
    } catch { /* silent */ }
  }

  const vendas = val(vendasMesAgg, { _count: { _all: 0 }, _sum: { finalValue: null } });
  const vendasSoma = vendas?._sum?.finalValue ? Number(vendas._sum.finalValue) : 0;
  const commAprovAgg = val(commissionsApprovedAgg, { _count: { _all: 0 }, _sum: { netValue: null } });

  return {
    nome: user.name || "Admin",
    papel: user.role,
    // Leads
    leadsMes:           val(leadsMes, 0),
    leadsHoje:          val(leadsHoje, 0),
    leadsAguardando:    val(leadsAguardando, 0),
    leadsParados7d:     val(leadsParados7d, 0),
    leadsNegociando:    val(leadsNegociando, 0),
    // Imóveis
    imoveisAtivos:      val(imoveisAtivos, 0),
    imoveisSemCorretor: imoveisSemLeads.length,
    imoveisSemCorretorExemplos: imoveisSemLeads.slice(0, 5).map((p) => `${p.code} · ${p.title}`),
    propertiesPendingApproval: val(propertiesPendingApproval, 0),
    // Vendas
    vendasMesCount:     vendas?._count?._all || 0,
    vendasMesSoma:      vendasSoma,
    vendasHojeCount:    val(vendasHojeCount, 0),
    salesSubmittedCount: val(salesSubmittedCount, 0),
    // Comissões
    commissionsPendingCount: val(commissionsPendingCount, 0),
    commissionsApprovedCount: commAprovAgg?._count?._all || 0,
    commissionsApprovedSoma: commAprovAgg?._sum?.netValue ? Number(commAprovAgg._sum.netValue) : 0,
    // Aprovações em fila
    applPending:        val(applPending, 0),
    structurePending:   val(structurePending, 0),
    // Atividade
    conversasAtivas:    val(conversasAtivas, 0),
    corretoresAprovados: val(corretoresAprovados, 0),
    corretoresOnline:   val(corretoresOnline, 0),
    // Top
    topCorretores
  };
}

// -----------------------------------------------------------------------------
// buildSystemPrompt(ctx) — texto puro, sem markdown, max 8 linhas
// -----------------------------------------------------------------------------
function buildSystemPrompt(ctx){
  const moeda = (n) => "R$ " + (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return [
    "Você é o assistente interno do CRM Calebe Associados (imobiliária de alto padrão).",
    "Missão: ajudar o ADMIN a entender a operação e tomar decisões rápidas com base nos dados reais abaixo.",
    "",
    "REGRAS DE RESPOSTA:",
    "- Responda SEMPRE em português do Brasil.",
    "- Seja curto, objetivo e prático (max ~8 linhas com listas, ~4 sem).",
    "- No máximo 1 emoji por resposta.",
    "- NÃO use markdown (sem **, *, `, #, ---). Texto puro.",
    "- Pode usar quebras de linha e listas no formato \"1.\" ou \"- \".",
    "- USE OS DADOS REAIS abaixo. Se a pergunta cabe no contexto, RESPONDA DIRETO.",
    "- Só oriente \"ir em algum lugar\" no sistema quando a info não está no contexto.",
    "- NUNCA invente números, nomes de corretores, valores ou imóveis.",
    "",
    `USUÁRIO ATUAL: ${ctx.nome} (perfil ${ctx.papel}).`,
    "",
    "PANORAMA OPERACIONAL (CRM Calebe):",
    "",
    "LEADS:",
    `- Recebidos hoje: ${ctx.leadsHoje} · no mês: ${ctx.leadsMes}`,
    `- Aguardando distribuição (NEW sem corretor): ${ctx.leadsAguardando}`,
    `- Parados há 7+ dias sem 1º contato: ${ctx.leadsParados7d}`,
    `- Em negociação ativa (NEGOTIATING + CLOSING): ${ctx.leadsNegociando}`,
    "",
    "IMÓVEIS:",
    `- Ativos (AVAILABLE): ${ctx.imoveisAtivos}`,
    `- Sem lead vinculado: ${ctx.imoveisSemCorretor}`,
    ctx.imoveisSemCorretorExemplos?.length
      ? `  Exemplos: ${ctx.imoveisSemCorretorExemplos.join(" | ")}`
      : null,
    "",
    "VENDAS E COMISSÕES:",
    `- Vendas no mês: ${ctx.vendasMesCount} contratos · ${moeda(ctx.vendasMesSoma)}`,
    `- Vendas hoje (qualquer status exceto DRAFT): ${ctx.vendasHojeCount}`,
    `- Vendas SUBMITTED aguardando análise jurídica: ${ctx.salesSubmittedCount}`,
    `- Comissões pendentes (aguardando aprovação): ${ctx.commissionsPendingCount}`,
    `- Comissões aprovadas a pagar: ${ctx.commissionsApprovedCount} · ${moeda(ctx.commissionsApprovedSoma)}`,
    "",
    "FILA DE APROVAÇÕES (admin precisa olhar):",
    `- Aplicações de corretor pendentes: ${ctx.applPending}`,
    `- Estrutura Premium pendente: ${ctx.structurePending}`,
    "",
    "ATIVIDADE:",
    `- Conversas ativas em aberto: ${ctx.conversasAtivas}`,
    `- Corretores aprovados: ${ctx.corretoresAprovados} · online agora (últ 5min): ${ctx.corretoresOnline}`,
    "",
    "TOP PERFORMANCE:",
    ctx.topCorretores?.length
      ? "- Top corretores convertendo no mês: " +
        ctx.topCorretores.map((c, i) => `${i + 1}) ${c.nome} (${c.convertidos})`).join(" · ")
      : "- Top corretores convertendo no mês: sem dados suficientes ainda"
  ].filter(Boolean).join("\n");
}

// -----------------------------------------------------------------------------
// respostaDemo(pergunta, ctx) — keyword matching sobre o contexto real
// Mantém o assistente útil quando a chave da IA não foi configurada.
// -----------------------------------------------------------------------------
function respostaDemo(pergunta, ctx){
  const q = String(pergunta || "").toLowerCase();
  const primeiro = (ctx.nome || "Admin").split(" ")[0];

  if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|e aí|hey)/.test(q)){
    return `Olá, ${primeiro}! 👋 Sou o assistente do CRM Calebe. Posso falar sobre leads, imóveis, corretores e vendas. Dica: ative a IA real em Configurações → Integrações & IA pra respostas livres.`;
  }
  if (/(lead).*(mês|mes|recebi|total)/.test(q) || /quantos leads/.test(q)){
    return `Neste mês entraram ${ctx.leadsMes} leads. Aguardando distribuição: ${ctx.leadsAguardando}. Parados 7+ dias sem 1º contato: ${ctx.leadsParados7d}.`;
  }
  if (/distribu|fila|aguardando|sem corretor/.test(q) && /lead/.test(q)){
    return `Hoje há ${ctx.leadsAguardando} leads aguardando distribuição e ${ctx.leadsParados7d} parados há 7+ dias sem 1º contato. Veja em /admin/distribuicao.`;
  }
  if (/parado|inativ|sem contato|7 dias|sete dias/.test(q)){
    return `${ctx.leadsParados7d} leads estão parados há 7+ dias sem nenhum contato do corretor. Ideal redistribuir em /admin/distribuicao.`;
  }
  if (/imóv|imov|propert|unidade/.test(q) && /(sem corretor|livre|disponí|disponi)/.test(q)){
    const ex = ctx.imoveisSemCorretorExemplos?.length ? ` Exemplos: ${ctx.imoveisSemCorretorExemplos.slice(0, 3).join(", ")}.` : "";
    return `${ctx.imoveisSemCorretor} imóveis ativos não têm nenhum lead vinculado.${ex}`;
  }
  if (/imóv|imov|propert/.test(q)){
    return `Imóveis ativos no portfólio: ${ctx.imoveisAtivos}. Sem lead vinculado: ${ctx.imoveisSemCorretor}.`;
  }
  if (/corretor|associado|equipe|time|top/.test(q)){
    if (!ctx.topCorretores?.length) return "Ainda não há dados suficientes do mês para ranquear corretores. Veja /admin/ranking.";
    const linhas = ctx.topCorretores.map((c, i) => `${i + 1}) ${c.nome} — ${c.convertidos} convertidos`).join("\n");
    return `Top corretores convertendo no mês:\n${linhas}`;
  }
  if (/venda|fechament|comissão|comissao|faturament/.test(q)){
    const moeda = "R$ " + (Number(ctx.vendasMesSoma) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
    return `Vendas no mês: ${ctx.vendasMesCount} contratos · valor total ${moeda}. Veja /admin/vendas.`;
  }
  if (/ajuda|help|comando|o que você|o que voce|posso/.test(q)){
    return "Posso responder sobre leads do mês, distribuição, imóveis ativos, top corretores e vendas. 💡 Ative a IA real em Configurações → Integrações & IA pra perguntas livres.";
  }
  return `Posso ajudar com leads, imóveis, corretores e vendas. 💡 Dica: ative a IA real em Configurações → Integrações & IA pra respostas livres. (No mês: ${ctx.leadsMes} leads, ${ctx.imoveisAtivos} imóveis ativos.)`;
}

// =============================================================================
// CONTEXTO DEV · saúde do sistema, erros e integrações
// -----------------------------------------------------------------------------
// Foco: tudo que um engenheiro precisa saber pra responder "o que tá quebrado?"
//   - mensagens frustradas (proxy de WhatsApp sem binding)
//   - bug reports abertos
//   - audit failures últimas 24h
//   - integrações (WA Cloud, VAI, Push, LLM)
//   - throughput recente (msgs últimas 24h)
// Todas as queries em paralelo · falha individual não derruba o ctx.
// =============================================================================
async function frustratedSince(since){
  const rows = since
    ? await db.$queryRaw`
        SELECT COUNT(*)::int AS n FROM "Message" m
        WHERE m.direction='outbound' AND m."fromRole"='associate'
          AND m."createdAt" >= ${since}
          AND NOT EXISTS (
            SELECT 1 FROM "Message" m2
            WHERE m2."conversationId"=m."conversationId"
              AND m2.direction='inbound' AND m2."createdAt" < m."createdAt"
          )
      `
    : await db.$queryRaw`
        SELECT COUNT(*)::int AS n FROM "Message" m
        WHERE m.direction='outbound' AND m."fromRole"='associate'
          AND NOT EXISTS (
            SELECT 1 FROM "Message" m2
            WHERE m2."conversationId"=m."conversationId"
              AND m2.direction='inbound' AND m2."createdAt" < m."createdAt"
          )
      `;
  return Number(rows[0]?.n || 0);
}

async function contextoTecnico(user){
  const agora = new Date();
  const inicio24h  = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
  const inicio1h   = new Date(agora.getTime() -  1 * 60 * 60 * 1000);
  const inicioHoje = new Date(agora); inicioHoje.setHours(0, 0, 0, 0);
  const inicio7d   = new Date(agora.getTime() - 7  * 24 * 60 * 60 * 1000);

  const [
    frustradasHoje,
    frustradas7d,
    frustradasTotal,
    feedbacks7d,
    feedbacksTipoRaw,
    auditFailures24h,
    msgs24h,
    msgsFailed24h,
    pushSubsAtivas,
    statusIa,
    settingsRaw,
    usuariosAtivos24h
  ] = await Promise.allSettled([
    frustratedSince(inicioHoje),
    frustratedSince(inicio7d),
    frustratedSince(null),
    db.auditEvent.count({ where: { action: "FEEDBACK_SUBMITTED", createdAt: { gte: inicio7d } } }),
    db.auditEvent.findMany({
      where: { action: "FEEDBACK_SUBMITTED", createdAt: { gte: inicio7d } },
      orderBy: { createdAt: "desc" }, take: 50,
      select: { metadata: true, createdAt: true }
    }),
    db.auditEvent.findMany({
      where: {
        createdAt: { gte: inicio24h },
        OR: [
          { action: { contains: "FAIL" } },
          { action: { contains: "ERROR" } },
          { action: "WA_MSG_FAILED" }
        ]
      },
      orderBy: { createdAt: "desc" }, take: 20,
      select: { action: true, entity: true, createdAt: true, metadata: true }
    }),
    db.message.count({ where: { createdAt: { gte: inicio24h } } }),
    db.message.count({ where: { createdAt: { gte: inicio24h }, messageStatus: "failed" } }),
    db.pushSubscription.count().catch(() => 0),
    statusLLM(),
    Promise.resolve([]), // integrações vêm de process.env (não DB) — resolvido abaixo
    db.user.count({ where: { lastLoginAt: { gte: inicio24h } } }).catch(() => 0)
  ]);

  const val = (s, fb) => (s.status === "fulfilled" ? s.value : fb);

  // Top 3 tipos de feedback no período
  const fbRaw = val(feedbacksTipoRaw, []);
  const tipoCount = {};
  for (const f of fbRaw){
    const t = (f.metadata?.type || "outro").toLowerCase();
    tipoCount[t] = (tipoCount[t] || 0) + 1;
  }
  const topTiposFeedback = Object.entries(tipoCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([t, n]) => `${t} (${n})`);

  // Erros recentes resumidos
  const errosRecentes = val(auditFailures24h, []).slice(0, 5).map((e) => {
    const ago = Math.max(1, Math.round((agora - new Date(e.createdAt)) / 60000));
    return `${e.action}${e.entity ? ` · ${e.entity}` : ""} (há ${ago}min)`;
  });

  // Integrações vêm de variáveis de ambiente (services/whatsappCloud.js + services/vaiClient.js)
  const waCloudOn = process.env.WHATSAPP_CLOUD_ENABLED === "true"
    && !!process.env.WHATSAPP_CLOUD_TOKEN
    && !!process.env.WHATSAPP_PHONE_NUMBER_ID;
  const vaiOn = !!process.env.VAI_LOGIN_EMAIL && !!process.env.VAI_CHANNEL_ID;
  const ia = val(statusIa, { configurado: false });

  const msgsTotal = val(msgs24h, 0);
  const msgsFail  = val(msgsFailed24h, 0);
  const failRate24h = msgsTotal > 0 ? Math.round((msgsFail / msgsTotal) * 1000) / 10 : 0;

  return {
    nome: user.name || "Dev",
    papel: user.role,
    frustradasHoje:    val(frustradasHoje, 0),
    frustradas7d:      val(frustradas7d, 0),
    frustradasTotal:   val(frustradasTotal, 0),
    feedbacks7d:       val(feedbacks7d, 0),
    topTiposFeedback,
    errosRecentes,
    errosTotal24h:     val(auditFailures24h, []).length,
    msgs24h:           msgsTotal,
    msgsFailed24h:     msgsFail,
    failRate24h,
    pushSubsAtivas:    val(pushSubsAtivas, 0),
    waCloudOn,
    vaiOn,
    iaConfigurada:     !!ia?.configurado,
    iaProvider:        ia?.provider || "—",
    iaModel:           ia?.model || "—",
    usuariosAtivos24h: val(usuariosAtivos24h, 0)
  };
}

function buildSystemPromptDev(ctx){
  return [
    "Você é o assistente técnico do CRM Calebe Associados, dedicado ao perfil DEV.",
    "Missão: ajudar engenheiros/operadores técnicos a entender saúde do sistema, erros, integrações e performance.",
    "",
    "REGRAS DE RESPOSTA:",
    "- Responda SEMPRE em português do Brasil.",
    "- Tom técnico, direto, sem floreio. Máx ~8 linhas com lista, ~4 sem.",
    "- No máximo 1 emoji por resposta (só se ajudar de verdade).",
    "- NÃO use markdown (sem **, *, `, #, ---). Texto puro, quebras de linha OK.",
    "- USE OS DADOS REAIS abaixo. Se a pergunta cabe no contexto, RESPONDA DIRETO com números.",
    "- Quando sugerir investigação, aponte rota interna (/dev/mensagens, /dev/feedback, /dev/logs) ou tabela/serviço relevante.",
    "- NUNCA invente erro, número, módulo ou nome de função.",
    "- Stack: React/Vite/TS no front · Express/Prisma/Postgres no back · WhatsApp Cloud (Meta) + VAI · PWA com push VAPID · SSE em /api/stream.",
    "",
    `USUÁRIO ATUAL: ${ctx.nome} (perfil ${ctx.papel}).`,
    "",
    "SAÚDE DO SISTEMA (snapshot agora):",
    `- Mensagens frustradas (outbound sem inbound prévio) — Hoje: ${ctx.frustradasHoje} · 7d: ${ctx.frustradas7d} · Histórico: ${ctx.frustradasTotal}`,
    `- Mensagens últimas 24h: ${ctx.msgs24h} · falharam: ${ctx.msgsFailed24h} (taxa ${ctx.failRate24h}%)`,
    `- Bug reports últimos 7d: ${ctx.feedbacks7d}${ctx.topTiposFeedback.length ? " · tipos top: " + ctx.topTiposFeedback.join(", ") : ""}`,
    `- Erros em audit nas últimas 24h: ${ctx.errosTotal24h}`,
    ctx.errosRecentes.length
      ? "  Últimos: " + ctx.errosRecentes.join(" | ")
      : "  (sem erros recentes auditados)",
    `- Usuários que logaram em 24h: ${ctx.usuariosAtivos24h}`,
    `- Push subscriptions ativas: ${ctx.pushSubsAtivas}`,
    "",
    "INTEGRAÇÕES:",
    `- WhatsApp Cloud (Meta): ${ctx.waCloudOn ? "configurado" : "NÃO configurado"}`,
    `- VAI WhatsApp: ${ctx.vaiOn ? "configurado" : "NÃO configurado"}`,
    `- LLM (IA): ${ctx.iaConfigurada ? `ativo · ${ctx.iaProvider} · ${ctx.iaModel}` : "NÃO configurado (modo demo)"}`
  ].join("\n");
}

function respostaDemoDev(pergunta, ctx){
  const q = String(pergunta || "").toLowerCase();
  const primeiro = (ctx.nome || "Dev").split(" ")[0];

  if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|e aí|hey)/.test(q)){
    return `Olá, ${primeiro}. 🛠 Sou o assistente técnico. Posso falar sobre mensagens frustradas, bug reports, erros, integrações (WA Cloud/VAI/Push) e performance. Ative a IA real em /admin/config para respostas livres.`;
  }
  if (/frustrad|janela.*fechad|sem binding|nao chegou|não chegou/.test(q)){
    return `Frustradas (outbound sem inbound prévio) — Hoje: ${ctx.frustradasHoje} · 7d: ${ctx.frustradas7d} · histórico ${ctx.frustradasTotal}. Detalhe em /dev/mensagens.`;
  }
  if (/bug|feedback|relato|report/.test(q)){
    const tipos = ctx.topTiposFeedback.length ? ` · tipos top: ${ctx.topTiposFeedback.join(", ")}` : "";
    return `Bug reports últimos 7d: ${ctx.feedbacks7d}${tipos}. Lista em /dev/feedback.`;
  }
  if (/erro|fail|falh|exception|stack/.test(q)){
    const lista = ctx.errosRecentes.length ? ` Últimos: ${ctx.errosRecentes.slice(0, 3).join(" | ")}.` : "";
    return `${ctx.errosTotal24h} eventos de falha nas últimas 24h.${lista} Audit completo em /dev/logs.`;
  }
  if (/whats|wa cloud|meta|template|wamid/.test(q)){
    return `WhatsApp Cloud (Meta): ${ctx.waCloudOn ? "configurado" : "NÃO configurado"}. VAI: ${ctx.vaiOn ? "configurado" : "NÃO configurado"}. Falhas de mensagem em 24h: ${ctx.msgsFailed24h} de ${ctx.msgs24h} (${ctx.failRate24h}%).`;
  }
  if (/vai( |$|\.|cloud)|whatsapp.web/.test(q)){
    return `Integração VAI: ${ctx.vaiOn ? "configurada" : "NÃO configurada"}. Endpoints em /api/vai/*. Se mensagem está caindo no /dev/null, normalmente é binding (lead nunca respondeu inbound).`;
  }
  if (/push|vapid|notific|notifica/.test(q)){
    return `Subscriptions push ativas: ${ctx.pushSubsAtivas}. Quem nunca subscreveu não recebe alerta. Cobertura em /admin/notificacoes.`;
  }
  if (/ia|llm|anthropic|openai|claude|gpt|chave/.test(q)){
    if (ctx.iaConfigurada) return `LLM ativo · provider ${ctx.iaProvider} · modelo ${ctx.iaModel}. Pra trocar, /admin/config > Integrações & IA.`;
    return `LLM ainda NÃO configurado — assistente respondendo no modo demo. Configure em /admin/config > Integrações & IA (Setting ia.apiKey).`;
  }
  if (/perf|perform|lento|slow|latên|latenc|throughput/.test(q)){
    return `Throughput 24h: ${ctx.msgs24h} mensagens · ${ctx.msgsFailed24h} falhadas (${ctx.failRate24h}% fail rate). Usuários ativos 24h: ${ctx.usuariosAtivos24h}. Pra deep dive precisa de logs no servidor.`;
  }
  if (/usuário|usuario|user|login|sessão|sessao|ativo/.test(q)){
    return `${ctx.usuariosAtivos24h} usuários logaram nas últimas 24h. Quem nunca logou é problema separado — listado no admin como "Não logaram".`;
  }
  if (/ajuda|help|comando|o que você|o que voce|posso/.test(q)){
    return "Posso responder sobre: mensagens frustradas, bug reports, erros recentes, integrações (WA/VAI/Push/IA), throughput e usuários ativos. 💡 Ative a IA real para perguntas livres.";
  }
  return `Posso ajudar com saúde do sistema, erros, mensagens e integrações. 💡 Ative a IA real em /admin/config. (Snapshot: ${ctx.frustradasHoje} frustradas hoje, ${ctx.errosTotal24h} erros em 24h, ${ctx.msgs24h} msgs em 24h.)`;
}

// -----------------------------------------------------------------------------
// Rotas
// -----------------------------------------------------------------------------
r.get("/status", requireAuth, requireRole("ADMIN", "DEV"), async (_req, res, next) => {
  try { res.json(await statusLLM()); }
  catch (e){ next(e); }
});

r.post("/assistente", requireAuth, requireRole("ADMIN", "DEV"), async (req, res, next) => {
  try {
    const pergunta = String(req.body?.pergunta || "").slice(0, 2000).trim();
    if (!pergunta) return res.status(400).json({ error: "pergunta_vazia" });

    // DEV recebe contexto técnico (saúde do sistema, erros, integrações).
    // ADMIN recebe contexto de operação (leads, imóveis, vendas, corretores).
    const isDev = req.user.role === "DEV";
    const ctx        = isDev ? await contextoTecnico(req.user) : await contextoOperacao(req.user);
    const sysPrompt  = isDev ? buildSystemPromptDev(ctx)       : buildSystemPrompt(ctx);
    const demoFn     = isDev ? respostaDemoDev                 : respostaDemo;

    if (await llmConfigurado()){
      try {
        const texto = await chamarLLM({
          system: sysPrompt,
          messages: [{ role: "user", content: pergunta }]
        });
        if (texto) return res.json({ texto, fonte: "ia" });
      } catch (e){
        logger.warn({ err: { message: e.message }, route: "/api/ia/assistente", isDev }, "LLM falhou · caindo no modo demo");
      }
    }
    return res.json({ texto: demoFn(pergunta, ctx), fonte: "demo" });
  } catch (e){ next(e); }
});

export default r;
