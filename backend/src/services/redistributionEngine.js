// =============================================================================
// Redistribuição Automática por Inatividade
//
// Regras:
// - Se associado não interagiu (sem firstContactAt) em inatividadeMinutos → redistribui
// - Lead manual NUNCA redistribui (origin = MANUAL)
// - Lead já atendido (firstContactAt preenchido) também NÃO
// - Limite de maxRedistribuicoes por lead · evita loop
// - Cada redistribuição grava RedistributionLog + AuditEvent
// =============================================================================
import { db } from "../db.js";
import { audit } from "../utils/audit.js";
import { logger } from "../utils/logger.js";
import { notifyAssociateLeadAssigned } from "./associateNotifier.js";
import { sendPushToUser } from "./push.js";
import { getDailyCapacity, computeTargetMix, DISTRIBUTABLE_WHERE, filterActiveBrokerIds } from "./distributionEngine.js";

async function getSetting(key, fallback){
  const s = await db.systemSetting.findUnique({ where: { key } });
  return s?.value ?? fallback;
}

function minutesSince(date){
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
}

// Ordem fixa de prioridade · DIAMOND primeiro pela hierarquia de categoria
const CATEGORIAS_ORDENADAS = ["DIAMOND","GOLD","SILVER","BRONZE"];

// Escolhe próximo associado respeitando: alvo restante por categoria (mix %),
// match de segmento, cota diária. Fallback final: qualquer APPROVED com cota sobrando.
async function pickRedistributionTarget({ segment, excludeId, alvoRestante, rulesByCat }){
  const today = new Date(); today.setHours(0,0,0,0);
  // 2026-05-13 · aplica mesma regra da distribuicao: APPROVED + lastLogin != null
  // + já interagiu (com grace 7d). Sem isso, redistribuicao caia em corretor
  // inativo, repetindo o bug que causou os 4395 leads orfaos.
  // Passo 1: tenta categorias na ordem de prioridade que ainda têm alvo a bater.
  for (const cat of CATEGORIAS_ORDENADAS){
    if (!alvoRestante || (alvoRestante[cat] ?? 0) <= 0) continue;
    let candidatos = await db.associate.findMany({
      where: { ...DISTRIBUTABLE_WHERE, id: { not: excludeId || undefined }, category: cat }
    });
    if (candidatos.length){
      const activeIds = await filterActiveBrokerIds(candidatos.map(a => a.id));
      candidatos = candidatos.filter(a => activeIds.has(a.id));
    }
    // Mesmo segmento primeiro · depois mais ativo (lastActiveAt mais recente).
    candidatos.sort((x,y) => {
      const segX = x.segment === segment ? 0 : 1;
      const segY = y.segment === segment ? 0 : 1;
      if (segX !== segY) return segX - segY;
      return (y.lastActiveAt?.getTime() || 0) - (x.lastActiveAt?.getTime() || 0);
    });
    for (const a of candidatos){
      const used = await db.distributionEntry.count({
        where: { associateId: a.id, state: "DISTRIBUTED", distributedAt: { gte: today } }
      });
      const cota = rulesByCat[a.category]?.dailyQuota || 1;
      if (used < cota) return { assoc: a, category: cat };
    }
  }
  // Passo 2: fallback — alvo lotado, procura qualquer APPROVED com cota sobrando
  // Ordena por menor USO HOJE primeiro (fairness), não por categoria fixa.
  // 2026-05-13 · mesma regra (login + interagiu) tambem no fallback.
  let todos = await db.associate.findMany({
    where: { ...DISTRIBUTABLE_WHERE, id: { not: excludeId || undefined } }
  });
  if (todos.length){
    const activeIds = await filterActiveBrokerIds(todos.map(a => a.id));
    todos = todos.filter(a => activeIds.has(a.id));
  }
  const usadoAgg = await db.distributionEntry.groupBy({
    by: ["associateId"],
    where: { state: "DISTRIBUTED", distributedAt: { gte: today }, associateId: { in: todos.map(a=>a.id) } },
    _count: { _all: true }
  });
  const usedMap = new Map(usadoAgg.map(u => [u.associateId, u._count._all]));
  // Também conta Lead.assignedToId atual (inclui redistribuições que não criaram DistributionEntry)
  const leadsPor = await db.lead.groupBy({
    by: ["assignedToId"],
    where: { assignedToId: { in: todos.map(a=>a.id) }, assignedAt: { gte: today } },
    _count: { _all: true }
  });
  for (const l of leadsPor){
    if (l.assignedToId){
      usedMap.set(l.assignedToId, Math.max(usedMap.get(l.assignedToId) || 0, l._count._all));
    }
  }
  const sorted = [...todos].sort((x,y) => {
    const uX = usedMap.get(x.id) || 0;
    const uY = usedMap.get(y.id) || 0;
    if (uX !== uY) return uX - uY;  // menos usado primeiro (round-robin justo)
    const segX = x.segment === segment ? 0 : 1;
    const segY = y.segment === segment ? 0 : 1;
    return segX - segY;
  });
  for (const a of sorted){
    const used = usedMap.get(a.id) || 0;
    const cota = rulesByCat[a.category]?.dailyQuota || 1;
    if (used < cota) return { assoc: a, category: a.category };
  }
  // Sem capacidade em ninguém → NÃO redistribui · lead fica com o corretor atual.
  // (Evita acumular 200 leads no mesmo corretor quando ninguém tem cota.)
  return null;
}

