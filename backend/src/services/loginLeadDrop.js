// =============================================================================
// services/loginLeadDrop.js · 2026-06-03
// Drop automático de leads quando o corretor loga na plataforma.
//
// Regra: todo corretor APPROVED que loga recebe um lote de N leads (default 30),
// UMA VEZ por dia (controlado por Associate.lastBulkDropAt). Atômico contra
// logins concorrentes (login + refresh disparam, mas só 1 ganha o claim do dia).
//
// Janela de envio do template: 07:30-19:00 BRT (alinhado com as demais regras).
// Fora da janela: os leads são ATRIBUÍDOS mesmo assim (corretor vê na lista),
// mas o template de saudação não é disparado (não incomoda o cliente de madrugada).
// =============================================================================
import { db } from "../db.js";
import { logger } from "../utils/logger.js";
import { notifyAssociateLeadAssigned } from "./associateNotifier.js";
// 2026-06-03 · modo assign-only · não envia template (sendTemplate/crypto removidos).

const PER_DROP = Number(process.env.LOGIN_DROP_SIZE || 30);
// 2026-06-03 · teto de carga: NÃO empurra leads pra corretor que já tem muito
// (evita pilha de 100+ leads que ninguém consegue trabalhar). 0/ausente = sem teto.
const MAX_LEAD_LOAD = Number(process.env.LOGIN_DROP_MAX_LEAD_LOAD || 60);

/**
 * Dispara o drop de leads no login. Best-effort, NUNCA lança.
 * Deve ser chamado em background (sem await) a partir do login/refresh.
 */
export async function dropLeadsOnLogin(associateId){
  if (!associateId) return;
  // 2026-06-03 · PAUSÁVEL via env. LOGIN_DROP_SIZE=0 → desliga o drop automático.
  if (!(PER_DROP > 0)) return;
  try {
    // 1) CLAIM ATÔMICO do dia · só 1 chamada por dia ganha (evita duplo-disparo
    //    de login+refresh concorrentes). Usa SQL puro pra atomicidade.
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const claim = await db.$queryRawUnsafe(`
      UPDATE "Associate"
      SET "lastBulkDropAt" = NOW()
      WHERE id = $1
        AND status = 'APPROVED'
        AND ("lastBulkDropAt" IS NULL OR "lastBulkDropAt" < $2)
      RETURNING id
    `, associateId, today0);

    if (!claim || claim.length === 0){
      return; // já recebeu hoje OU não é APPROVED · silencioso
    }

    // 1.5) TETO DE CARGA · não empurra mais leads pra quem já tem muito.
    if (MAX_LEAD_LOAD > 0){
      const load = await db.lead.count({ where: { assignedToId: associateId, discardedAt: null } });
      if (load >= MAX_LEAD_LOAD){
        logger.info({ associateId, load, max: MAX_LEAD_LOAD }, "📦 login_drop · corretor já no teto de leads · não dropou");
        return;
      }
    }

    // 2) Já tem 30 leads sem contato recentes? (idempotência extra)
    const need = PER_DROP;

    // 3) Reivindica até `need` leads do pool · atômico (SKIP LOCKED)
    const claimed = await db.$queryRawUnsafe(`
      WITH picked AS (
        SELECT id FROM "Lead"
        WHERE "assignedToId" IS NULL
          AND status = 'NEW'
          AND "firstContactAt" IS NULL
          AND "discardedAt" IS NULL
          AND origin <> 'MANUAL'
          AND "phoneEncrypted" IS NOT NULL
          AND "noWhatsApp" = false
        ORDER BY "createdAt" DESC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "Lead" l
      SET "assignedToId" = $1, "assignedAt" = NOW(), "updatedAt" = NOW()
      FROM picked p WHERE l.id = p.id
      RETURNING l.id, l.name, l."phoneEncrypted" AS phone_enc
    `, associateId, need);

    if (!claimed || claimed.length === 0){
      logger.info({ associateId }, "📦 login_drop · pool vazio · nada atribuído");
      return;
    }

    logger.info({ associateId, atribuidos: claimed.length }, "📦 login_drop · leads atribuídos");

    // 4) Cria conversa para cada lead atribuído.
    // 2026-06-03 · NÃO dispara mais template de saudação automaticamente.
    //   Motivo: 30 templates de marketing × N corretores saturava o limite da Meta
    //   (erro 131049 throttle). Os leads são atribuídos e o corretor envia a
    //   abordagem quando quiser (espaçado), preservando a qualidade do número.
    for (const lead of claimed){
      const conv = await db.conversation.findFirst({ where: { leadId: lead.id } });
      if (!conv){
        await db.conversation.create({ data: { leadId: lead.id, associateId } });
      } else if (conv.associateId !== associateId){
        await db.conversation.update({ where: { id: conv.id }, data: { associateId } });
      }
    }

    logger.info({ associateId, atribuidos: claimed.length, modo: "assign_only" }, "✅ login_drop · concluído (sem auto-envio)");

    // 2026-06-11 · avisa o CORRETOR via WhatsApp (1 template UTILITY resumo, NAO 30).
    // Resolve o "corretor nao recebe aviso de novo lead" sem estourar o limite da Meta.
    try {
      const resumo = claimed.length === 1
        ? (claimed[0].name || "um novo lead")
        : `${claimed.length} novos leads`;
      notifyAssociateLeadAssigned({ associateId, leadId: claimed[0].id, leadName: resumo }).catch(() => {});
    } catch { /* best-effort */ }
  } catch (e){
    logger.error({ err: e.message, associateId }, "login_drop · exceção");
  }
}
