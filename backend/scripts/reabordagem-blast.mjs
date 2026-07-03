// reabordagem-blast.mjs · Reenvia template calebe_bom_dia_v1 para leads com
// falha 131049 hoje que ainda NAO estao na blacklist.
import "dotenv/config";
import fs from "node:fs";
import { db } from "../src/db.js";
import { decrypt, normalizePhone } from "../src/crypto.js";
import { sendTemplate, isEnabled } from "../src/services/whatsappCloud.js";
import { chatUpsertConversation, chatInsertMessage } from "../src/chatDb.js";
import { audit } from "../src/utils/audit.js";

const TEMPLATE = "calebe_bom_dia_v1";
const LANG = "pt_BR";
const THROTTLE_MS = 350;
const LOG = "/root/vaidavenda-calebe/backend/scripts/reabordagem-blast.log";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");

// IDs dos 42 leads retentáveis
const TARGET_LEAD_IDS = [
  'cmp7we35f0vm8i8ds0crnzsyg','cmoxvgwes0p83ux5922yjx6mf','cmp7vtp5r0ndqi8dsrnolwht2',
  'cmoxtg64v0bjzux59im0c1j6s','cmoxuvyo50lgsux5966w1volp','cmp7w65xo0sfwi8dsl4u4ervv',
  'cmqj0t9qo003pphuqk43ts4nk','cmp7vqxpd0m9ei8dskdqxs8t4','cmoxtpwle0dhfux59jna3irr2',
  'cmp7v277n0c74i8dstmuik0ly','cmp7wv4ud12hli8dsp32x4p6j','cmp7ubvaw01hoi8dsspgs6x89',
  'cmqj0tahp00a4phuqk4v1l9qm','cmoxtxmbe0f0cux592pibxnri','cmoxtzlen0fdhux59g7ogrhoq',
  'cmqj0t9ob0039phuq3kv062c6','cmp7uc92101n6i8dskowfple1','cmp7w825v0t78i8dsooiif7rs',
  'cmqj0tb3a00ecphuql33d85r3','cmoxu8gjx0h2yux59izus17zj','cmosqkyvk01ux29jbdd80sor3',
  'cmp7uca9r01noi8dswkj7mjjc','cmp7wuiih128li8dsutgjbhiv','cmqj0tagl009yphuqrzy5n6wh',
  'cmoxv2vmy0mp7ux59op8vgpko','cmp7umg5l05s4i8dsnniulbl7','cmp7w0k520q64i8ds20y6j9ba',
  'cmq1g0g4j00f9wf30k2jy1plq','cmoxetn8m0566ux59yen8lct0','cmqvkc99j029nfuk9r2zdzemu',
  'cmorqizot00rn13iykrjq6cr1','cmp7wl6pg0yhfi8ds2t9jovcd','cmp7w6go10sk8i8dskvr25taa',
  'cmqj0taz300daphuqx25s1kxd','cmoxuo6bw0k1kux592ehb1inu','cmqj0ta6r0072phuq5nuwo9ch',
  'cmp7x8xro181ji8dsncatocmd','cmqj0ta0o005sphuqmkurkjgs','cmoxtm9u00cs0ux59o30s5egf',
  'cmoxucon70hwbux593d5qxdh4','cmqj0tbab00gtphuqbn7ycw77','cmp7v1qth0c0gi8dsdvg2ivfm'
];

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
  const rows = await db.$queryRawUnsafe(`
    SELECT l.id AS "leadId", l.name, l."phoneEncrypted", l."noWhatsApp", l."blacklistReason",
           l."firstContactAt", l."assignedToId",
           c.id AS "convId", c."associateId" AS "convAssociateId",
           u.id AS "ownerUserId", u.name AS "ownerName", u.email AS "ownerEmail"
    FROM "Lead" l
    JOIN LATERAL (
      SELECT cc.* FROM "Conversation" cc WHERE cc."leadId"=l.id
      ORDER BY (cc."associateId" = l."assignedToId") DESC, cc."lastMessageAt" DESC NULLS LAST
      LIMIT 1
    ) c ON true
    LEFT JOIN "Associate" a ON a.id = COALESCE(l."assignedToId", c."associateId")
    LEFT JOIN "User" u ON u.id = a."userId"
    WHERE l.id = ANY($1::text[])
      AND (l."noWhatsApp" = false OR l."noWhatsApp" IS NULL)
  `, TARGET_LEAD_IDS);
  return rows;
}

