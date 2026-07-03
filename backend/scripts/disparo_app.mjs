import https from 'https';
import fs from 'fs';

const env = {};
fs.readFileSync('/root/vaidavenda-calebe/backend/.env', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
});
const TOKEN = env.WHATSAPP_CLOUD_TOKEN;
const WABA_ID = env.WHATSAPP_WABA_ID;
const DB_URL = env.DATABASE_URL;

// Números que NUNCA devem enviar para clientes
const SUPPORT_NUMBERS = ['1143966188797246', '1155522184305211'];
const sendingNumbers = env.WHATSAPP_NEW_LEAD_PHONE_IDS.split(',')
  .map(s => s.trim())
  .filter(id => !SUPPORT_NUMBERS.includes(id));

console.log(`Números de disparo disponíveis: ${sendingNumbers.length}`);
console.log(sendingNumbers.join(', '));

function apiGet(urlPath) {
  return new Promise((resolve, reject) => {
    https.request({ hostname: 'graph.facebook.com', path: `/v20.0${urlPath}`, headers: { Authorization: `Bearer ${TOKEN}` } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on('error', reject).end();
  });
}

// Verificar status do template
const tplCheck = await apiGet(`/${WABA_ID}/message_templates?name=calebe_baixe_o_app&fields=name,status,id`);
const tpl = tplCheck.data?.[0];
console.log(`\nTemplate calebe_baixe_o_app: ${tpl?.status || 'NÃO ENCONTRADO'} | ID: ${tpl?.id}`);

if (!tpl || tpl.status !== 'APPROVED') {
  console.log('\n⏳ Template ainda não aprovado. Aguarde aprovação da Meta antes de disparar.');
  console.log('Execute este script novamente quando o status for APPROVED.');
  process.exit(0);
}

// Usar Prisma para buscar associados
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const associates = await db.associate.findMany({
  where: { active: true },
  include: { user: { select: { name: true } } },
  select: { id: true, phone: true, whatsapp: true, user: true }
});

console.log(`\nTotal de corretores ativos: ${associates.length}`);

// Limpar e validar telefones
function cleanPhone(raw) {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.length === 12 || d.length === 13) return d;
  return null;
}

function getFirstName(fullName) {
  if (!fullName) return 'Corretor';
  return fullName.trim().split(' ')[0];
}

const targets = associates
  .map(a => {
    const phone = cleanPhone(a.whatsapp || a.phone);
    return { id: a.id, phone, name: getFirstName(a.user?.name) };
  })
  .filter(t => t.phone !== null);

console.log(`Com telefone válido: ${targets.length}`);
console.log('\nAmostra (primeiros 5):');
targets.slice(0, 5).forEach(t => console.log(`  ${t.name}: ${t.phone}`));

await db.$disconnect();

// Salvar lista para o disparo real
fs.writeFileSync('/tmp/calebe_app_targets.json', JSON.stringify(targets, null, 2));
console.log(`\n✅ Lista de ${targets.length} destinatários salva em /tmp/calebe_app_targets.json`);
console.log('Para disparar, execute o script disparo_app_exec.mjs');
