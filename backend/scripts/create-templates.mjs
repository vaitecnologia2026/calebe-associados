// Submete 4 templates novos ao Meta WABA (standalone, sem importar do service).
const TOKEN   = process.env.WHATSAPP_CLOUD_TOKEN;
const WABA_ID = process.env.WHATSAPP_WABA_ID;
const VER     = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

if (!TOKEN || !WABA_ID){
  console.error("Faltando WHATSAPP_CLOUD_TOKEN ou WHATSAPP_WABA_ID no env");
  process.exit(1);
}

const TEMPLATES = [
  { name: "calebe_bom_dia_v1",         text: "Bom dia {{1}}, tudo bem?" },
  { name: "calebe_boa_tarde_v1",       text: "Boa tarde {{1}}, tudo certo?" },
  { name: "calebe_boa_noite_v1",       text: "Boa noite {{1}}, como vai?" },
  { name: "calebe_algo_importante_v1", text: "Olá {{1}}, tenho algo importante pra você!" }
];

async function createOne(tpl){
  const payload = {
    name: tpl.name,
    language: "pt_BR",
    category: "MARKETING",
    components: [
      { type: "BODY", text: tpl.text, example: { body_text: [["Carlos"]] } }
    ]
  };
  const res = await fetch(`https://graph.facebook.com/${VER}/${WABA_ID}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: j };
}

(async () => {
  console.log(`Submetendo ${TEMPLATES.length} templates ao WABA ${WABA_ID} (v${VER})...`);
  for (const tpl of TEMPLATES){
    process.stdout.write(`→ ${tpl.name.padEnd(32)} `);
    const r = await createOne(tpl);
    if (r.ok){
      console.log(`✅ id=${r.body.id || "?"} status=${r.body.status || "submitted"} category=${r.body.category || "MARKETING"}`);
    } else {
      const err = r.body?.error || {};
      const code = err.code || "?";
      const msg  = err.message || JSON.stringify(r.body).slice(0, 200);
      if (/already exists|name has already/i.test(msg)){
        console.log(`⚠ ja existe (skip)`);
      } else {
        console.log(`❌ http=${r.status} code=${code} msg=${msg}`);
      }
    }
  }
  console.log("\nPronto. Status de aprovacao chega via webhook /api/webhooks/whatsapp-cloud-templates (se configurado) ou em minutos a 24h no Business Manager.");
})();
