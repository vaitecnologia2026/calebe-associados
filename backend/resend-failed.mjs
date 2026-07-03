// resend-failed.mjs — reenvio de mensagens com 131049/131047/131053
// Executa de dentro de /root/vaidavenda-calebe/backend/
import { readFileSync } from "fs";
import pg from "pg";
import { decrypt, normalizePhone } from "./src/crypto.js";

const envRaw = readFileSync("/root/vaidavenda-calebe/backend/.env", "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const eq = line.indexOf("=");
  if (eq < 1 || line.trim().startsWith("#")) continue;
  const k = line.slice(0, eq).trim();
  const v = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
  env[k] = v;
}

// Inject env before using crypto (needs DATA_ENCRYPTION_KEY)
for (const [k, v] of Object.entries(env)) {
  if (!process.env[k]) process.env[k] = v;
}

const TOKEN = env.WHATSAPP_CLOUD_TOKEN;
const GREEN_POOL = (env.WHATSAPP_NEW_LEAD_PHONE_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
const DRY = process.argv.includes("--dry-run");

if (!TOKEN) { console.error("WHATSAPP_CLOUD_TOKEN nao encontrado"); process.exit(1); }
if (!GREEN_POOL.length) { console.error("WHATSAPP_NEW_LEAD_PHONE_IDS vazio"); process.exit(1); }

const { Pool } = pg;
const pool = new Pool({ connectionString: env.DATABASE_URL });

let rrIdx = 0;
function nextGreen(excludePhoneId) {
  const candidates = GREEN_POOL.filter(p => p !== excludePhoneId);
  const arr = candidates.length ? candidates : GREEN_POOL;
  const id = arr[rrIdx % arr.length];
  rrIdx++;
  return id;
}

function firstWord(name) {
  return String(name || "cliente").trim().split(/\s+/)[0];
}

function genderSuffix(renderedText) {
  const t = renderedText || "";
  if (/bem-vinda\b/.test(t) && !/bem-vindo/.test(t)) return "a";
  if (/bem-vindo\(a\)/.test(t)) return "o(a)";
  if (/bem-vindo\b/.test(t)) return "o";
  return "o(a)";
}

async function buildParams(templateName, leadName, associateId, renderedText) {
  if (templateName === "calebe_boas_vindas") {
    return [firstWord(leadName), genderSuffix(renderedText)];
  }
  if (templateName === "calebe_corretor_apresenta") {
    let assocFirst = "Corretor";
    if (associateId) {
      const r = await pool.query(
        'SELECT u.name FROM "Associate" a JOIN "User" u ON u.id = a."userId" WHERE a.id = $1',
        [associateId]
      );
      if (r.rows[0]) assocFirst = firstWord(r.rows[0].name);
    }
    return [firstWord(leadName), assocFirst];
  }
  return [firstWord(leadName)];
}

async function sendWA({ to, templateName, bodyParams, phoneId }) {
  const components = bodyParams.length
    ? [{ type: "body", parameters: bodyParams.map(t => ({ type: "text", text: String(t) })) }]
    : [];
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: { name: templateName, language: { code: "pt_BR" }, components }
  };
  const r = await fetch("https://graph.facebook.com/v25.0/" + phoneId + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await r.json();
  if (!r.ok || data.error) {
    return { ok: false, status: r.status, code: data.error?.code, error: data.error?.message };
  }
  return { ok: true, messageId: data.messages?.[0]?.id };
}

function getPhone(phoneEncrypted) {
  if (!phoneEncrypted) return null;
  try {
    const raw = decrypt(Buffer.isBuffer(phoneEncrypted) ? phoneEncrypted : Buffer.from(phoneEncrypted));
    return normalizePhone(raw);
  } catch { return null; }
}

const { rows: failed } = await pool.query(`
  SELECT
    m.id, m."templateName" AS tpl, m.text AS rendered,
    m."conversationId" AS conv_id, m."errorReason" AS err,
    c."leadId" AS lead_id, c."associateId" AS assoc_id,
    c."inboundPhoneId" AS inbound_id,
    l.name AS lead_name, l."phoneEncrypted" AS phone_enc
  FROM "Message" m
  JOIN "Conversation" c ON c.id = m."conversationId"
  JOIN "Lead" l ON l.id = c."leadId"
  WHERE m."errorReason" SIMILAR TO '(131049|131047|131053)%'
    AND m."templateName" IS NOT NULL
    AND m."failedAt" IS NOT NULL
    AND m."createdAt" >= NOW() - INTERVAL '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM "Message" m2
      WHERE m2."conversationId" = m."conversationId"
        AND m2.direction = 'outbound'
        AND m2."failedAt" IS NULL
        AND m2."createdAt" > m."createdAt"
    )
  ORDER BY m."createdAt" ASC
`);

console.log("\n📊 Mensagens falhas para reenvio: " + failed.length);
const byTpl = {};
for (const r of failed) byTpl[r.tpl] = (byTpl[r.tpl] || 0) + 1;
console.log("Por template: " + JSON.stringify(byTpl));
console.log("📱 GREEN pool (" + GREEN_POOL.length + "): " + GREEN_POOL.map(p => "..."+p.slice(-6)).join(", "));

if (DRY) {
  console.log("\nDRY-RUN — mostrando primeiros 10:\n");
  let shown = 0;
  for (const row of failed) {
    if (shown >= 10) break;
    const to = getPhone(row.phone_enc);
    if (!to) { console.log("  [sem telefone]"); shown++; continue; }
    const bp = await buildParams(row.tpl, row.lead_name, row.assoc_id, row.rendered);
    const pid = nextGreen(row.inbound_id);
    console.log("  " + row.tpl + " -> " + to.slice(0,-4)+"XXXX via ..."+pid.slice(-6)+" params="+JSON.stringify(bp));
    shown++;
  }
  console.log("\nTotal que sera enviado: " + failed.length);
  await pool.end();
  process.exit(0);
}

let sent = 0, skipped = 0, errors = 0;
const errLog = [];

for (const row of failed) {
  const to = getPhone(row.phone_enc);
  if (!to) { skipped++; continue; }
  const bodyParams = await buildParams(row.tpl, row.lead_name, row.assoc_id, row.rendered);
  const phoneId = nextGreen(row.inbound_id);

  const result = await sendWA({ to, templateName: row.tpl, bodyParams, phoneId });
  if (result.ok) {
    await pool.query(`
      INSERT INTO "Message" (id, "conversationId", direction, "fromRole", text, "templateName",
        "whatsappMessageId", "createdAt", "contentType")
      SELECT gen_random_uuid(), $1, 'outbound', 'system', text, "templateName",
        $2, NOW(), COALESCE("contentType", 'template')
      FROM "Message" WHERE id = $3
    `, [row.conv_id, result.messageId, row.id]);
    const badNums = ["1119309541269127","1055327477675105","1075588368977371"];
    if (!row.inbound_id || badNums.includes(row.inbound_id)) {
      await pool.query('UPDATE "Conversation" SET "inboundPhoneId" = $1 WHERE id = $2', [phoneId, row.conv_id])
        .catch(() => {});
    }
    sent++;
    if (sent % 50 === 0) process.stdout.write("\n[" + sent + "/" + failed.length + "] ");
    else process.stdout.write(".");
  } else {
    errors++;
    errLog.push({ tpl: row.tpl, code: result.code, error: result.error });
    process.stdout.write("x");
  }
  await new Promise(r => setTimeout(r, 120));
}

console.log("\n\n✅ Enviados: " + sent + " | Ignorados: " + skipped + " | Erros: " + errors);
if (errLog.length) {
  console.log("\nErros detalhados:");
  const grouped = {};
  for (const e of errLog) {
    const k = (e.code || "?") + ": " + (e.error || "?");
    grouped[k] = (grouped[k] || 0) + 1;
  }
  for (const [msg, count] of Object.entries(grouped)) console.log("  " + count + "x " + msg);
}
await pool.end();
