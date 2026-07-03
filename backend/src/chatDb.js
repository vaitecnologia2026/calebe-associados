// =============================================================================
// Banco de CHAT (histórico de conversas WhatsApp/VAI) — 187.77.251.196:5433
// Usa node-postgres puro · schema auto-criado no boot.
// Cada conversa pertence a um user do CRM principal (associate/admin que enviou).
// =============================================================================
import pg from "pg";
import { logger } from "./utils/logger.js";

const { Pool } = pg;

const CONN = process.env.CHAT_DATABASE_URL || "";
if (!CONN) logger.warn("CHAT_DATABASE_URL não configurado · histórico de chat desativado");

export const chatPool = CONN ? new Pool({
  connectionString: CONN,
  max: Number(process.env.CHAT_DB_POOL) || 32,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
}) : null;

const DDL = `
CREATE TABLE IF NOT EXISTS chat_conversations (
  id              TEXT PRIMARY KEY,                    -- cuid/uuid (reutiliza id da Conversation do CRM)
  crm_user_id     TEXT,                                -- quem opera: User.id do CRM principal (pode ser null em webhooks inbound antigos)
  crm_user_email  TEXT,
  crm_user_name   TEXT,
  crm_user_role   TEXT,                                -- ADMIN, ASSOCIATE, LEGAL...
  lead_id         TEXT,                                -- Lead.id do CRM principal
  lead_name       TEXT,
  lead_phone      TEXT,                                -- +5547... (E.164)
  lead_phone_mask TEXT,                                -- (47) 9****-**99
  vai_chat_id     TEXT,
  vai_contact_id  TEXT,
  vai_lid         TEXT,                                -- 34283...@lid
  vai_phone       TEXT,                                -- identifier VAI (pode incluir '+')
  status          TEXT DEFAULT 'open',                 -- open, closed
  first_message_at TIMESTAMPTZ,
  last_message_at  TIMESTAMPTZ,
  message_count   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Migração idempotente · caso a tabela já exista com NOT NULL
ALTER TABLE chat_conversations ALTER COLUMN crm_user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conv_user       ON chat_conversations(crm_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_lead       ON chat_conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_vai_chat   ON chat_conversations(vai_chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_vai_contact ON chat_conversations(vai_contact_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_vai_lid    ON chat_conversations(vai_lid);
CREATE INDEX IF NOT EXISTS idx_chat_conv_vai_phone  ON chat_conversations(vai_phone);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL,                       -- 'inbound' | 'outbound'
  from_role       TEXT,                                -- 'lead' | 'associate' | 'admin' | 'system'
  sender_user_id  TEXT,                                -- se outbound, quem enviou (User.id do CRM)
  sender_name     TEXT,
  content         TEXT NOT NULL,
  content_type    TEXT DEFAULT 'text',                 -- text, image, audio, video, file, note
  file_url        TEXT,
  is_note         BOOLEAN DEFAULT false,
  vai_message_id  TEXT,
  metadata        JSONB,
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_msg_conv        ON chat_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_msg_vai_id      ON chat_messages(vai_message_id);
CREATE INDEX IF NOT EXISTS idx_chat_msg_sender      ON chat_messages(sender_user_id);
`;

let initialized = false;
export async function initChatDb(){
  if (!chatPool) return;
  if (initialized) return;
  try {
    await chatPool.query(DDL);
    initialized = true;
    logger.info("✓ chat DB schema pronto (187.77.251.196:5433/chat)");
  } catch (e){
    logger.error({ err: e.message }, "chat DB init falhou");
  }
}

// ----- Helpers ---------------------------------------------------------------

/** Upsert de conversa · chave é o id (o mesmo da Conversation do CRM principal). */
export async function chatUpsertConversation(c){
  if (!chatPool) return null;
  const q = `
    INSERT INTO chat_conversations
      (id, crm_user_id, crm_user_email, crm_user_name, crm_user_role,
       lead_id, lead_name, lead_phone, lead_phone_mask,
       vai_chat_id, vai_contact_id, vai_lid, vai_phone,
       first_message_at, last_message_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, COALESCE($14, NOW()), NOW())
    ON CONFLICT (id) DO UPDATE SET
      crm_user_id    = COALESCE(EXCLUDED.crm_user_id,    chat_conversations.crm_user_id),
      crm_user_email = COALESCE(EXCLUDED.crm_user_email, chat_conversations.crm_user_email),
      crm_user_name  = COALESCE(EXCLUDED.crm_user_name,  chat_conversations.crm_user_name),
      crm_user_role  = COALESCE(EXCLUDED.crm_user_role,  chat_conversations.crm_user_role),
      lead_name      = COALESCE(EXCLUDED.lead_name,      chat_conversations.lead_name),
      lead_phone     = COALESCE(EXCLUDED.lead_phone,     chat_conversations.lead_phone),
      lead_phone_mask= COALESCE(EXCLUDED.lead_phone_mask,chat_conversations.lead_phone_mask),
      vai_chat_id    = COALESCE(EXCLUDED.vai_chat_id,    chat_conversations.vai_chat_id),
      vai_contact_id = COALESCE(EXCLUDED.vai_contact_id, chat_conversations.vai_contact_id),
      vai_lid        = COALESCE(EXCLUDED.vai_lid,        chat_conversations.vai_lid),
      vai_phone      = COALESCE(EXCLUDED.vai_phone,      chat_conversations.vai_phone),
      updated_at     = NOW()
    RETURNING id
  `;
  const vals = [
    c.id, c.crmUserId || null, c.crmUserEmail || null, c.crmUserName || null, c.crmUserRole || null,
    c.leadId || null, c.leadName || null, c.leadPhone || null, c.leadPhoneMask || null,
    c.vaiChatId || null, c.vaiContactId || null, c.vaiLid || null, c.vaiPhone || null,
    c.firstMessageAt || null
  ];
  try {
    const r = await chatPool.query(q, vals);
    return r.rows[0]?.id || null;
  } catch (e){
    logger.warn({ err: e.message }, "chatUpsertConversation falhou");
    return null;
  }
}

