// =============================================================================
// test/whatsappRouting.test.mjs · 2026-06-03
// Testa o roteamento multi-número (resolveSendPhoneId): a resposta deve sair
// pelo MESMO número em que o lead falou com a Calebe.
//   node test/whatsappRouting.test.mjs
// =============================================================================
import assert from "node:assert/strict";

// env mínimo pra getConfig() não lançar
process.env.WHATSAPP_CLOUD_TOKEN = process.env.WHATSAPP_CLOUD_TOKEN || "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1055327477675105"; // 9252-3020 (padrão/envio)
process.env.WHATSAPP_WABA_ID = "910162028578816";
delete process.env.WHATSAPP_SENDABLE_PHONE_IDS; // usa o default embutido

const { resolveSendPhoneId } = await import("../src/services/whatsappCloud.js");

const DEFAULT = "1055327477675105"; // 9252-3020
const QUARTO  = "1075588368977371"; // 8846-6727
const SUPORTE = "1143966188797246"; // 9211-7994 (não habilitado p/ leads)

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); pass++; console.log(`  ✓ ${n}`); } catch(e){ fail++; console.log(`  ✗ ${n}\n      ${e.message}`); } };

console.log("\n── Roteamento multi-número ──\n");

test("sem número (null) → usa o padrão (9252-3020)", () => {
  assert.equal(resolveSendPhoneId(null), DEFAULT);
  assert.equal(resolveSendPhoneId(undefined), DEFAULT);
  assert.equal(resolveSendPhoneId(""), DEFAULT);
});
test("lead falou no 8846-6727 → responde pelo 8846-6727", () => {
  assert.equal(resolveSendPhoneId(QUARTO), QUARTO);
});
test("lead falou no número padrão → responde pelo padrão", () => {
  assert.equal(resolveSendPhoneId(DEFAULT), DEFAULT);
});
test("número fora da allowlist (suporte) → cai no padrão (defesa)", () => {
  assert.equal(resolveSendPhoneId(SUPORTE), DEFAULT);
});
test("id desconhecido/lixo → cai no padrão", () => {
  assert.equal(resolveSendPhoneId("999999"), DEFAULT);
  assert.equal(resolveSendPhoneId("  "), DEFAULT);
});

console.log(`\n── ${pass} passou, ${fail} falhou ──\n`);
process.exit(fail === 0 ? 0 : 1);
