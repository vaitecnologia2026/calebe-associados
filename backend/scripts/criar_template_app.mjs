import fs   from 'fs';
import https from 'https';
import { readFileSync } from 'fs';

const envPath = '/root/vaidavenda-calebe/backend/.env';
const envVars = {};
readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
});
const TOKEN   = envVars.WHATSAPP_CLOUD_TOKEN;
const WABA_ID = envVars.WHATSAPP_WABA_ID;
const PHONE_ID = envVars.WHATSAPP_NEW_LEAD_PHONE_IDS.split(',')[0];

function graphPost(urlPath, bodyObj) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v20.0${urlPath}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function multipartUpload(urlPath, filePath) {
  return new Promise((resolve, reject) => {
    const fileContent = fs.readFileSync(filePath);
    const boundary = 'FormBoundary' + Math.random().toString(36).slice(2);
    const headerPart = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="messaging_product"\r\n\r\nwhatsapp\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nimage/png\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="calebe_app_banner.png"\r\nContent-Type: image/png\r\n\r\n`
    );
    const body = Buffer.concat([headerPart, fileContent, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v20.0${urlPath}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 1. Upload imagem (media_id para usar no disparo)
console.log('1. Fazendo upload da imagem (media para disparo)...');
const uploadRes = await multipartUpload(`/${PHONE_ID}/media`, '/tmp/calebe_app_banner.png');
console.log('Upload:', uploadRes.status, JSON.stringify(uploadRes.body));
const mediaId = uploadRes.body?.id;
if (mediaId) {
  fs.writeFileSync('/tmp/calebe_media_id.txt', mediaId);
  console.log('Media ID salvo:', mediaId);
}

// 2. Criar template SEM header_handle (aprovação sem exemplo de imagem)
console.log('\n2. Criando template (sem imagem de exemplo — aprovação mais rápida)...');
const tplRes = await graphPost(`/${WABA_ID}/message_templates`, {
  name: 'calebe_baixe_o_app',
  language: 'pt_BR',
  category: 'MARKETING',
  components: [
    {
      type: 'HEADER',
      format: 'IMAGE'
      // Sem example.header_handle — Meta aprova com base no body
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

console.log('\nTemplate response:', tplRes.status);
console.log(JSON.stringify(tplRes.body, null, 2));

if (tplRes.body?.id) {
  fs.writeFileSync('/tmp/calebe_template_id.txt', String(tplRes.body.id));
  console.log('\n✅ Template criado! Status:', tplRes.body.status, '| ID:', tplRes.body.id);
} else if (tplRes.body?.error?.error_user_msg?.includes('already exists') || tplRes.body?.error?.message?.includes('already exists')) {
  console.log('\n⚠️  Template já existe — verificando status...');
  // Buscar template existente
  const listRes = await graphPost(`/${WABA_ID}/message_templates?name=calebe_baixe_o_app`, {});
  console.log(JSON.stringify(listRes.body, null, 2));
} else {
  console.error('\n❌ Falha:', JSON.stringify(tplRes.body));
}