/** Insere uma mensagem e atualiza last_message_at/message_count da conversa. */
export async function chatInsertMessage(m){
  if (!chatPool) return null;
  const client = await chatPool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(`
      INSERT INTO chat_messages
        (conversation_id, direction, from_role, sender_user_id, sender_name,
         content, content_type, file_url, is_note, vai_message_id, metadata, delivered_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id, created_at
    `, [
      m.conversationId, m.direction, m.fromRole || null, m.senderUserId || null, m.senderName || null,
      String(m.content || ""), m.contentType || "text", m.fileUrl || null, !!m.isNote,
      m.vaiMessageId || null, m.metadata || null, m.deliveredAt || null
    ]);
    await client.query(`
      UPDATE chat_conversations
      SET last_message_at = NOW(),
          first_message_at = COALESCE(first_message_at, NOW()),
          message_count = message_count + 1,
          updated_at = NOW()
      WHERE id = $1
    `, [m.conversationId]);
    await client.query("COMMIT");
    return r.rows[0];
  } catch (e){
    await client.query("ROLLBACK").catch(()=>{});
    logger.warn({ err: e.message, conv: m.conversationId }, "chatInsertMessage falhou");
    return null;
  } finally {
    client.release();
  }
}

/** Lista conversas de um usuário (admin vê todas · associate só as suas). */
export async function chatListConversations({ userId, role, limit = 50, offset = 0 }){
  if (!chatPool) return [];
  const isAdmin = role === "ADMIN";
  const where = isAdmin ? "" : "WHERE crm_user_id = $1";
  const params = isAdmin ? [limit, offset] : [userId, limit, offset];
  const phoneCol = isAdmin ? "lead_phone," : "";
  const r = await chatPool.query(`
    SELECT id, crm_user_id, crm_user_name, lead_id, lead_name, lead_phone_mask,
           ${phoneCol}
           vai_chat_id, vai_contact_id, status,
           first_message_at, last_message_at, message_count
    FROM chat_conversations
    ${where}
    ORDER BY last_message_at DESC NULLS LAST, created_at DESC
    LIMIT $${isAdmin ? 1 : 2} OFFSET $${isAdmin ? 2 : 3}
  `, params);
  return r.rows;
}

/** Lista mensagens de uma conversa (ordem cronológica). */
export async function chatListMessages({ conversationId, limit = 200, offset = 0 }){
  if (!chatPool) return [];
  const r = await chatPool.query(`
    SELECT id, direction, from_role, sender_user_id, sender_name,
           content, content_type, file_url, is_note, vai_message_id,
           delivered_at, read_at, created_at
    FROM chat_messages
    WHERE conversation_id = $1
    ORDER BY created_at ASC, id ASC
    LIMIT $2 OFFSET $3
  `, [conversationId, limit, offset]);
  return r.rows;
}

/** Resolve a conversa no banco de chat por qualquer identificador VAI (para webhooks). */
export async function chatFindConversationByVai({ chatId, contactId, lid, phone }){
  if (!chatPool) return null;
  const conditions = [];
  const params = [];
  if (chatId)    { params.push(chatId);    conditions.push(`vai_chat_id    = $${params.length}`); }
  if (contactId) { params.push(contactId); conditions.push(`vai_contact_id = $${params.length}`); }
  if (lid)       { params.push("%" + String(lid).split("@")[0] + "%"); conditions.push(`vai_lid LIKE $${params.length}`); }
  if (phone)     { params.push(phone);     conditions.push(`vai_phone      = $${params.length}`); }
  if (!conditions.length) return null;
  const r = await chatPool.query(
    `SELECT * FROM chat_conversations WHERE ${conditions.join(" OR ")} ORDER BY last_message_at DESC LIMIT 1`,
    params
  );
  return r.rows[0] || null;
}