// Redistribui um lead específico · retorna { ok, previous, next, category }
// Aceita `alvoRestante` e `rulesByCat` opcionais. Se não vier, busca do banco
// (retrocompat para chamadas fora do sweep).
export async function redistributeLead({ leadId, reason, alvoRestante, rulesByCat }){
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { ok: false, reason: "lead_not_found" };
  if (lead.origin === "MANUAL") return { ok: false, reason: "manual_lead" };
  if (lead.firstContactAt) return { ok: false, reason: "already_contacted" };

  const max = Number(await getSetting("inactivity.maxRedistributions", 3));
  if (lead.redistributionCount >= max) return { ok: false, reason: "max_attempts_reached" };

  // Se o chamador não passou regras/alvo, carrega aqui (chamadas isoladas)
  let rules = rulesByCat;
  let alvo = alvoRestante;
  if (!rules){
    const rs = await db.distributionRule.findMany();
    rules = Object.fromEntries(rs.map(r => [r.category, r]));
  }
  const escolha = await pickRedistributionTarget({
    segment: lead.segment,
    excludeId: lead.assignedToId,
    alvoRestante: alvo,
    rulesByCat: rules
  });
  if (!escolha?.assoc) return { ok: false, reason: "no_associate_available" };
  const novo = escolha.assoc;
  const categoriaEscolhida = escolha.category;

  const anterior = lead.assignedToId;
  const tentativa = lead.redistributionCount + 1;

  // Atualiza também a DistributionEntry DISTRIBUTED mais recente desse lead — evita
  // divergência entre Lead.assignedToId e DistributionEntry.associateId.
  const entry = await db.distributionEntry.findFirst({
    where: { leadId, state: "DISTRIBUTED" },
    orderBy: { distributedAt: "desc" }
  });

  const ops = [
    db.lead.update({
      where: { id: leadId },
      data: {
        assignedToId: novo.id,
        assignedAt: new Date(),
        firstContactAt: null,
        redistributionCount: tentativa,
        lastRedistributionAt: new Date()
      }
    }),
    db.redistributionLog.create({
      data: { leadId, previousAssociateId: anterior, newAssociateId: novo.id, reason, attempt: tentativa }
    })
  ];
  if (entry){
    ops.push(db.distributionEntry.update({
      where: { id: entry.id },
      data: { associateId: novo.id, distributedAt: new Date() }
    }));
  }
  // 2026-06-04 · Regra do produto: se o LEAD NUNCA respondeu (nenhum inbound),
  // o histórico de mensagens NÃO vai junto pro novo corretor. Evita o caso
  // "corretor 2 abre conversa e lê 'Me chamo Jonniver Paulo'" — texto enviado
  // pelo corretor 1, que confunde quem assume. Se já houve inbound, mantém
  // tudo (o novo corretor PRECISA saber o que o cliente falou antes).
  // 2026-06-07 · NAO apaga mais o historico na redistribuicao — preserva tudo p/ o admin.
  // O corretor que recebe o lead NAO ve as mensagens anteriores a transferencia: a
  // ocultacao e por VISIBILIDADE no GET /:id/messages (corte por RedistributionLog),
  // sem delecao. Reversivel via HIDE_PRE_TRANSFER_HISTORY=0.
  let limpouHistorico = false;
  ops.push(db.conversation.updateMany({
    where: { leadId },
    data: { associateId: novo.id }
  }));
  await db.$transaction(ops);

  await audit({
    action: "LEAD_REDISTRIBUTED",
    entity: `Lead:${leadId}`,
    metadata: { from: anterior, to: novo.id, category: categoriaEscolhida, reason, attempt: tentativa, historyCleared: limpouHistorico }
  });

  // 2026-05-15 · Notifica corretor novo via WhatsApp (calebe_novo_lead).
  // Faltava aqui · so distributionEngine notificava na primeira distribuicao.
  notifyAssociateLeadAssigned({
    associateId: novo.id,
    leadId,
    leadName: lead.name
  }).catch(e => logger.warn({ err: e?.message, leadId, novoId: novo.id }, "notify redistributed nao-fatal"));

  // 2026-06-22 · Push pro corretor que recebeu o lead redistribuído (best-effort).
  try {
    const assocFull = await db.associate.findUnique({ where: { id: novo.id }, select: { userId: true } });
    if (assocFull?.userId){
      sendPushToUser(assocFull.userId, {
        eventKey: "lead.redistributed",
        kind: "lead_new",
        title: "🔄 Lead redistribuído pra você",
        body: `${lead.name || "Lead"} · seja rápido pra atender`,
        url: `/?screen=cors-leads&lead=${leadId}`,
        tag: `lead-${leadId}`,
        requireInteraction: true,
      }).catch(()=>{});
    }
  } catch (e) {
    logger.warn({ err: e?.message, leadId, novoId: novo.id }, "push redistributed nao-fatal");
  }

  return { ok: true, previous: anterior, next: novo.id, category: categoriaEscolhida, attempt: tentativa };
}

