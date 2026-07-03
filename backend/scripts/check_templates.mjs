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

function get(urlPath) {
  return new Promise((resolve, reject) => {
    https.request({ hostname: 'graph.facebook.com', path: `/v20.0${urlPath}`, headers: { Authorization: `Bearer ${TOKEN}` } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on('error', reject).end();
  });
}

// Ver templates com IMAGE header
const r = await get(`/${WABA_ID}/message_templates?fields=name,status,components&limit=100`);
const imgTpls = (r.data || []).filter(t => t.components?.some(c => c.type === 'HEADER' && c.format === 'IMAGE'));
console.log(`Templates com IMAGE header (${imgTpls.length}):`);
imgTpls.forEach(t => {
  const h = t.components.find(c => c.type === 'HEADER');
  console.log(`- ${t.name} [${t.status}] example:`, JSON.stringify(h?.example));
});

// Tentar rupload com session ID completo incluindo 'upload:' prefixo
console.log('\n--- TENTANDO RUPLOAD ---');
const imgBuf = fs.readFileSync('/tmp/calebe_app_banner.png');

// 1. Criar nova sessão
const sessR = await new Promise((resolve, reject) => {
  const body = JSON.stringify({ file_name: 'banner.png', file_length: imgBuf.length, file_type: 'image/png' });
  const req = https.request({ hostname: 'graph.facebook.com', path: '/v20.0/app/uploads', method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
  }).on('error', reject);
  req.write(body); req.end();
});
console.log('Session:', JSON.stringify(sessR));

if (!sessR.id) { console.log('sem sessão'); process.exit(0); }

// Testar com sessionId completo (sem remover 'upload:')
const sessionFull = sessR.id; // "upload:BASE64...?sig=..."
const sessionNoPrefix = sessR.id.replace(/^upload:/, '');
const [b64, sigRaw] = sessionNoPrefix.split('?sig=');
const sig = sigRaw || '';

console.log('b64 length:', b64.length, '| sig:', sig);

// Tentar diferentes formatos de path
const paths = [
  `/whatsapp-business-uploads/${sessionNoPrefix}`,
  `/whatsapp-business-uploads/${encodeURIComponent(b64)}?sig=${encodeURIComponent(sig)}`,
  `/whatsapp-business-uploads/${sessionFull}`,
];

for (const p of paths) {
  console.log('\nTentando path:', p.slice(0, 80) + '...');
  const r2 = await new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'rupload.facebook.com', path: p, method: 'POST', headers: { Authorization: `OAuth ${TOKEN}`, 'Content-Type': 'image/png', 'file_offset': '0', 'Content-Length': imgBuf.length } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve({ s: res.statusCode, b: JSON.parse(d) }); } catch { resolve({ s: res.statusCode, b: d }); } });
    }).on('error', reject);
    req.write(imgBuf); req.end();
  });
  console.log('Status:', r2.s, '| Response:', JSON.stringify(r2.b).slice(0, 200));
  if (r2.b?.h) {
    console.log('\n✅ GOT HANDLE:', r2.b.h);
    fs.writeFileSync('/tmp/calebe_header_handle.txt', r2.b.h);
    break;
  }
}
