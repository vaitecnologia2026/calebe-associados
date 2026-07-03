// =============================================================================
// Distribuição de Leads · respeita prioridade, cotas e percentuais.
//
// Regras:
// - Prioridade: DIAMOND → GOLD → SILVER → BRONZE
// - Cotas diárias por categoria
// - Percentual (%) do mix total do dia
// - Match por segmento (mesmo segmento primeiro)
// - Se não couber hoje → agenda para próximo dia disponível (FIFO por data)
// =============================================================================
import { db } from "../db.js";
import { audit } from "../utils/audit.js";
import { logger } from "../utils/logger.js";
import { sseToUser, sseToAdmins } from "./sseHub.js";
import { bootstrapConversationHistory } from "./chatHistoryBootstrap.js";
import { chatUpsertConversation } from "../chatDb.js";
import { sendPushToUser } from "./push.js";
import { notifyAssociateLeadAssigned } from "./associateNotifier.js";

// 2026-05-12 · Corretor elegível pra receber lead:
//   - status APPROVED (ativo · não bloqueado)
//   - user.lastLoginAt != null (já fez primeiro acesso)
//   - Tem pelo menos 1 conversa onde mandou outbound (já interagiu com algum lead)
// Sem isso, corretor recebia lead sem nunca ter mostrado atividade real.
// O filtro de "já interagiu" é aplicado em runtime via post-filter (Prisma `every/some`
// em relacionamento agregado fica complicado · simpler: filtramos depois do findMany).
// 2026-05-13 · exportado pra redistributionEngine reusar a mesma regra.
export const DISTRIBUTABLE_WHERE = {
  status: "APPROVED",
  user: { is: { lastLoginAt: { not: null } } }
};

// Pega IDs de associates que já mandaram pelo menos 1 mensagem outbound (já interagiram).
// Inclui também corretores recém-aprovados (< 7 dias) com grace period · senão criava
// catch-22 (precisa ter lead pra interagir, mas precisa interagir pra receber lead).
// 2026-05-13 · exportado pra redistributionEngine reusar.
export async function filterActiveBrokerIds(ids){
  return _filterActiveBrokerIds(ids);
}
async function _filterActiveBrokerIds(ids){
  if (!Array.isArray(ids) || ids.length === 0) return new Set();
  const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000);
  const [interacted, recent] = await Promise.all([
    db.$queryRaw`
      SELECT DISTINCT c."associateId" AS id
      FROM "Conversation" c
      WHERE c."associateId" = ANY(${ids})
        AND EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id AND m.direction = 'outbound' AND m."fromRole" = 'associate')
    `,
    db.associate.findMany({
      where: { id: { in: ids }, approvedAt: { gte: sevenDaysAgo } },
      select: { id: true }
    })
  ]);
  const set = new Set(interacted.map(r => r.id));
  for (const a of recent) set.add(a.id);
  return set;
}

// Capacidade total do dia considerando associados ativos e cotas.
export async function getDailyCapacity(){
  const rules = await db.distributionRule.findMany();
  const rulesByCat = Object.fromEntries(rules.map(r => [r.category, r]));
  const associates = await db.associate.findMany({
    where: DISTRIBUTABLE_WHERE,
    select: { id: true, category: true }
  });
  const porCat = { BRONZE:0, SILVER:0, GOLD:0, DIAMOND:0 };
  for (const a of associates){
    porCat[a.category] += rulesByCat[a.category]?.dailyQuota ?? 0;
  }
  const total = Object.values(porCat).reduce((s,n) => s+n, 0);
  return { total, porCat, associates: associates.length, rules: rulesByCat };
}

