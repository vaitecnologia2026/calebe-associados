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

// 1. Ver template calebe_app_android_v1 completo
console.log('=== calebe_app_android_v1 ===');
const r = await apiGet(`/${WABA_ID}/message_templates?name=calebe_app_android_v1&fields=name,status,components,language`);
console.log(JSON.stringify(r, null, 2));

// 2. Testar: usar URL do media como header_handle
console.log('\n=== Testando URL-based header_handle ===');
// Já temos media_id salvo
const mediaId = fs.existsSync('/tmp/calebe_media_id.txt') ? fs.readFileSync('/tmp/calebe_media_id.txt', 'utf8').trim() : null;
if (mediaId) {
  const mediaInfo = await apiGet(`/${mediaId}?phone_number_id=${PHONE_ID}`);
  console.log('Media URL:', mediaInfo.url?.slice(0, 100));

  if (mediaInfo.url) {
    // Tentar criar template com URL como header_handle
    const tplTest = await apiPost(`/${WABA_ID}/message_templates`, {
      name: 'calebe_baixe_o_app',
      language: 'pt_BR',
      category: 'MARKETING',
      components: [
        { type: 'HEADER', format: 'IMAGE', example: { header_handle: [mediaInfo.url] } },
        {
          type: 'BODY',
          text: '🔔 *O app Calebe Associados está no ar!*\n\nAcesse seus leads, chat com clientes e a estrutura exclusiva direto do celular.\n\n✅ Dashboard de desempenho\n✅ Chat com leads em tempo real\n✅ Avião, carro e apartamento\n\nBaixe agora para iPhone ou Android!'
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
    console.log('\nTemplate com URL como handle:', tplTest.status || '', JSON.stringify(tplTest, null, 2).slice(0, 500));
    if (tplTest.id) fs.writeFileSync('/tmp/calebe_template_id.txt', String(tplTest.id));
  }
}
