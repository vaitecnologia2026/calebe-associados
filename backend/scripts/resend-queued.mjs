// One-shot: reabordar leads cuja msg do corretor falhou por janela 24h.
// 1. Lista failed com codes elegiveis (131047/131049/130472) nas ultimas 48h
// 2. Por conversation:
//    - marca todas as failed elegiveis como messageStatus="queued_for_resend"
//    - dispara template calebe_abordagem_v2 [primeiroNome]
// 3. Imprime relatorio
// Quando lead responder, processInboundMessage drena automaticamente via cloudSendText.
import { db } from "../src/db.js";
import { sendTemplate, isEnabled } from "../src/services/whatsappCloud.js";
import { decrypt } from "../src/crypto.js";

const TEMPLATE_NAME = "calebe_abordagem_v2";
const TEMPLATE_LANG = "pt_BR";
const ELIGIBLE_CODES = ["131047", "131049", "130472"];

async function main(){
  if (!isEnabled()){
    console.error("whatsapp_cloud disabled (cheque env vars)");
    process.exit(1);
  }
  console.log("Buscando mensagens failed elegiveis para reabordagem...");
  const since = new Date(Date.now() - 48 * 3600 * 1000);
  const failed = await db.message.findMany({
    where: {
      direction: "outbound",
      messageStatus: "failed",
      createdAt: { gte: since },
      provider: "whatsapp_cloud"
    },
    include: { conversation: { include: { lead: true, associate: { include: { user: true } } } } },
    orderBy: { createdAt: "asc" }
  });
  // Filtra por codigo elegivel
  const eligible = failed.filter(m => {
    const reason = m.errorReason || "";
    const code = (reason.split(":")[0] || "").trim();
    return ELIGIBLE_CODES.includes(code);
  });
  console.log(`Total failed (48h): ${failed.length} · elegiveis: ${eligible.length}`);

  // Agrupa por conversa, ordenado pela primeira msg
  const byConv = new Map();
  for (const m of eligible){
    if (!byConv.has(m.conversationId)) byConv.set(m.conversationId, []);
    byConv.get(m.conversationId).push(m);
  }
  console.log(`Conversas unicas: ${byConv.size}`);

  let convOk = 0, convFail = 0, msgsMarked = 0;
  for (const [convId, msgs] of byConv){
    const conv = msgs[0].conversation;
    const lead = conv?.lead;
    const corretor = conv?.associate?.user?.email || "(sem corretor)";
    if (!lead){
      console.log(`  ⚠ conv ${convId} sem lead, skip`);
      convFail++;
      continue;
    }
    // Decrypt phone
    let phone = null;
    try { phone = decrypt(lead.phoneEncrypted); } catch (e) {
      console.log(`  ⚠ ${lead.name}: phone decrypt falhou (${e.message}), skip`);
      convFail++;
      continue;
    }
    const phoneDigits = String(phone).replace(/\D/g, "");
    if (!phoneDigits){
      console.log(`  ⚠ ${lead.name}: phone vazio, skip`);
      convFail++;
      continue;
    }
    const primeiroNome = (lead.name || "").split(/\s+/)[0] || "tudo bem";
    console.log(`→ ${lead.name} (corretor ${corretor}) · ${msgs.length} msg(s) presa(s) · template ${TEMPLATE_NAME}[${primeiroNome}]`);

    // 1. Marca msgs como queued_for_resend (mantem text original)
    const ids = msgs.map(m => m.id);
    await db.message.updateMany({
      where: { id: { in: ids } },
      data: {
        messageStatus: "queued_for_resend",
        errorReason: null,
        failedAt: null
      }
    });
    msgsMarked += msgs.length;

    // 2. Dispara template
    try {
      const r = await sendTemplate({
        to: phoneDigits,
        templateName: TEMPLATE_NAME,
        languageCode: TEMPLATE_LANG,
        bodyParams: [primeiroNome]
      });
      if (r.ok){
        console.log(`  ✅ template enviado · wamid ${r.messageId}`);
        convOk++;
        // Persiste a msg do template no historico (provider=whatsapp_cloud, status=sent)
        await db.message.create({
          data: {
            conversationId: convId,
            direction: "outbound",
            fromRole: "system",
            text: `[template ${TEMPLATE_NAME}] Ola ${primeiroNome}, tudo bem com voce?`,
            contentType: "text",
            provider: "whatsapp_cloud",
            templateName: TEMPLATE_NAME,
            whatsappMessageId: r.messageId || null,
            messageStatus: "sent",
            deliveredAt: new Date()
          }
        }).catch(e => console.log(`  ⚠ falha ao persistir msg do template: ${e.message}`));
      } else {
        console.log(`  ❌ template falhou · ${r.code || ""} · ${r.error || ""}`);
        convFail++;
      }
    } catch (e){
      console.log(`  💥 excecao no template: ${e.message}`);
      convFail++;
    }

    // throttle entre disparos pra nao estourar rate-limit Meta
    await new Promise(rs => setTimeout(rs, 400));
  }

  console.log(`\n=== RESUMO ===`);
  console.log(`Conversas processadas: ${byConv.size}`);
  console.log(`Templates enviados OK: ${convOk}`);
  console.log(`Falhas no template:    ${convFail}`);
  console.log(`Msgs marcadas como queued_for_resend: ${msgsMarked}`);
  console.log(`Quando o lead responder, drainQueuedOutbound entrega o texto original.`);
  process.exit(0);
}
main().catch((e) => { console.error("erro fatal:", e); process.exit(1); });
