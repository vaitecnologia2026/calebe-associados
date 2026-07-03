/**
 * Disparo: calebe_baixe_o_app → todos os corretores ativos com telefone
 * Uso: node disparo_app_exec.mjs [--dry-run]
 */
import https from 'https';
import fs from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');

const env = {};
fs.readFileSync('/root/vaidavenda-calebe/backend/.env', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
});
const TOKEN = env.WHATSAPP_CLOUD_TOKEN;
const WABA_ID = env.WHATSAPP_WABA_ID;

const SUPPORT_IDS = new Set(['1143966188797246', '1155522184305211']);
const senderIds = env.WHATSAPP_NEW_LEAD_PHONE_IDS.split(',')
  .map(s => s.trim())
  .filter(id => !SUPPORT_IDS.has(id));

console.log(`Senders: ${senderIds.length}`);

function apiGet(path) {
  return new Promise((resolve, reject) => {
    https.request({ hostname: 'graph.facebook.com', path: `/v20.0${path}`, headers: { Authorization: `Bearer ${TOKEN}` } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject).end();
  });
}

function sendTemplate(phoneId, to, firstName) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'calebe_baixe_o_app',
        language: { code: 'pt_BR' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: firstName }] }
        ]
      }
    });
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v20.0/${phoneId}/messages`,
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Verificar template
const check = await apiGet(`/${WABA_ID}/message_templates?name=calebe_baixe_o_app&fields=name,status,id`);
const tpl = check.data?.[0];
console.log(`Template: ${tpl?.status} | ID: ${tpl?.id}`);

if (!tpl || tpl.status !== 'APPROVED') {
  console.error('❌ Template NÃO aprovado. Aguarde Meta aprovar e execute novamente.');
  process.exit(1);
}

// Carregar lista
const targets = JSON.parse(fs.readFileSync('/tmp/calebe_app_targets.json', 'utf8'));
console.log(`Destinatários: ${targets.length}`);

if (DRY_RUN) {
  console.log('\n[DRY RUN] Primeiros 10 seriam enviados para:');
  targets.slice(0, 10).forEach((t, i) => {
    const sender = senderIds[i % senderIds.length];
    console.log(`  via ${sender} → ${t.phone} (${t.name})`);
  });
  console.log('\n[DRY RUN] Execute sem --dry-run para disparar de verdade.');
  process.exit(0);
}

// Disparo real
let sent = 0, errors = 0;
const log = [];

for (let i = 0; i < targets.length; i++) {
  const t = targets[i];
  const senderId = senderIds[i % senderIds.length];

  try {
    const res = await sendTemplate(senderId, t.phone, t.name);
    if (res.messages?.[0]?.id) {
      sent++;
      log.push({ phone: t.phone, name: t.name, status: 'OK', msgId: res.messages[0].id });
      if (sent % 50 === 0) console.log(`✅ Enviados: ${sent}/${targets.length}`);
    } else {
      errors++;
      const errMsg = res.error?.message || JSON.stringify(res);
      log.push({ phone: t.phone, name: t.name, status: 'ERRO', error: errMsg });
      console.warn(`⚠️  Erro ${t.phone}: ${errMsg.slice(0, 80)}`);
    }
  } catch (ex) {
    errors++;
    log.push({ phone: t.phone, name: t.name, status: 'ERRO', error: ex.message });
  }

  // Rate limit: 30 msgs/s (1000ms / 30 ≈ 33ms interval)
  await sleep(35);
}

fs.writeFileSync('/tmp/calebe_app_disparo_log.json', JSON.stringify(log, null, 2));
console.log(`\n✅ Disparo concluído: ${sent} enviados, ${errors} erros`);
console.log(`Log salvo em /tmp/calebe_app_disparo_log.json`);
