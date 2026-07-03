// =============================================================================
// bomdia-blast.mjs · Disparo "bom dia" (template calebe_bom_dia_v1) para leads
// atribuidos, status ativo, que NUNCA receberam 1a abordagem com template.
//
// Reusa a funcao oficial sendTemplate (Meta Cloud) e persiste a Message na
// conversa do corretor dono (mesma logica do endpoint send-template).
//
// usage:
//   sudo node scripts/bomdia-blast.mjs --dry --limit 3
//   sudo node scripts/bomdia-blast.mjs --limit 3
//   sudo node scripts/bomdia-blast.mjs --leadids id1,id2
//   sudo node scripts/bomdia-blast.mjs              # disparo completo
// =============================================================================
import "dotenv/config";
import fs from "node:fs";
import { db } from "../src/db.js";
import { decrypt, normalizePhone } from "../src/crypto.js";
import { sendTemplate, isEnabled } from "../src/services/whatsappCloud.js";
import { chatUpsertConversation, chatInsertMessage } from "../src/chatDb.js";
import { audit } from "../src/utils/audit.js";

const TEMPLATE = "calebe_bom_dia_v1";
const LANG = "pt_BR";
const THROTTLE_MS = 320;
const LOG = "/root/vaidavenda-calebe/backend/scripts/bomdia-blast.log";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
let LIMIT = null, LEADIDS = null;
for (let i=0;i<args.length;i++){
  if (args[i]==="--limit") LIMIT = parseInt(args[++i],10);
  else if (args[i]==="--leadids") LEADIDS = String(args[++i]||"").split(",").map(s=>s.trim()).filter(Boolean);
}

function log(line){
  const ts = new Date().toISOString();
  const s = `[${ts}] ${line}`;
  console.log(s);
  try { fs.appendFileSync(LOG, s+"\n"); } catch {}
}

function firstName(name){
  if (!name) return "";
  const toks = String(name).trim().split(/\s+/).filter(t => /[A-Za-zÀ-ÿ]{2,}/.test(t));
  let n = toks[0] || "";
  if (!n) return "";
  return n.charAt(0).toUpperCase() + n.slice(1);
}

async function selectTargets(){
  let rows = await db.$queryRawUnsafe(`
    SELECT l.id AS "leadId", l.name AS name, l."phoneEncrypted" AS "phoneEncrypted",
           l."firstContactAt" AS "firstContactAt", l."assignedToId" AS "assignedToId",
           c.id AS "convId", c."associateId" AS "convAssociateId",
           u.id AS "ownerUserId", u.name AS "ownerName", u.email AS "ownerEmail"
    FROM "Lead" l
    JOIN LATERAL (
      SELECT cc.* FROM "Conversation" cc WHERE cc."leadId"=l.id
      ORDER BY (cc."associateId" = l."assignedToId") DESC, cc."lastMessageAt" DESC NULLS LAST
      LIMIT 1
    ) c ON true
    JOIN "Associate" a ON a.id = l."assignedToId"
    JOIN "User" u ON u.id = a."userId"
    WHERE l."assignedToId" IS NOT NULL
      AND l.status IN ('NEW','QUALIFYING','NEGOTIATING')
      AND NOT EXISTS (
        SELECT 1 FROM "Conversation" x JOIN "Message" m ON m."conversationId"=x.id
        WHERE x."leadId"=l.id AND m.direction='outbound' AND m."templateName" IS NOT NULL)
    ORDER BY l."createdAt" ASC
  `);
  if (LEADIDS) rows = rows.filter(r => LEADIDS.includes(r.leadId));
  if (LIMIT)   rows = rows.slice(0, LIMIT);
  return rows;
}

async function persist(row, to, fname, providerMessageId){
  const text = `Bom dia ${fname}, tudo bem?`;
  const msg = await db.message.create({
    data: {
      conversationId: row.convId,
      direction: "outbound",
      fromRole: "associate",
      text,
      contentType: "text",
      provider: "whatsapp_cloud",
      templateName: TEMPLATE,
      whatsappMessageId: providerMessageId || null,
      messageStatus: "sent",
      deliveredAt: new Date()
    }
  });
  if (!row.firstContactAt){
    await db.lead.update({ where: { id: row.leadId }, data: { firstContactAt: new Date() } });
    try { await audit({ action: "LEAD_FIRST_CONTACT", entity: `Lead:${row.leadId}`, metadata: { conversationId: row.convId, channel: "whatsapp_cloud", via: "bomdia-blast" } }); } catch {}
  }
  await db.conversation.update({ where: { id: row.convId }, data: { lastMessageAt: new Date() } });
  // garante que a conversa esteja atribuida ao corretor dono
  if (row.convAssociateId !== row.assignedToId){
    await db.conversation.update({ where: { id: row.convId }, data: { associateId: row.assignedToId } }).catch(()=>{});
  }
  try {
    await chatUpsertConversation({ id: row.convId, crmUserId: row.ownerUserId, crmUserEmail: row.ownerEmail, crmUserName: row.ownerName, crmUserRole: "ASSOCIATE", leadId: row.leadId, leadName: row.name, leadPhoneMask: null });
    await chatInsertMessage({ conversationId: row.convId, direction: "outbound", fromRole: "associate", senderUserId: row.ownerUserId, senderName: row.ownerName, content: text, vaiMessageId: null, metadata: { provider: "whatsapp_cloud", templateName: TEMPLATE, whatsappMessageId: providerMessageId||null, via: "bomdia-blast" }, deliveredAt: new Date() });
  } catch (e){ log(`  ! chatDb mirror falhou lead=${row.leadId}: ${e.message}`); }
  return msg.id;
}

(async () => {
  log(`=== bomdia-blast START dry=${DRY} limit=${LIMIT||"-"} leadids=${LEADIDS?LEADIDS.length:"-"} cloudEnabled=${isEnabled()} ===`);
  if (!DRY && !isEnabled()){ log("ABORT: whatsapp cloud disabled"); process.exit(1); }
  const targets = await selectTargets();
  log(`alvos selecionados: ${targets.length}`);
  let sent=0, failed=0, skipped=0;
  for (const row of targets){
    let to;
    try { to = normalizePhone(decrypt(row.phoneEncrypted)); } catch(e){ to=null; }
    const fname = firstName(row.name);
    if (!to){ skipped++; log(`SKIP sem-telefone lead=${row.leadId} (${row.name})`); continue; }
    if (!fname){ skipped++; log(`SKIP sem-nome lead=${row.leadId}`); continue; }
    if (DRY){ log(`DRY would-send to=${to} nome="${fname}" corretor=${row.ownerName} conv=${row.convId}`); sent++; continue; }
    const r = await sendTemplate({ to, templateName: TEMPLATE, languageCode: LANG, bodyParams: [fname] });
    if (r.ok){
      const mid = await persist(row, to, fname, r.messageId);
      sent++; log(`OK to=${to} nome="${fname}" wamid=${r.messageId} msg=${mid} corretor=${row.ownerName}`);
    } else {
      failed++; log(`FAIL to=${to} lead=${row.leadId} err=${r.error} code=${r.code}`);
    }
    await new Promise(res => setTimeout(res, THROTTLE_MS));
  }
  log(`=== bomdia-blast END enviados=${sent} falhas=${failed} pulados=${skipped} ===`);
  process.exit(0);
})().catch(e => { log("FATAL "+e.stack); process.exit(1); });