// Alvo por categoria = round(percentual × total) capado pela capacidade real
// + AUTO-REBALANCEAMENTO: redistribui o "overflow" (alvo > capacidade) entre as
// categorias com capacidade remanescente proporcionalmente.
//
// Por que: percentage é uma INTENÇÃO do admin (40% BRONZE, 30% SILVER, etc). Se
// não há corretor SILVER aprovado/elegível, o pct=30 vira capacidade morta — leads
// que poderiam ir pra BRONZE/GOLD ficam ociosos. O rebalance preenche esses slots
// automaticamente sem que o admin precise reconfigurar toda vez que aprova/promove
// alguém. Mantém o viés relativo entre categorias que têm pool real.
//
// Algoritmo (1 iteração — capacidade remanescente é monotônica decrescente):
//   1. ideal[cat]  = round((pct/100) × cap.total)         (intenção bruta)
//   2. alvo[cat]   = min(ideal[cat], cap.porCat[cat])     (capado pela capacidade)
//   3. overflow    = soma(ideal − alvo)                    (intenção não atingida)
//   4. capRest[cat]= cap.porCat[cat] − alvo[cat]          (capacidade ainda livre)
//   5. proporcional: cada cat ganha floor(overflow × capRest[cat] / soma(capRest))
//   6. re-cap por segurança (round/floor pode dar 1-2 leads de erro residual, OK)
export async function computeTargetMix(){
  const cap = await getDailyCapacity();
  const cats = ["BRONZE","SILVER","GOLD","DIAMOND"];

  // Passo 1+2: alvo inicial conforme intenção do admin, capado pela capacidade
  const alvo  = { BRONZE:0, SILVER:0, GOLD:0, DIAMOND:0 };
  const ideal = { BRONZE:0, SILVER:0, GOLD:0, DIAMOND:0 };
  for (const cat of cats){
    const pct = cap.rules[cat]?.percentage ?? 0;
    ideal[cat] = Math.round((pct / 100) * cap.total);
    alvo[cat]  = Math.min(ideal[cat], cap.porCat[cat]);
  }

  // Passo 3+4: detecta overflow e capacidade remanescente
  const overflow = cats.reduce((s, c) => s + (ideal[c] - alvo[c]), 0);
  const capRest  = Object.fromEntries(cats.map(c => [c, cap.porCat[c] - alvo[c]]));
  const totalCapRest = cats.reduce((s, c) => s + capRest[c], 0);

  // Passo 5+6: redistribui overflow proporcionalmente à capacidade remanescente
  let redistributed = 0;
  if (overflow > 0 && totalCapRest > 0){
    for (const c of cats){
      if (capRest[c] <= 0) continue;
      const bonus = Math.floor(overflow * capRest[c] / totalCapRest);
      const apply = Math.min(bonus, capRest[c]);
      alvo[c] += apply;
      redistributed += apply;
    }
    // Sobras residuais do floor (1-2 leads) — alocar nas categorias com mais
    // capacidade livre na ordem BRONZE→SILVER→GOLD→DIAMOND (estável).
    let residual = overflow - redistributed;
    if (residual > 0){
      for (const c of cats){
        if (residual <= 0) break;
        const remain = cap.porCat[c] - alvo[c];
        if (remain <= 0) continue;
        const add = Math.min(residual, remain);
        alvo[c] += add;
        residual -= add;
      }
    }
    logger.info({
      ideal, alvoBefore: cats.reduce((o,c) => ({...o, [c]: Math.min(ideal[c], cap.porCat[c])}), {}),
      alvoAfter: alvo, overflow, redistributed: overflow - residual
    }, "computeTargetMix · auto-rebalance aplicado");
  }
  return { alvo, cap };
}

// Quantos leads o associado já recebeu HOJE (via DistributionEntry).
async function usedToday(associateId){
  const today = new Date(); today.setHours(0,0,0,0);
  const count = await db.distributionEntry.count({
    where: {
      associateId,
      state: "DISTRIBUTED",
      distributedAt: { gte: today }
    }
  });
  return count;
}

// Escolhe próximo associado da categoria · FAIR round-robin dentro da cota.
// Usa pool pre-carregado + contador em memória (usedMap) para evitar N queries por lead.
// Prioridade de desempate: menor carga hoje → mesmo segmento → mais ativo.
function pickFromPool({ segment, targetCat, pools, usedMap, rules }){
  const pool = pools[targetCat];
  if (!pool || pool.length === 0) return null;
  const cota = rules[targetCat]?.dailyQuota || 1;
  // 1º critério: menor usedToday (round-robin justo)
  // 2º critério: mesmo segmento (match semântico)
  // 3º critério: lastActiveAt DESC (quem mais usa o sistema primeiro em empate)
  const ordenado = [...pool].sort((x, y) => {
    const uX = usedMap.get(x.id) || 0;
    const uY = usedMap.get(y.id) || 0;
    if (uX !== uY) return uX - uY;
    const segX = x.segment === segment ? 0 : 1;
    const segY = y.segment === segment ? 0 : 1;
    if (segX !== segY) return segX - segY;
    const lastX = x.lastActiveAt?.getTime() || 0;
    const lastY = y.lastActiveAt?.getTime() || 0;
    return lastY - lastX;
  });
  for (const a of ordenado){
    if ((usedMap.get(a.id) || 0) < cota) return a;
  }
  return null;
}

