// =============================================================================
// jobs/campaignRoletaWorker.js · 2026-07-02 · ROLETA DE CAMPANHA (Fase 2)
//
// Cliente respondeu a um disparo de campanha → precisa de atendimento RÁPIDO:
//   - lead com dono ONLINE → dono tem 5min pra atender ("holding")
//   - lead sem dono / dono offline → vai pro corretor ONLINE com menos carga
//   - não atendeu em 5min → repassa pro próximo online (até 6 tentativas)
//
// "Atendeu" = aceitou a conversa OU mandou mensagem após receber o lead.
// "Online"  = User.lastSeenAt < 5min (mesmo critério do admin /corretores).
// Opera só na janela 07:30–19:00 BRT (regra da casa) — fora dela congela.
// Reassign SEMPRE: reseta accepted (regra crítica) + loga RedistributionLog.
// PM2 cluster: só a instância 0 executa (padrão dos outros workers).
// =============================================================================
import { db } from "../db.js";
import { logger } from "../utils/logger.js";
import { notifyAssociateLeadAssigned } from "../services/associateNotifier.js";

const TICK_MS = 60_000;
const HOLD_MIN = Number(process.env.ROLETA_HOLD_MINUTES || 5);
const MAX_ATTEMPTS = Number(process.env.ROLETA_MAX_ATTEMPTS || 6);
const ENABLED = process.env.CAMPAIGN_ROLETA_ENABLED !== "false"; // default ON

function dentroJanelaBRT(){
  const now = new Date();
  const brt = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const min = brt.getHours() * 60 + brt.getMinutes();
  return min >= 450 && min < 1140; // 07:30–19:00
}

async function isOnline(associateId){
  if (!associateId) return false;
  const r = await db.$queryRawUnsafe(`
    SELECT 1 FROM "Associate" a JOIN "User" u ON u.id = a."userId"
    WHERE a.id = $1 AND a.status = 'APPROVED' AND u."lastSeenAt" > now() - interval '5 minutes'
    LIMIT 1
  `, associateId);
  return r.length > 0;
}

async function pickOnline(excludeIds){
  const rows = await db.$queryRawUnsafe(`
    SELECT a.id, u.name FROM "Associate" a
    JOIN "User" u ON u.id = a."userId"
    WHERE a.status = 'APPROVED' AND a."isInternalSupport" = false
      AND u."lastSeenAt" > now() - interval '5 minutes'
      AND u.name NOT ILIKE '%review%' AND u.email NOT ILIKE '%review%' -- conta Apple Review (App Store) NUNCA recebe lead
      AND NOT (a.id = ANY($1::text[]))
    ORDER BY (
      SELECT COUNT(*) FROM "Lead" l
      WHERE l."assignedToId" = a.id AND l."discardedAt" IS NULL
        AND l.status IN ('NEW','QUALIFYING','NEGOTIATING')
    ) ASC, u."lastSeenAt" DESC
    LIMIT 1
  `, excludeIds.length ? excludeIds : ["_none_"]);
  return rows[0] || null;
}

async function attended(rec){
  // aceitou a conversa OU mandou msg depois de receber o lead na roleta
  const r = await db.$queryRawUnsafe(`
    SELECT 1 FROM "Conversation" c
    WHERE c."leadId" = $1 AND (
      (c."acceptedAt" IS NOT NULL AND c."acceptedAt" > $2)
      OR EXISTS (
        SELECT 1 FROM "Message" m
        WHERE m."conversationId" = c.id AND m.direction = 'outbound'
          AND m."fromRole" = 'associate' AND m."createdAt" > $2
      )
    ) LIMIT 1
  `, rec.leadId, rec.roletaAssignedAt);
  return r.length > 0;
}

