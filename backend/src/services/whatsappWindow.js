// =============================================================================
// services/whatsappWindow.js · 2026-06-03
// FONTE ÚNICA DE VERDADE da janela de atendimento de 24h do WhatsApp.
//
// Regra oficial Meta (customer service window): a janela de mensagem livre
// (texto/áudio/qualquer conteúdo sem template) fica ABERTA por 24h a partir da
// ÚLTIMA mensagem INBOUND do cliente. Qualquer inbound (texto, áudio, imagem…)
// reabre a janela. Fora dela, só template aprovado.
//
// Antes desta data o cálculo vivia espalhado e só no frontend (a partir das
// mensagens carregadas na tela), o que travava o atendimento quando o estado
// estava velho (SSE caiu / app em background). Agora o backend é autoritativo:
// calcula a janela a partir de `Conversation.lastInboundAt` (ou da própria
// lista de mensagens) e devolve `windowOpen` pra UI.
//
// PURO e SEM dependências de propósito → testável isoladamente (ver
// test/whatsappWindow.test.mjs).
// =============================================================================

export const WINDOW_HOURS = 24;
export const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

function toMillis(value){
  if (value == null) return null;
  if (value instanceof Date){
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * A janela está aberta? (true se houve inbound do cliente nas últimas 24h)
 * @param {Date|string|number|null} lastInboundAt
 * @param {Date} [now]
 */
export function isWindowOpen(lastInboundAt, now = new Date()){
  const t = toMillis(lastInboundAt);
  if (t === null) return false;
  const nowMs = toMillis(now) ?? Date.now();
  return (nowMs - t) < WINDOW_MS;
}

/** Quando a janela expira (lastInbound + 24h), ou null se nunca houve inbound. */
export function windowExpiresAt(lastInboundAt){
  const t = toMillis(lastInboundAt);
  if (t === null) return null;
  return new Date(t + WINDOW_MS);
}

/**
 * Estado completo da janela pra resposta da API / payload SSE.
 * @returns {{windowOpen:boolean, requiresTemplate:boolean, lastInboundAt:string|null, windowExpiresAt:string|null}}
 */
export function windowState(lastInboundAt, now = new Date()){
  const open = isWindowOpen(lastInboundAt, now);
  const exp = windowExpiresAt(lastInboundAt);
  const li = toMillis(lastInboundAt);
  return {
    windowOpen: open,
    requiresTemplate: !open,
    lastInboundAt: li === null ? null : new Date(li).toISOString(),
    windowExpiresAt: exp ? exp.toISOString() : null
  };
}

/**
 * Deriva o lastInboundAt (Date) a partir de uma lista de mensagens — a fonte de
 * verdade definitiva. Aceita direction "inbound"/"IN". Ignora o resto.
 * Usado no endpoint de mensagens (que já carrega o histórico completo) pra
 * garantir janela correta mesmo se a coluna denormalizada estiver atrasada.
 */
export function lastInboundFrom(messages){
  let max = null;
  for (const m of (messages || [])){
    const dir = m?.direction;
    if (dir !== "inbound" && dir !== "IN") continue;
    const t = toMillis(m.createdAt ?? m.at ?? m.deliveredAt);
    if (t !== null && (max === null || t > max)) max = t;
  }
  return max === null ? null : new Date(max);
}
