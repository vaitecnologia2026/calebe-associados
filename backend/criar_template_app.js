const fs   = require('fs');
const https = require('https');
const path  = require('path');

require('dotenv').config({ path: '/root/vaidavenda-calebe/backend/.env' });

const TOKEN   = process.env.WHATSAPP_CLOUD_TOKEN;
const WABA_ID = process.env.WHATSAPP_WABA_ID;
const PHONE_ID = process.env.WHATSAPP_NEW_LEAD_PHONE_IDS.split(',')[0];

function apiCall(method, urlPath, bodyObj) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v20.0${urlPath}`,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function multipartUpload(urlPath, filePath) {
  return new Promise((resolve, reject) => {
    const fileContent = fs.readFileSync(filePath);
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="messaging_product"\r\n\r\nwhatsapp`,
      `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nimage/png`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="calebe_app_banner.png"\r\nContent-Type: image/png\r\n`,
    ];
    const body = Buffer.concat([
      Buffer.from(parts.join('\r\n') + '\r\n'),
      fileContent,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v20.0${urlPath}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  // 1. Upload imagem
  console.log('1. Enviando imagem para WhatsApp...');
  const uploadRes = await multipartUpload(`/${PHONE_ID}/media`, '/tmp/calebe_app_banner.png');
  console.log('Status:', uploadRes.status, JSON.stringify(uploadRes.body));

  if (!uploadRes.body?.id) { console.error('Upload falhou!'); process.exit(1); }
  const mediaId = uploadRes.body.id;
  console.log('Media ID:', mediaId);
  fs.writeFileSync('/tmp/calebe_media_id.txt', mediaId);

  // 2. Criar template
  console.log('\n2. Criando template no Meta...');
  const tplRes = await apiCall('POST', `/${WABA_ID}/message_templates`, {
    name: 'calebe_baixe_o_app',
    language: 'pt_BR',
    category: 'MARKETING',
    components: [
      {
        type: 'HEADER',
        format: 'IMAGE',
        example: { header_handle: [mediaId] }
      },
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

  console.log('Template response:', JSON.stringify(tplRes.body, null, 2));
  if (tplRes.body?.id) {
    fs.writeFileSync('/tmp/calebe_template_id.txt', String(tplRes.body.id));
    console.log('\n✅ Template:', tplRes.body.status, '| ID:', tplRes.body.id);
  } else {
    console.error('\n❌ Falha:', JSON.stringify(tplRes.body));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
