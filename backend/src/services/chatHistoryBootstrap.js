// =============================================================================
// Bootstrap de histórico · importa mensagens da VAI para o CRM quando uma
// Conversation é criada pela distribuição após já ter havido conversa na VAI.
// =============================================================================
import { db } from "../db.js";
import { vaiListChatMessages } from "./vaiClient.js";
import { chatUpsertConversation, chatInsertMessage } from "../chatDb.js";
import { logger } from "../utils/logger.js";

/**
 * Importa até 100 mensagens prévias da VAI para a Conversation recém-criada.
 * Idempotente · dedup por vaiMessageId E por (conv ja ter mensagens · evita
 * re-bootstrap em redistribuicao quando msgs antigas estavam sem vaiMessageId).
 *
 * Filtra mensagens com contentType="activity" (ex: "Ricardo iniciou o atendimento")
 * que sao eventos de sistema VAI · nao sao mensagens reais lead/corretor.
 *
 * Regra de direction (corrigida em 2026-04-29):
 *   - m.fromMe === true OU m.isOwn === true → outbound (msg da nossa conta VAI)
 *   - m.direction === "outbound"           → outbound (campo explicito)
 *   - m.sender === "contact" / "customer"  → inbound  (lead respondeu)
 *   - default                              → inbound  (conservador · evita
 *     marcar lead msg como nossa quando schema da API nao bate)
 */
export async function bootstrapConversationHistory({ conversationId, leadId, vaiChatId, crmUser }){
  if (!conversationId || !vaiChatId) return { imported: 0, skipped: "no_ids" };
  try {
    // GUARD: se a conv ja tem mensagens, nao roda de novo · evita re-bootstrap
    // em redistribuicao do lead (caso Guilherme Gregório · 2026-04-28).
    const existingCount = await db.message.count({ where: { conversationId } });
    if (existingCount > 0){
      logger.info({ conversationId, vaiChatId, existingCount }, "  ↳ bootstrap pulado · conv ja tem mensagens");
      return { imported: 0, skipped: "already_has_messages", existingCount };
    }

    const list = await vaiListChatMessages(vaiChatId, { limit: "100" });
    const msgs = Array.isArray(list) ? list : (list?.data || []);
    if (!msgs.length) return { imported: 0, skipped: "empty" };

    // Ordena cronologicamente (VAI geralmente vem desc)
    msgs.sort((a, b) => new Date(a.createdAt || a.timestamp) - new Date(b.createdAt || b.timestamp));

    // Pega IDs ja gravados no db principal pra evitar duplicatas (defensivo · ja
    // existe o guard de existingCount, mas mantemos pra robustez se outro path
    // inseriu msgs com vaiMessageId entre o count e o create).
    const existingIds = new Set(
      (await db.message.findMany({
        where: { conversationId, vaiMessageId: { not: null } },
        select: { vaiMessageId: true }
      })).map(m => m.vaiMessageId)
    );

    let imported = 0, skippedActivity = 0;
    for (const m of msgs){
      if (!m.id || existingIds.has(m.id)) continue;
      // Filtra eventos de sistema (start-service, close, etc) · nao sao mensagens
      const ctype = m.type || "text";
      if (ctype === "activity" || ctype === "system" || ctype === "event"){
        skippedActivity++; continue;
      }
      // Regra de direction · ver doc da funcao acima
      const isOutbound = (m.fromMe === true || m.isOwn === true || m.direction === "outbound");
      const direction = isOutbound ? "outbound" : "inbound";
      const when = new Date(m.createdAt || m.timestamp || Date.now());
      await db.message.create({
        data: {
          conversationId,
          direction,
          fromRole: direction === "inbound" ? "lead" : "associate",
          text: String(m.content || m.text || ""),
          contentType: ctype,
          ...(m.fileUrl  ? { fileUrl:  m.fileUrl }  : {}),
          ...(m.mimeType ? { mimeType: m.mimeType } : {}),
          vaiMessageId: m.id,
          deliveredAt: when,
          createdAt: when
        }
      });
      chatInsertMessage({
        conversationId,
        direction,
        fromRole: direction === "inbound" ? "lead" : "associate",
        senderUserId: direction === "outbound" ? crmUser?.id : null,
        senderName:   direction === "outbound" ? crmUser?.name : null,
        content: String(m.content || m.text || ""),
        contentType: ctype,
        fileUrl: m.fileUrl || null,
        vaiMessageId: m.id,
        metadata: m,
        deliveredAt: when
      });
      imported++;
    }

    // Upsert da conversa no chat DB (mantém owner se já tinha)
    chatUpsertConversation({
      id: conversationId,
      leadId,
      vaiChatId,
      crmUserId:    crmUser?.id || null,
      crmUserEmail: crmUser?.email || null,
      crmUserName:  crmUser?.name || null,
      crmUserRole:  crmUser?.role || null,
      firstMessageAt: msgs[0] ? new Date(msgs[0].createdAt || msgs[0].timestamp) : null
    });

    // Atualiza lastMessageAt da Conversation principal
    if (imported > 0){
      const last = msgs[msgs.length - 1];
      await db.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date(last.createdAt || last.timestamp || Date.now()) }
      });
    }

    logger.info({ conversationId, vaiChatId, imported, skippedActivity, total: msgs.length }, "  ↳ 📚 histórico VAI importado para a conv");
    return { imported, skippedActivity, total: msgs.length };
  } catch (e){
    logger.warn({ err: e.message, conversationId, vaiChatId }, "bootstrap history falhou");
    return { imported: 0, error: e.message };
  }
}