// Hora minima para a distribuicao automatica do dia processar (formato 24h).
// 2026-06-02 · Janela de distribuição automática: 07:30 – 19:00 BRT.
// Antes das 07:30 e depois das 19:00 o worker gira em idle — sem distribuir.
// Distribuicao manual (distributeExtra) e enqueueLead continuam sem restricao.
const DAILY_RUN_MIN_HOUR = 9;   // hora início (BRT)
const DAILY_RUN_MIN_MIN  = 0;  // minuto início
const DAILY_RUN_MAX_HOUR = 19;  // hora fim (encerra às 19:00)

// Processa um lote da fila. Cria/atualiza DistributionEntry.
// Retorna `{ ...porCat, total, details }` onde details = [{leadId, leadName, associateId, associateName, category}]
export async function distributeToday(){
  // Guard: só distribui dentro da janela 07:30-19:00 BRT.
  // Fora da janela o worker continua girando mas retorna sem trabalhar.
  const _now = new Date();
  const _h   = _now.getHours();
  const _m   = _now.getMinutes();
  const _min = _h * 60 + _m;
  const _ini = DAILY_RUN_MIN_HOUR * 60 + DAILY_RUN_MIN_MIN; // 450
  const _fim = DAILY_RUN_MAX_HOUR * 60;                      // 1140
  if (_min < _ini || _min >= _fim){
    return { BRONZE:0, SILVER:0, GOLD:0, DIAMOND:0, total:0, details:[], skipped:0, queueSize:0, deferred: `outside_window_0730-1900` };
  }
  const today = new Date(); today.setHours(0,0,0,0);
  const { alvo, cap } = await computeTargetMix();
  const distribuidos = { BRONZE:0, SILVER:0, GOLD:0, DIAMOND:0, total:0 };
  const details = [];
  const reagendados = [];

  // Pull-forward · Se a capacidade do dia (cap.total) for maior que a quantidade
  // de leads atualmente programados para hoje (ou antes), promove SCHEDULED de dias
  // futuros para PENDING-hoje ate preencher a capacidade. Mesmo padrao usado em
  // distributeExtra() (ver bloco "reorganização" mais abaixo). Garante que ao subir
  // cotas/aprovar mais corretores, os leads agendados a frente sejam puxados para
  // hoje sem precisar de acao manual.
  try {
    const hojeOuAntesCount = await db.distributionEntry.count({
      where: { state: { in: ["PENDING", "SCHEDULED"] }, scheduledFor: { lte: today } }
    });
    const autoCap = Number(await getSetting("distribution.autoDailyCap", 500));
    const sobra = Math.max(0, Math.min(autoCap, cap?.total || 0) - hojeOuAntesCount);
    if (sobra > 0){
      const puxar = await db.distributionEntry.findMany({
        where: { state: "SCHEDULED", scheduledFor: { gt: today } },
        orderBy: { scheduledFor: "asc" },
        take: sobra,
        select: { id: true }
      });
      if (puxar.length){
        await db.distributionEntry.updateMany({
          where: { id: { in: puxar.map(p => p.id) } },
          data: { state: "PENDING", scheduledFor: today }
        });
        logger.info({ puxados: puxar.length, sobraHoje: sobra, capTotal: cap?.total }, "distributeToday · pull-forward");
      }
    }
  } catch (e){
    logger.warn({ err: e.message }, "distributeToday · pull-forward falhou (segue)");
  }

  // Busca leads na fila com scheduledFor <= hoje (PENDING ou SCHEDULED)
  const fila = await db.distributionEntry.findMany({
    // 2026-06-03 · Exclui leads sem WhatsApp (noWhatsApp=true) do processamento.
    // 2026-06-12 · BUGFIX: lead JÁ ATRIBUÍDO nunca pode ser re-distribuído pela fila
    // (lead manual da Tatiana foi parar com outro corretor — entrada obsoleta na fila).
    where: { state: { in: ["PENDING", "SCHEDULED"] }, scheduledFor: { lte: today }, lead: { is: { noWhatsApp: false, assignedToId: null } } },
    include: { lead: true },
    orderBy: { scheduledFor: "asc" }
  });

  // Pré-carrega pool de associados por categoria (evita N queries por lead) · só elegíveis
  const todosAssociados = await db.associate.findMany({
    where: DISTRIBUTABLE_WHERE,
    select: { id:true, category:true, segment:true, lastActiveAt:true }
  });
  // 2026-05-12 · Regra: só recebe lead quem JÁ INTERAGIU (mandou pelo menos 1 outbound)
  const activeIds = await _filterActiveBrokerIds(todosAssociados.map(a => a.id));
  const elegiveis = todosAssociados.filter(a => activeIds.has(a.id));
  const pools = { BRONZE:[], SILVER:[], GOLD:[], DIAMOND:[] };
  for (const a of elegiveis){ if (pools[a.category]) pools[a.category].push(a); }
  logger.info({ totalApproved: todosAssociados.length, comInteracao: elegiveis.length }, "distributeToday · pool elegível");

  // Pré-carrega usedToday (quantos leads cada corretor já recebeu hoje)
  const usadoAgg = await db.distributionEntry.groupBy({
    by: ["associateId"],
    where: { state: "DISTRIBUTED", distributedAt: { gte: today }, associateId: { not: null } },
    _count: { _all: true }
  });
  const usedMap = new Map();
  for (const u of usadoAgg) if (u.associateId) usedMap.set(u.associateId, u._count._all);

  // Ordem de atacar categorias: prioridade decrescente (DIAMOND primeiro)
  const categoriasOrdenadas = ["DIAMOND","GOLD","SILVER","BRONZE"];

  for (const entry of fila){
    // Ciclo pelas categorias pela prioridade + alvo restante
    let atribuido = null;
    for (const cat of categoriasOrdenadas){
      if (distribuidos[cat] >= alvo[cat]) continue;
      const a = pickFromPool({
        segment: entry.lead.segment,
        targetCat: cat,
        pools,
        usedMap,
        rules: cap.rules
      });
      if (a){
        atribuido = a;
        distribuidos[cat]++;
        distribuidos.total++;
        usedMap.set(a.id, (usedMap.get(a.id) || 0) + 1);  // incrementa contador em memória
        break;
      }
    }

    if (atribuido){
      // Copia IDs VAI do Lead (preenchidos pelo webhook inbound) para a Conversation
      const leadFull = entry.lead;
      const convCreate = {
        leadId: entry.leadId,
        associateId: atribuido.id,
        manualFree: false,
        ...(leadFull.vaiContactId  ? { vaiContactId: leadFull.vaiContactId } : {}),
        ...(leadFull.vaiLastChatId ? { vaiConvId:    leadFull.vaiLastChatId } : {}),
        ...(leadFull.vaiLid        ? { vaiLid:       leadFull.vaiLid } : {}),
        ...(leadFull.vaiPhone      ? { vaiPhone:     leadFull.vaiPhone } : {})
      };
      const convUpdate = {
        associateId: atribuido.id,
        // 2026-06-11 · BUGFIX: conversa reaproveitada de corretor anterior chegava com
        // accepted=true herdado — novo corretor era notificado de \"lead novo\" mas nada
        // aparecia em Pendentes. Redistribuir = novo corretor precisa aceitar de novo.
        accepted: false,
        acceptedAt: null,
        ...(leadFull.vaiContactId  ? { vaiContactId: leadFull.vaiContactId } : {}),
        ...(leadFull.vaiLastChatId ? { vaiConvId:    leadFull.vaiLastChatId } : {}),
        ...(leadFull.vaiLid        ? { vaiLid:       leadFull.vaiLid } : {}),
        ...(leadFull.vaiPhone      ? { vaiPhone:     leadFull.vaiPhone } : {})
      };

      const [, , conv] = await db.$transaction([
        db.distributionEntry.update({
          where: { id: entry.id },
          data: {
            state: "DISTRIBUTED",
            distributedAt: new Date(),
            associateId: atribuido.id,
            attemptCount: { increment: 1 }
          }
        }),
        db.lead.update({
          where: { id: entry.leadId },
          data: {
            assignedToId: atribuido.id,
            assignedAt: new Date(),
            status: "NEW"
          }
        }),
        db.conversation.upsert({
          where: { leadId: entry.leadId },
          update: convUpdate,
          create: convCreate
        })
      ]);
      await audit({
        action: "LEAD_DISTRIBUTED",
        entity: `Lead:${entry.leadId}`,
        metadata: { associateId: atribuido.id, category: atribuido.category, scheduledFor: entry.scheduledFor }
      });
      // PUSH real-time · corretor vê o lead sem F5, admin vê a mudança
      let assocFull = null;
      try {
        assocFull = await db.associate.findUnique({ where: { id: atribuido.id }, select: { userId: true, user: { select: { id: true, name: true, email: true, role: true } } } });
        // Mirror da conv no chatDb (evita FK violation em chat_messages)
        try {
          chatUpsertConversation({
            id: conv.id,
            crmUserId:   assocFull?.user?.id   || null,
            crmUserName: assocFull?.user?.name || null,
            crmUserEmail: assocFull?.user?.email || null,
            crmUserRole: assocFull?.user?.role || "ASSOCIATE",
            leadId: entry.leadId, leadName: leadFull.name, leadPhoneMask: leadFull.phoneMasked || null,
            vaiChatId: leadFull.vaiLastChatId || null, vaiContactId: leadFull.vaiContactId || null,
            vaiLid: leadFull.vaiLid || null, vaiPhone: leadFull.vaiPhone || null
          });
        } catch {}
        if (assocFull?.userId){
          sseToUser(assocFull.userId, "lead.assigned", {
            leadId: entry.leadId,
            segment: entry.lead.segment,
            at: new Date().toISOString()
          });
          sseToUser(assocFull.userId, "conv.created", {
            conversationId: conv.id,
            leadId: entry.leadId,
            leadName: leadFull.name,
            source: "auto_distribution",
            at: new Date().toISOString()
          });
          // Persiste notificação para o corretor ver mesmo offline
          await db.notification.create({
            data: {
              userId: assocFull.userId,
              type: "lead_assigned",
              title: "Novo lead disponível para atendimento",
              body: `${entry.lead.name || "Lead"} · ${entry.lead.segment || "—"}`,
              link: `/corretor/chat?lead=${entry.leadId}`
            }
          }).catch(() => {});
          // Web Push · não bloqueia em falha · isolado em try/catch próprio
          sendPushToUser(assocFull.userId, {
            eventKey: "lead.distributed",
            kind: "lead_new",
            title: "🟡 Novo lead disponível",
            body: `${entry.lead.name || "Lead"} · ${entry.lead.segment || "—"}`,
            url: `/?screen=cors-leads&lead=${entry.leadId}`,
            tag: `lead-${entry.leadId}`,
            requireInteraction: true
          }).catch((e) => logger.warn({ err: e.message, userId: assocFull.userId, leadId: entry.leadId }, "push lead_new · falha não-fatal"));
          // WhatsApp template "calebe_novo_lead" · best-effort, debounced
          notifyAssociateLeadAssigned({
            associateId: atribuido.id,
            leadId: entry.leadId,
            leadName: entry.lead.name
          }).catch(() => {});
        }
        sseToAdmins("lead.distributed", {
          leadId: entry.leadId,
          associateId: atribuido.id,
          associateName: assocFull?.user?.name
        });
      } catch {}
      details.push({
        leadId: entry.leadId,
        leadName: leadFull.name,
        segment: leadFull.segment,
        associateId: atribuido.id,
        associateName: assocFull?.user?.name || "—",
        category: atribuido.category
      });

      // Bootstrap de histórico · se o lead veio com chat na VAI, importa msgs prévias
      if (leadFull.vaiLastChatId){
        const conv = await db.conversation.findUnique({ where: { leadId: entry.leadId }, select: { id: true } });
        if (conv?.id){
          bootstrapConversationHistory({
            conversationId: conv.id,
            leadId: entry.leadId,
            vaiChatId: leadFull.vaiLastChatId,
            crmUser: assocFull?.user
          }).catch(e => logger.warn({ err: e.message }, "bootstrap history (distribution) falhou"));
        }
      }
    } else {
      // Sem capacidade hoje → reagenda para próximo dia disponível
      const amanha = new Date("2099-12-31T00:00:00.000Z"); // opcao B · estaciona (nao empilha pra amanha)
      await db.distributionEntry.update({
        where: { id: entry.id },
        data: {
          state: "SCHEDULED",
          scheduledFor: amanha,
          attemptCount: { increment: 1 },
          notes: (entry.notes || "") + ` · reagendado ${today.toISOString().slice(0,10)}`
        }
      });
      reagendados.push({ leadId: entry.leadId, leadName: entry.lead.name, segment: entry.lead.segment });
      logger.debug({ leadId: entry.leadId }, "reagendado por capacidade");
    }
  }

  return { ...distribuidos, details, reagendados, queueSize: fila.length };
}

