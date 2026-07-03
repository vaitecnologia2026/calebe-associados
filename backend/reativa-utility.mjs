import { db } from "./src/db.js";
import { decrypt } from "./src/crypto.js";
import { sendTemplate } from "./src/services/whatsappCloud.js";
const TPL = "calebe_cadastro_confirmado_u";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rows = await db.$queryRawUnsafe(`
  SELECT DISTINCT ON (l.id) l.id, l.name, l."phoneEncrypted", c."inboundPhoneId"
  FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId" JOIN "Lead" l ON l.id=c."leadId"
  WHERE m."errorReason" LIKE '131049%' AND m."createdAt" > now() - interval '48 hours'
    AND l."phoneEncrypted" IS NOT NULL AND COALESCE(l."noWhatsApp",false)=false
  ORDER BY l.id, m."createdAt" DESC`);
console.log(`[reativa] alvo: ${rows.length} leads | template ${TPL}`);
let ok=0, fail=0; const errs={};
for (let i=0;i<rows.length;i++){
  const r=rows[i]; let phone="";
  try{ phone=decrypt(r.phoneEncrypted).replace(/\D/g,""); }catch{ fail++; errs.decrypt=(errs.decrypt||0)+1; continue; }
  if(!phone){ fail++; errs.nophone=(errs.nophone||0)+1; continue; }
  const first=(r.name||"").trim().split(/\s+/)[0]||"Ola";
  try{
    const res=await sendTemplate({ to:phone, templateName:TPL, languageCode:"pt_BR", bodyParams:[first], phoneNumberId:r.inboundPhoneId||null });
    if(res&&res.ok) ok++; else { fail++; const k=(res&&(res.error||res.status))||"unknown"; errs[k]=(errs[k]||0)+1; }
  }catch(e){ fail++; errs[e.message||"throw"]=(errs[e.message||"throw"]||0)+1; }
  if((i+1)%100===0) console.log(`[reativa] ${i+1}/${rows.length} | ok=${ok} fail=${fail}`);
  await sleep(250);
}
console.log(`[reativa] FIM | ok=${ok} fail=${fail} | erros=${JSON.stringify(errs)}`);
process.exit(0);