// Hora minima para o sweep de inatividade processar (formato 24h, BRT).
// Igual ao DAILY_RUN_MIN_HOUR de distributionEngine.js · garante que nenhum
// corretor recebe lead (novo OU redistribuido) durante a madrugada.
// Antes desse horario, sweepInactivity retorna early sem redistribuir.
const REDIST_MIN_HOUR = 8;

// Varredura completa · identifica candidatos e redistribui respeitando mix %.
export async function sweepInactivity(){
  // 2026-06-09 · Redistribuição automática DESATIVADA permanentemente a pedido do admin.
  // Leads NUNCA são removidos de corretores automaticamente por inatividade.
  return { processed: 0, redistributed: 0, disabled: "permanent" };

  // Guard de horario · nao redistribui antes das 08:00 BRT.
  // Mesmo padrao usado em distributeToday() (distributionEngine.js linha ~97).
  // Worker continua girando a cada 60s · só nao processa fora da janela.
  if (new Date().getHours() < REDIST_MIN_HOUR){  // eslint-disable-line no-unreachable
    return { processed: 0, redistributed: 0, deferred: `before_${String(REDIST_MIN_HOUR).padStart(2,"0")}h` };
  }
  const rawAtivo = await getSetting("inactivity.active", true);
  const ativo = rawAtivo === true || rawAtivo === "true";
  if (!ativo) return { processed: 0, redistributed: 0 };
  const minutos = Number(await getSetting("inactivity.minutes", 20));
  const cutoff = new Date(Date.now() - minutos * 60_000);

  // Candidatos: tem assignedAt antigo + sem firstContactAt + NÃO manual + status ativo
  const candidatos = await db.lead.findMany({
    where: {
      origin: { not: "MANUAL" },
      firstContactAt: null,
      assignedAt: { lte: cutoff },
      status: { in: ["NEW", "QUALIFYING"] }
    },
    take: 200  // lote seguro
  });

  if (candidatos.length === 0){
    logger.info({ processed: 0, redistributed: 0 }, "sweep inactivity");
    return { processed: 0, redistributed: 0 };
  }

  // Prepara alvo por categoria (mix %) e subtrai o que já foi distribuído hoje.
  const { alvo, cap } = await computeTargetMix();
  const rulesByCat = cap.rules;
  const today = new Date(); today.setHours(0,0,0,0);
  const distHoje = await db.distributionEntry.groupBy({
    by: ["associateId"],
    where: { state: "DISTRIBUTED", distributedAt: { gte: today } },
    _count: { _all: true }
  });
  const assocIds = distHoje.map(r => r.associateId).filter(Boolean);
  const assocs = assocIds.length
    ? await db.associate.findMany({ where: { id: { in: assocIds } }, select: { id:true, category:true } })
    : [];
  const catById = Object.fromEntries(assocs.map(a => [a.id, a.category]));
  const jaDist = { BRONZE:0, SILVER:0, GOLD:0, DIAMOND:0 };
  for (const r of distHoje){
    const cat = catById[r.associateId];
    if (cat) jaDist[cat] += r._count._all;
  }
  const alvoRestante = {
    BRONZE:  Math.max(0, (alvo.BRONZE  || 0) - jaDist.BRONZE),
    SILVER:  Math.max(0, (alvo.SILVER  || 0) - jaDist.SILVER),
    GOLD:    Math.max(0, (alvo.GOLD    || 0) - jaDist.GOLD),
    DIAMOND: Math.max(0, (alvo.DIAMOND || 0) - jaDist.DIAMOND)
  };

  let redistributed = 0;
  for (const lead of candidatos){
    const r = await redistributeLead({
      leadId: lead.id,
      reason: `inactivity · ${minutesSince(lead.assignedAt)}min · no_response`,
      alvoRestante,
      rulesByCat
    });
    if (r.ok){
      redistributed++;
      if (r.category && alvoRestante[r.category] > 0) alvoRestante[r.category]--;
    }
  }
  logger.info({ processed: candidatos.length, redistributed, alvo, restante: alvoRestante }, "sweep inactivity");
  return { processed: candidatos.length, redistributed };
}
