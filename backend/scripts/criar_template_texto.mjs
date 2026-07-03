import https from 'https';
import fs from 'fs';

const env = {};
fs.readFileSync('/root/vaidavenda-calebe/backend/.env', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
});
const TOKEN = env.WHATSAPP_CLOUD_TOKEN;
const WABA_ID = env.WHATSAPP_WABA_ID;

function apiPost(urlPath, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = https.request({ hostname: 'graph.facebook.com', path: `/v20.0${urlPath}`, method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on('error', reject);
    req.write(postData); req.end();
  });
}

function apiGet(urlPath) {
  return new Promise((resolve, reject) => {
    https.request({ hostname: 'graph.facebook.com', path: `/v20.0${urlPath}`, headers: { Authorization: `Bearer ${TOKEN}` } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on('error', reject).end();
  });
}

// Verificar se já existe
const existing = await apiGet(`/${WABA_ID}/message_templates?name=calebe_baixe_o_app&fields=name,status,id`);
if (existing.data?.length > 0) {
  const t = existing.data[0];
  console.log(`Template calebe_baixe_o_app já existe: ${t.status} | ID: ${t.id}`);
  fs.writeFileSync('/tmp/calebe_template_id.txt', String(t.id));
  process.exit(0);
}

// Criar template sem imagem (body + 2 botões URL)
const tplRes = await apiPost(`/${WABA_ID}/message_templates`, {
  name: 'calebe_baixe_o_app',
  language: 'pt_BR',
  category: 'MARKETING',
  components: [
    {
      type: 'BODY',
      text: '📲 *Atenção, {{1}}!*\n\nO app *Calebe Associados* já está disponível para *iPhone e Android*!\n\nAcesse seus leads, responda clientes e acompanhe seu desempenho direto do celular — em qualquer lugar. 🧡\n\nBaixe agora pelo botão abaixo:',
      example: { body_text: [['João']] }
    },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'URL', text: 'Baixar no iPhone', url: 'https://apps.apple.com/br/app/calebe-associados/id6779335281' },
        { type: 'URL', text: 'Baixar no Android', url: 'https://play.google.com/store/apps/details?id=tech.calebe.app' }
      ]
    }
  ]
});

console.log('Template response:', JSON.stringify(tplRes, null, 2));

if (tplRes.id) {
  fs.writeFileSync('/tmp/calebe_template_id.txt', String(tplRes.id));
  console.log('\n✅ Template criado! Status:', tplRes.status, '| ID:', tplRes.id);
  if (tplRes.status === 'APPROVED' || tplRes.status === 'PENDING') {
    console.log('Template pronto para uso.');
  }
} else {
  console.error('Falha:', JSON.stringify(tplRes));
}
