import https from 'https';
import fs from 'fs';

const env = {};
fs.readFileSync('/root/vaidavenda-calebe/backend/.env', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
});
const TOKEN = env.WHATSAPP_CLOUD_TOKEN;
const WABA_ID = env.WHATSAPP_WABA_ID;
const PHONE_ID = env.WHATSAPP_NEW_LEAD_PHONE_IDS.split(',')[0];

function apiGet(urlPath) {
  return new Promise((resolve, reject) => {
    https.request({ hostname: 'graph.facebook.com', path: `/v20.0${urlPath}`, headers: { Authorization: `Bearer ${TOKEN}` } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on('error', reject).end();
  });
}

function apiPost(urlPath, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = https.request({ hostname: 'graph.facebook.com', path: `/v20.0${urlPath}`, method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on('error', reject);
    req.write(postData); req.end();
  });
}

// Pegar URL da imagem aprovada (do calebe_app_android_v1)
const existingTpl = await apiGet(`/${WABA_ID}/message_templates?name=calebe_app_android_v1&fields=components`);
const androidHeader = existingTpl.data?.[0]?.components?.find(c => c.type === 'HEADER');
const approvedImageUrl = androidHeader?.example?.header_handle?.[0];
console.log('URL da imagem aprovada:', approvedImageUrl?.slice(0, 80), '...');

if (!approvedImageUrl) {
  console.error('Nao consegui pegar URL aprovada'); process.exit(1);
}

// Criar template com ambos os links usando imagem já aprovada
console.log('\nCriando calebe_baixe_o_app...');
const tplRes = await apiPost(`/${WABA_ID}/message_templates`, {
  name: 'calebe_baixe_o_app',
  language: 'pt_BR',
  category: 'MARKETING',
  components: [
    {
      type: 'HEADER',
      format: 'IMAGE',
      example: { header_handle: [approvedImageUrl] }
    },
    {
      type: 'BODY',
      text: '📲 *Atenção, {{1}}!*\n\nO app *Calebe Associados* está disponível para *iPhone e Android*!\n\nAcesse seus leads, responda clientes e acompanhe seu desempenho de qualquer lugar. 🧡\n\nBaixe agora no botão abaixo:',
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

console.log('\nTemplate response:', JSON.stringify(tplRes, null, 2));

if (tplRes.id) {
  fs.writeFileSync('/tmp/calebe_template_id.txt', String(tplRes.id));
  console.log('\n✅ Template criado! Status:', tplRes.status, '| ID:', tplRes.id);
} else if (tplRes.error?.error_user_msg?.includes('already exists')) {
  console.log('Template já existe — verificando...');
  const check = await apiGet(`/${WABA_ID}/message_templates?name=calebe_baixe_o_app&fields=name,status,id`);
  console.log(JSON.stringify(check, null, 2));
} else {
  console.error('Falha:', JSON.stringify(tplRes));
}
