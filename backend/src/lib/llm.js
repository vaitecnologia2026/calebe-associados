// =============================================================================
// LLM provider-agnóstico · usado pelo /api/ia/* (Assistente IA admin)
// -----------------------------------------------------------------------------
// Lê provider / chave / modelo da tabela SystemSetting (key/value JSON):
//   - ia.provider  → "anthropic" (default) | "openai"
//   - ia.apiKey    → string (chave da Anthropic ou OpenAI)
//   - ia.model     → string opcional (override do default do provider)
//
// Sem chave → llmConfigurado() = false → rota cai no modo demo (sem 503).
// Provider implementado via fetch puro (sem SDK) pra evitar dependência extra.
// =============================================================================
import { db } from "../db.js";

const DEFAULT_MODEL = {
  anthropic: "claude-haiku-4-5-20251001", // mais barato/atual em mai/2026
  openai:    "gpt-4o-mini",
};

// SystemSetting.value é JSON · pra strings simples salvamos como string JSON
// ("\"sk-ant-...\""). Quando vier null/undefined devolve "".
function asString(v){
  if (v == null) return "";
  if (typeof v === "string") return v;
  // Caso o valor tenha sido salvo como objeto no JSON, descarta · só interessam strings aqui.
  try { return String(v); } catch { return ""; }
}

async function lerConfig(){
  const rows = await db.systemSetting.findMany({
    where: { key: { in: ["ia.provider", "ia.apiKey", "ia.model"] } }
  });
  const m = Object.fromEntries(rows.map((r) => [r.key, asString(r.value)]));
  const provider = (m["ia.provider"] || "anthropic").toLowerCase();
  return {
    provider,
    apiKey: (m["ia.apiKey"] || "").trim(),
    model:  (m["ia.model"]  || "").trim(),
  };
}

export async function llmConfigurado(){
  const c = await lerConfig();
  return !!c.apiKey;
}

export async function statusLLM(){
  const c = await lerConfig();
  return {
    configurado: !!c.apiKey,
    provider: c.provider,
    model: c.model || DEFAULT_MODEL[c.provider] || ""
    // NUNCA expor c.apiKey aqui.
  };
}

export async function chamarLLM({ system, messages, maxTokens = 700 }){
  const c = await lerConfig();
  if (!c.apiKey) throw new Error("llm_nao_configurado");
  const model = c.model || DEFAULT_MODEL[c.provider] || DEFAULT_MODEL.anthropic;
  const signal = (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(20000) : undefined;

  if (c.provider === "openai"){
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.4,
        messages: [{ role: "system", content: system }, ...messages]
      }),
      signal
    });
    if (!r.ok) throw new Error(`openai_${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return (j.choices?.[0]?.message?.content || "").trim();
  }

  // Anthropic (default)
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": c.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content }))
    }),
    signal
  });
  if (!r.ok) throw new Error(`anthropic_${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.content?.[0]?.text || "").trim();
}