// Distribuição extra · admin puxa N leads da fila e atribui imediatamente.
// Ignora cota diária (é um ato manual do admin, fora do fluxo normal).
// Filtros opcionais: associateId (1 corretor específico) | category (qualquer desta categoria) | nenhum (qualquer APPROVED).
// Retorna { distributed, details, skipped }.
export async function distributeExtra({ count, category, associateId }){
  if (!count || count < 1) return { distributed: 0, details: [], skipped: [] };

  // 1. Valida alvo fixo se informado
  let targetAssoc = null;
  if (associateId){
    targetAssoc = await db.associate.findUnique({
      where: { id: associateId },
      include: { user: { select: { id:true, name:true } } }
    });
    if (!targetAssoc || targetAssoc.status !== "APPROVED"){
      throw Object.assign(new Error("associate_not_approved_or_not_found"), { status: 400 });
    }
  }

  // 2. Busca N entries mais antigas PENDING/SCHEDULED (FIFO)
  const fila = await db.distributionEntry.findMany({
    // 2026-06-03 · Exclui leads sem WhatsApp (noWhatsApp=true).
    // 2026-06-12 · BUGFIX: mesmo guard da fila diária — só leads SEM corretor.
    where: { state: { in: ["PENDING", "SCHEDULED"] }, lead: { is: { noWhatsApp: false, assignedToId: null } } },
    include: { lead: true },
    orderBy: { scheduledFor: "asc" },
    take: count
  });

  if (fila.length === 0) return { distributed: 0, details: [], skipped: [], queueEmpty: true };

  // 3. Pool de candidatos (cache uma vez)
  let poolCandidatos = null;
  if (!targetAssoc){
    const where = { ...DISTRIBUTABLE_WHERE };
    if (category) where.category = category;
    poolCandidatos = await db.associate.findMany({
      where,
      include: { user: { select: { id:true, name:true } } }
    });
    // 2026-05-12 · regra: só recebe lead quem já interagiu (ou foi aprovado < 7d)
    const activeIds = await _filterActiveBrokerIds(poolCandidatos.map(a => a.id));
    poolCandidatos = poolCandidatos.filter(a => activeIds.has(a.id));
    if (poolCandidatos.length === 0){
      throw Object.assign(new Error("no_associates_available"), { status: 400 });
    }
  }

  // 4. Distribui · round-robin dentro do pool (menos usado hoje primeiro)
  const today = new Date(); today.setHours(0,0,0,0);
  const usedToday = new Map();  // associateId -> count hoje
  const details = [];
  const skipped = [];
  let roundRobinIdx = 0;

  for (const entry of fila){
    let assoc;
    if (targetAssoc){
      assoc = targetAssoc;
    } else {
      // Prefere mesmo segmento · depois menor uso hoje · depois round-robin
      const segmento = entry.lead.segment;
      const sorted = [...poolCandidatos].sort((x,y) => {
        const segX = x.segment === segmento ? 0 : 1;
        const segY = y.segment === segmento ? 0 : 1;
        if (segX !== segY) return segX - segY;
        return (usedToday.get(x.id)||0) - (usedToday.get(y.id)||0);
      });
      assoc = sorted[roundRobinIdx % sorted.length];
      roundRobinIdx++;
    }

    try {
      const leadFull = entry.lead;
      const convCreate = {
        leadId: entry.leadId,
        associateId: assoc.id,
        manualFree: false,
        ...(leadFull.vaiContactId  ? { vaiContactId: leadFull.vaiContactId } : {}),
        ...(leadFull.vaiLastChatId ? { vaiConvId:    leadFull.vaiLastChatId } : {}),
        ...(leadFull.vaiLid        ? { vaiLid:       leadFull.vaiLid } : {}),
        ...(leadFull.vaiPhone      ? { vaiPhone:     leadFull.vaiPhone } : {})
      };
      const convUpdate = {
        associateId: assoc.id,
        // 2026-06-11 · BUGFIX: mesmo reset do fluxo diário — sem isso a conversa chega
        // \"pré-aceita\" ao novo corretor e não aparece em Pendentes.
        accepted: false,
        acceptedAt: null,
        ...(leadFull.vaiContactId  ? { vaiContactId: leadFull.vaiContactId } : {}),
        ...(leadFull.vaiLastChatId ? { vaiConvId:    leadFull.vaiLastChatId } : {}),
        ...(leadFull.vaiLid        ? { vaiLid:       leadFull.vaiLid } : {}),
        ...(leadFull.vaiPhone      ? { vaiPhone:     leadFull.vaiPhone } : {})
      };
      const [, , conv] = await db.$transaction([
        db.distributionEntry.update({
          where: { id: entry.id },
          data: { state: "DISTRIBUTED", distributedAt: new Date(), associateId: assoc.id, attemptCount: { increment: 1 } }
        }),
        db.lead.update({
          where: { id: entry.leadId },
          data: { assignedToId: assoc.id, assignedAt: new Date(), status: "NEW" }
        }),
        db.conversation.upsert({
          where: { leadId: entry.leadId },
          update: convUpdate,
          create: convCreate
        })
      ]);
      await audit({
        action: "LEAD_DISTRIBUTED_EXTRA",
        entity: `Lead:${entry.leadId}`,
        metadata: { associateId: assoc.id, category: assoc.category, extra: true }
      });
      // Mirror da conv no chatDb (evita FK violation em chat_messages)
      try {
        chatUpsertConversation({
          id: conv.id,
          crmUserId:   assoc.user?.id   || null,
          crmUserName: assoc.user?.name || null,
          crmUserEmail: assoc.user?.email || null,
          crmUserRole: assoc.user?.role || "ASSOCIATE",
          leadId: entry.leadId, leadName: leadFull.name, leadPhoneMask: leadFull.phoneMasked || null,
          vaiChatId: leadFull.vaiLastChatId || null, vaiContactId: leadFull.vaiContactId || null,
          vaiLid: leadFull.vaiLid || null, vaiPhone: leadFull.vaiPhone || null
        });
      } catch {}
      usedToday.set(assoc.id, (usedToday.get(assoc.id)||0) + 1);
      try {
        if (assoc.user?.id){
          sseToUser(assoc.user.id, "lead.assigned", { leadId: entry.leadId, segment: leadFull.segment, at: new Date().toISOString() });
          sseToUser(assoc.user.id, "conv.created", {
            conversationId: conv.id,
            leadId: entry.leadId,
            leadName: leadFull.name,
            source: "extra_distribution",
            at: new Date().toISOString()
          });
          await db.notification.create({
            data: {
              userId: assoc.user.id,
              type: "lead_assigned",
              title: "Novo lead disponível para atendimento",
              body: `${leadFull.name || "Lead"} · ${leadFull.segment || "—"}`,
              link: `/corretor/chat?lead=${entry.leadId}`
            }
          }).catch(() => {});
          sendPushToUser(assoc.user.id, {
            eventKey: "lead.distributed_extra",
            kind: "lead_new",
            title: "🟡 Novo lead disponível",
            body: `${leadFull.name || "Lead"} · ${leadFull.segment || "—"}`,
            url: `/?screen=cors-leads&lead=${entry.leadId}`,
            tag: `lead-${entry.leadId}`,
            requireInteraction: true
          }).catch((e) => logger.warn({ err: e.message, userId: assoc.user.id, leadId: entry.leadId }, "push lead_new (extra) · falha não-fatal"));
          // WhatsApp template "calebe_novo_lead" · best-effort, debounced
          notifyAssociateLeadAssigned({
            associateId: assoc.id,
            leadId: entry.leadId,
            leadName: leadFull.name
          }).catch(() => {});
        }
        sseToAdmins("lead.distributed", { leadId: entry.leadId, associateId: assoc.id, associateName: assoc.user?.name });
      } catch {}
      details.push({
        leadId: entry.leadId,
        leadName: leadFull.name,
        segment: leadFull.segment,
        associateId: assoc.id,
        associateName: assoc.user?.name || "—",
        category: assoc.category
      });
    } catch (e){
      logger.warn({ err: e.message, leadId: entry.leadId }, "distributeExtra · falha ao atribuir");
      skipped.push({ leadId: entry.leadId, reason: e.message });
    }
  }

  // 5. Reorganiza · puxa SCHEDULED de dias futuros pra preencher dias vazios.
  // Estratégia simples: SCHEDULED mais antigos viram PENDING pra hoje, até capacidade total.
  try {
    const { total } = await getDailyCapacity();
    const hojeCount = await db.distributionEntry.count({
      where: { state: "PENDING", scheduledFor: today }
    });
    const sobra = Math.max(0, total - hojeCount);
    if (sobra > 0){
      const puxar = await db.distributionEntry.findMany({
        where: { state: "SCHEDULED", scheduledFor: { gt: today } },
        orderBy: { scheduledFor: "asc" },
        take: sobra
      });
      if (puxar.length){
        await db.distributionEntry.updateMany({
          where: { id: { in: puxar.map(p => p.id) } },
          data: { state: "PENDING", scheduledFor: today }
        });
        logger.info({ puxados: puxar.length, sobraHoje: sobra }, "distributeExtra · reorganização");
      }
    }
  } catch (e){
    logger.warn({ err: e.message }, "distributeExtra · reorganização falhou (segue)");
  }

  return { distributed: details.length, details, skipped, queueSize: fila.length };
}

