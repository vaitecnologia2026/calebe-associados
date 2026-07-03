// =============================================================================
// test/whatsappWindow.test.mjs · 2026-06-03
// Testes da janela de 24h do WhatsApp (cenários obrigatórios do chamado).
// Roda sem framework:  node test/whatsappWindow.test.mjs
// =============================================================================
import assert from "node:assert/strict";
import { isWindowOpen, windowState, windowExpiresAt, lastInboundFrom, WINDOW_MS } from "../src/services/whatsappWindow.js";

let pass = 0, fail = 0;
function test(name, fn){
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e){ fail++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}

const NOW = new Date("2026-06-03T15:00:00.000Z");
const minsAgo  = m => new Date(NOW.getTime() - m * 60 * 1000);
const hoursAgo = h => new Date(NOW.getTime() - h * 60 * 60 * 1000);

console.log("\n── Janela de atendimento WhatsApp · 24h ──\n");

// 1) Cliente respondeu agora → atende livremente
test("1. Cliente respondeu agora → janela ABERTA, sem template", () => {
  const li = lastInboundFrom([{ direction: "inbound", contentType: "text", createdAt: minsAgo(1) }]);
  const w = windowState(li, NOW);
  assert.equal(w.windowOpen, true);
  assert.equal(w.requiresTemplate, false);
});

// 2) Cliente respondeu ÁUDIO → janela abre
test("2. Cliente respondeu ÁUDIO → janela ABERTA", () => {
  const li = lastInboundFrom([{ direction: "inbound", contentType: "audio", createdAt: minsAgo(10) }]);
  assert.equal(isWindowOpen(li, NOW), true);
});

// 3) Cliente respondeu TEXTO → janela abre
test("3. Cliente respondeu TEXTO → janela ABERTA", () => {
  const li = lastInboundFrom([{ direction: "inbound", contentType: "text", createdAt: hoursAgo(2) }]);
  assert.equal(isWindowOpen(li, NOW), true);
});

// 4) Cliente respondeu DEPOIS de template → janela abre (inbound vence o template)
test("4. Inbound APÓS template (outbound) → janela ABERTA", () => {
  const msgs = [
    { direction: "outbound", contentType: "text", createdAt: hoursAgo(3), templateName: "calebe_reabordagem" },
    { direction: "inbound",  contentType: "text", createdAt: hoursAgo(1) }, // resposta do cliente ao template
    { direction: "outbound", contentType: "text", createdAt: minsAgo(30) }  // corretor já respondeu
  ];
  const li = lastInboundFrom(msgs);
  const w = windowState(li, NOW);
  assert.equal(w.windowOpen, true, "inbound após template deve abrir a janela");
  assert.equal(w.requiresTemplate, false);
});

// 5) Cliente NÃO respondeu → janela fechada, exige template
test("5. Sem inbound (só outbound) → janela FECHADA, exige template", () => {
  const msgs = [
    { direction: "outbound", contentType: "text", createdAt: minsAgo(5), templateName: "calebe_abordagem" }
  ];
  const li = lastInboundFrom(msgs);
  assert.equal(li, null);
  const w = windowState(li, NOW);
  assert.equal(w.windowOpen, false);
  assert.equal(w.requiresTemplate, true);
});

// 6) Conversa antiga sem resposta recente → exige template
test("6. Último inbound há 25h → janela FECHADA, exige template", () => {
  const li = lastInboundFrom([{ direction: "inbound", contentType: "text", createdAt: hoursAgo(25) }]);
  const w = windowState(li, NOW);
  assert.equal(w.windowOpen, false);
  assert.equal(w.requiresTemplate, true);
});

// 7) Tempo real: webhook grava inbound → recálculo reflete janela ABERTA
test("7. Webhook grava inbound novo → recálculo reflete janela ABERTA", () => {
  // estado anterior: janela fechada (inbound antigo)
  let li = lastInboundFrom([{ direction: "inbound", createdAt: hoursAgo(30) }]);
  assert.equal(isWindowOpen(li, NOW), false, "antes do webhook deve estar fechada");
  // chega inbound novo (o que o webhook persiste) → recalcula
  li = lastInboundFrom([
    { direction: "inbound", createdAt: hoursAgo(30) },
    { direction: "inbound", createdAt: NOW } // novo inbound do webhook
  ]);
  assert.equal(isWindowOpen(li, NOW), true, "após webhook deve abrir");
});

// — Bordas —
test("borda: exatamente 24h - 1s → ABERTA", () => {
  assert.equal(isWindowOpen(new Date(NOW.getTime() - (WINDOW_MS - 1000)), NOW), true);
});
test("borda: exatamente 24h + 1s → FECHADA", () => {
  assert.equal(isWindowOpen(new Date(NOW.getTime() - (WINDOW_MS + 1000)), NOW), false);
});
test("borda: lastInboundAt null → FECHADA", () => {
  assert.equal(isWindowOpen(null, NOW), false);
  assert.equal(windowState(null, NOW).requiresTemplate, true);
});
test("borda: data inválida → FECHADA (não quebra)", () => {
  assert.equal(isWindowOpen("not-a-date", NOW), false);
});
test("windowExpiresAt = lastInbound + 24h", () => {
  const li = hoursAgo(1);
  assert.equal(windowExpiresAt(li).getTime(), li.getTime() + WINDOW_MS);
});
test("pega o inbound MAIS RECENTE entre vários", () => {
  const li = lastInboundFrom([
    { direction: "inbound", createdAt: hoursAgo(40) },
    { direction: "inbound", createdAt: hoursAgo(2) },
    { direction: "inbound", createdAt: hoursAgo(50) }
  ]);
  assert.equal(li.getTime(), hoursAgo(2).getTime());
});
test("ignora outbound no cálculo do lastInbound", () => {
  const li = lastInboundFrom([
    { direction: "inbound",  createdAt: hoursAgo(10) },
    { direction: "outbound", createdAt: minsAgo(1) }
  ]);
  assert.equal(li.getTime(), hoursAgo(10).getTime());
});

console.log(`\n── ${pass} passou, ${fail} falhou ──\n`);
process.exit(fail === 0 ? 0 : 1);