log(`=== reabordagem-blast START dry=${DRY} alvos=${TARGET_LEAD_IDS.length} cloudEnabled=${isEnabled()} ===`);
if (!DRY && !isEnabled()){ log("ABORT: whatsapp cloud disabled"); process.exit(1); }

const targets = await selectTargets();
log(`alvos válidos (não blacklist): ${targets.length}`);

let sent=0, failed=0, skipped=0;
for (const row of targets){
  if (!row.phoneEncrypted){ skipped++; log(`SKIP sem-tel lead=${row.leadId} (${row.name})`); continue; }
  let to;
  try { to = normalizePhone(decrypt(row.phoneEncrypted)); } catch(e){ to=null; }
  const fname = firstName(row.name);
  if (!to){ skipped++; log(`SKIP decrypt-fail lead=${row.leadId} (${row.name})`); continue; }
  if (!fname){ skipped++; log(`SKIP sem-nome lead=${row.leadId}`); continue; }
  if (DRY){
    log(`DRY would-send to=${to} nome="${fname}" lead=${row.leadId} conv=${row.convId} corretor=${row.ownerName||'N/A'}`);
    sent++;
    continue;
  }
  const r = await sendTemplate({ to, templateName: TEMPLATE, languageCode: LANG, bodyParams: [fname] });
  if (r.ok){
    const text = `Bom dia ${fname}, tudo bem?`;
    try {
      const msg = await db.message.create({
        data: {
          conversationId: row.convId,
          direction: "outbound",
          fromRole: row.ownerUserId ? "associate" : "system",
          text,
          contentType: "text",
          provider: "whatsapp_cloud",
          templateName: TEMPLATE,
          whatsappMessageId: r.messageId || null,
          messageStatus: "sent",
          deliveredAt: new Date()
        }
      });
      await db.conversation.update({ where: { id: row.convId }, data: { lastMessageAt: new Date() } });
      if (row.ownerUserId) {
        try {
          await chatUpsertConversation({ id: row.convId, crmUserId: row.ownerUserId, crmUserEmail: row.ownerEmail, crmUserName: row.ownerName, crmUserRole: "ASSOCIATE", leadId: row.leadId, leadName: row.name, leadPhoneMask: null });
          await chatInsertMessage({ conversationId: row.convId, direction: "outbound", fromRole: "associate", senderUserId: row.ownerUserId, senderName: row.ownerName, content: text, vaiMessageId: null, metadata: { provider: "whatsapp_cloud", templateName: TEMPLATE, whatsappMessageId: r.messageId||null, via: "reabordagem-blast" }, deliveredAt: new Date() });
        } catch(e){ log(`  ! chatDb mirror falhou lead=${row.leadId}: ${e.message}`); }
      }
      sent++;
      log(`OK to=${to} nome="${fname}" wamid=${r.messageId} msg=${msg.id} lead=${row.leadId}`);
    } catch(eDb){
      log(`FAIL-DB lead=${row.leadId} err=${eDb.message}`);
      failed++;
    }
  } else {
    failed++;
    log(`FAIL-SEND to=${to} lead=${row.leadId} err=${r.error} code=${r.code}`);
  }
  await new Promise(res => setTimeout(res, THROTTLE_MS));
}
log(`=== reabordagem-blast END enviados=${sent} falhas=${failed} pulados=${skipped} ===`);
await db.$disconnect();
