// Worker: polling de mensagens da VAI a cada 60s para capturar respostas
// que vieram pelo dashboard da VAI (a VAI nao dispara webhook nesses casos).
// Tambem captura mensagens do bot da VAI e qualquer divergencia outbound.
import { db } from "../db.js";
import { vaiListChatMessages } from "../services/vaiClient.js";
import { chatInsertMessage } from "../chatDb.js";
import { sseToMany } from "../services/sseHub.js";
import { logger } from "../utils/logger.js";

const TICK_MS = 30_000;        // 30s · pos 429 storm com 5s
const ACTIVE_HOURS = 24;       // só polleia convs com atividade nas ultimas 24h
const PER_CONV_LIMIT = 30;     // limite de msgs buscadas por conv por tick

function asArrayMessages(resp){
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp?.data)) return resp.data;
  if (Array.isArray(resp?.messages)) return resp.messages;
  if (Array.isArray(resp?.items)) return resp.items;
  return [];
}

function isFromMe(m){
  // varios nomes possiveis na VAI / WhatsApp Business
  return !!(m.fromMe ?? m.from_me ?? m.isFromMe ?? m.is_from_me ?? m.from === "me" ?? m.direction === "from_me");
}

function extractText(m){
  if (m.text && typeof m.text === "string") return m.text;
  if (m.body && typeof m.body === "string") return m.body;
  if (m.content && typeof m.content === "string") return m.content;
  if (typeof m.message === "string") return m.message;
  if (m.message?.text) return String(m.message.text);
  if (m.message?.body) return String(m.message.body);
  return "";
}

async function pollOnce(){
  const since = new Date(Date.now() - ACTIVE_HOURS * 3600 * 1000);
  const convs = await db.conversation.findMany({
    where: {
      vaiConvId: { not: null },
      OR: [
        { lastMessageAt: { gte: since } },
        { createdAt: { gte: since } }
      ]
    },
    select: {
      id: true,
      vaiConvId: true,
      leadId: true,
      associateId: true,
      associate: { select: { userId: true } },
      lead: { select: { name: true } }
    }
  });

  let totalIngested = 0;
  for (const conv of convs){
    try {
      const resp = await vaiListChatMessages(conv.vaiConvId, { limit: PER_CONV_LIMIT });
      const msgs = asArrayMessages(resp);
      if (msgs.length === 0) continue;

      // Dedup por vaiMessageId
      const incomingIds = msgs.map(m => m.id ? String(m.id) : null).filter(Boolean);
      if (incomingIds.length === 0) continue;
      const existing = await db.message.findMany({
        where: { conversationId: conv.id, vaiMessageId: { in: incomingIds } },
        select: { vaiMessageId: true }
      });
      const knownIds = new Set(existing.map(m => m.vaiMessageId));
      const novas = msgs.filter(m => m.id && !knownIds.has(String(m.id)));
      if (novas.length === 0) continue;

      // Ordena por timestamp se houver
      novas.sort((a, b) => {
        const ta = new Date(a.createdAt || a.timestamp || a.created_at || 0).getTime();
        const tb = new Date(b.createdAt || b.timestamp || b.created_at || 0).getTime();
        return ta - tb;
      });

      let ingestedThisConv = 0;
      for (const m of novas){
        const fromMe = isFromMe(m);
        const direction = fromMe ? "outbound" : "inbound";
        const fromRole = fromMe ? "agent" : "lead";
        const text = extractText(m);
        const contentType = m.type || m.contentType || "text";
        const fileUrl = m.fileUrl || m.file_url || m.media?.url || null;
        const createdAt = m.createdAt ? new Date(m.createdAt) :
                          m.timestamp  ? new Date(m.timestamp) :
                          m.created_at ? new Date(m.created_at) : new Date();

        // Insere em Message (Prisma)
        try {
          await db.message.create({
            data: {
              conversationId: conv.id,
              direction,
              fromRole,
              text,
              vaiMessageId: String(m.id),
              contentType,
              ...(fileUrl ? { fileUrl } : {}),
              deliveredAt: createdAt
            }
          });
          ingestedThisConv++;
          totalIngested++;
        } catch (e) {
          logger.warn({ err: e.message, msgId: m.id, convId: conv.id }, "vai polling: insert Message falhou");
          continue;
        }
        // Insere tambem em chatDb (paralelo, best-effort)
        try {
          await chatInsertMessage({
            conversationId: conv.id,
            direction,
            fromRole,
            content: text,
            contentType,
            fileUrl,
            vaiMessageId: String(m.id),
            deliveredAt: createdAt
          });
        } catch {}
      }

      if (ingestedThisConv > 0){
        // Atualiza lastMessageAt
        await db.conversation.update({
          where: { id: conv.id },
          data: { lastMessageAt: new Date() }
        }).catch(()=>{});
        // SSE pro corretor + admins
        try {
          const targets = [conv.associate?.userId].filter(Boolean);
          sseToMany(targets, "conv.messages_ingested", {
            conversationId: conv.id,
            leadId: conv.leadId,
            leadName: conv.lead?.name,
            newCount: ingestedThisConv,
            source: "vai_polling"
          });
        } catch {}
        logger.info({ convId: conv.id, leadName: conv.lead?.name, ingested: ingestedThisConv }, "📥 vai polling · msgs ingeridas");
      }
    } catch (e) {
      logger.warn({ err: e.message, status: e.status, convId: conv.id, vaiConvId: conv.vaiConvId }, "vai polling: erro na conv");
    }
  }
  return { polled: convs.length, ingested: totalIngested };
}

export function startVaiPollingWorker(){
  if (process.env.VAI_POLLING_ENABLED === "false"){
    logger.info("▶ VAI polling worker DESABILITADO via env");
    return;
  }
  logger.info("▶ VAI polling worker iniciado");
  const tick = async () => {
    try {
      const r = await pollOnce();
      if (r.ingested > 0) logger.info(r, "vai polling tick concluido");
    } catch (e) {
      logger.error({ err: e.message }, "vai polling worker error");
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, TICK_MS);
}