// Enfileira um NOVO lead · agenda para o primeiro dia com espaço
export async function enqueueLead(leadId){
  // 2026-06-03 · Nunca enfileira lead sem WhatsApp (noWhatsApp=true).
  // 2026-06-12 · Nem lead que JÁ TEM corretor (transferir exige desatribuir antes),
  // nem lead que já está na fila (evita entrada duplicada).
  const _lead = await db.lead.findUnique({ where: { id: leadId }, select: { noWhatsApp: true, assignedToId: true } });
  if (_lead?.noWhatsApp){
    logger.info({ leadId }, "📵 enqueueLead · lead sem WhatsApp · não enfileirado");
    return null;
  }
  if (_lead?.assignedToId){
    logger.warn({ leadId, assignedToId: _lead.assignedToId }, "🚫 enqueueLead · lead já atribuído a corretor · não enfileirado");
    return null;
  }
  const _dupe = await db.distributionEntry.findFirst({ where: { leadId, state: { in: ["PENDING", "SCHEDULED"] } }, select: { id: true } });
  if (_dupe){
    logger.info({ leadId, entryId: _dupe.id }, "enqueueLead · já na fila · não duplica");
    return null;
  }
  const today = new Date(); today.setHours(0,0,0,0);
  const { total } = await getDailyCapacity();
  // Conta por dia agendado (PENDING + SCHEDULED)
  const porDia = await db.distributionEntry.groupBy({
    by: ["scheduledFor"],
    where: { state: { in: ["PENDING", "SCHEDULED"] } },
    _count: { _all: true }
  });
  const mapa = Object.fromEntries(porDia.map(r => [r.scheduledFor.toISOString().slice(0,10), r._count._all]));
  // Acha primeiro dia com espaço
  const dia = new Date(today);
  for (let i = 0; i < 60; i++){  // máx 60 dias de agendamento · proteção
    const iso = dia.toISOString().slice(0,10);
    if ((mapa[iso] || 0) < total){
      await db.distributionEntry.create({
        data: { leadId, scheduledFor: dia, state: i === 0 ? "PENDING" : "SCHEDULED" }
      });
      return dia;
    }
    dia.setDate(dia.getDate()+1);
  }
  // fallback — agenda 60 dias à frente mesmo estourando
  await db.distributionEntry.create({ data: { leadId, scheduledFor: dia, state: "SCHEDULED" } });
  return dia;
}