async function spin(rec, motivo){
  const tried = [...(rec.roletaTried || [])];
  if (rec.roletaHolderId && !tried.includes(rec.roletaHolderId)) tried.push(rec.roletaHolderId);

  const alvo = await pickOnline(tried);
  if (!alvo){
    // ninguém online disponível — mantém como está e tenta no próximo tick
    logger.info({ leadId: rec.leadId }, "🎡 roleta · sem corretor online disponível · aguardando");
    return;
  }

  const lead = await db.lead.findUnique({ where: { id: rec.leadId }, select: { id: true, name: true, assignedToId: true } });
  if (!lead) { await close(rec, "exhausted"); return; }

  // reatribui: lead + conversa (accepted RESETADO — regra crítica) + trilha
  await db.lead.update({ where: { id: lead.id }, data: { assignedToId: alvo.id, assignedAt: new Date(), updatedAt: new Date() } });
  const conv = await db.conversation.findFirst({ where: { leadId: lead.id }, orderBy: { lastMessageAt: "desc" } });
  if (conv){
    await db.conversation.update({ where: { id: conv.id }, data: { associateId: alvo.id, accepted: false, acceptedAt: null } });
  }
  await db.redistributionLog.create({
    data: { leadId: lead.id, previousAssociateId: lead.assignedToId || "roleta_sem_dono", newAssociateId: alvo.id, reason: `roleta_campanha · ${motivo}`, attempt: (rec.roletaAttempts || 0) + 1 }
  }).catch(() => {});
  await db.campaignRecipient.update({
    where: { id: rec.id },
    data: { roletaStatus: "spinning", roletaHolderId: alvo.id, roletaAssignedAt: new Date(), roletaAttempts: { increment: 1 }, roletaTried: tried }
  });
  notifyAssociateLeadAssigned({ associateId: alvo.id, leadId: lead.id, leadName: `${lead.name} respondeu — atenda em 5 min!` }).catch(() => {});
  logger.info({ leadId: lead.id, leadName: lead.name, para: alvo.name, tentativa: (rec.roletaAttempts || 0) + 1, motivo }, "🎡 roleta · lead repassado a corretor online");
}

async function close(rec, status){
  await db.campaignRecipient.update({ where: { id: rec.id }, data: { roletaStatus: status } });
}

async function tick(){
  if (!ENABLED || !dentroJanelaBRT()) return;
  try {
    const ativos = await db.campaignRecipient.findMany({
      where: { roletaStatus: { in: ["pending", "holding", "spinning"] } },
      orderBy: { roletaAssignedAt: "asc" },
      take: 50
    });
    for (const rec of ativos){
      // 1) já foi atendido? encerra com sucesso
      if (rec.roletaAssignedAt && await attended(rec)){
        await close(rec, "attended");
        logger.info({ leadId: rec.leadId }, "🎡 roleta · atendido ✅");
        continue;
      }
      // 2) esgotou tentativas — fica com o último holder
      if ((rec.roletaAttempts || 0) >= MAX_ATTEMPTS){
        await close(rec, "exhausted");
        logger.warn({ leadId: rec.leadId, tentativas: rec.roletaAttempts }, "🎡 roleta · esgotada sem atendimento");
        continue;
      }
      const idadeMin = rec.roletaAssignedAt ? (Date.now() - new Date(rec.roletaAssignedAt).getTime()) / 60000 : 999;
      if (rec.roletaStatus === "pending"){
        // entrada: dono online segura por 5min; senão gira já
        if (rec.roletaHolderId && await isOnline(rec.roletaHolderId)){
          await db.campaignRecipient.update({ where: { id: rec.id }, data: { roletaStatus: "holding", roletaAssignedAt: new Date() } });
          logger.info({ leadId: rec.leadId }, "🎡 roleta · dono online — 5min pra atender");
        } else {
          await spin(rec, "dono offline ou sem dono");
        }
      } else if (idadeMin >= HOLD_MIN){
        await spin(rec, `sem atendimento em ${HOLD_MIN}min`);
      }
    }
  } catch (e){
    logger.error({ err: e.message }, "roleta · exceção no tick");
  }
}

export function startCampaignRoletaWorker(){
  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== "0"){
    logger.info({ instance: process.env.NODE_APP_INSTANCE }, "🎡 roleta worker · standby (só instância 0 executa)");
    return;
  }
  logger.info({ enabled: ENABLED, holdMin: HOLD_MIN, maxAttempts: MAX_ATTEMPTS }, "🎡 campaign roleta worker iniciado");
  setInterval(tick, TICK_MS);
}
