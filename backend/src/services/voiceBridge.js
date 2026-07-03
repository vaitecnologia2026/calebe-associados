// =============================================================================
// voiceBridge.js · 2026-05-12
// Click-to-call mascarado via Twilio Programmable Voice.
//
// Fluxo:
//   1. Corretor toca "Ligar" no app → POST /api/leads/:id/voice-call
//   2. Backend cria token efêmero (memória, 10min) e dispara Twilio API:
//      Twilio.Calls.create({ To: corretor, From: TWILIO_NUMBER, Url: TwiML_URL })
//   3. Twilio liga primeiro pro corretor (To=phone do associate)
//   4. Quando corretor atende, Twilio chama GET /api/voice/twiml/:token
//      Retornamos `<Response><Dial><Number>+lead</Number></Dial></Response>`
//   5. Twilio liga pro lead → conecta as duas pontas
//
// Vantagens:
//   - Telefone real do lead NUNCA é exibido pro corretor
//   - Funciona em mobile e PC (corretor recebe ligação no número dele)
//   - Audit completo via Twilio + nosso AuditEvent
//
// Setup necessário (.env):
//   TWILIO_ACCOUNT_SID=AC...
//   TWILIO_AUTH_TOKEN=...
//   TWILIO_FROM_NUMBER=+1xxxxxxxxxx     (número virtual comprado · pode ser US ou BR)
//   APP_PUBLIC_URL=https://app.calebe.tech   (já usado em outros lugares)
//
// Custo Twilio (referência 2026):
//   - Número BR local: ~US$1/mês
//   - Outbound Brasil: ~US$0,03-0,15/min
//   - Pay-as-you-go (sem fidelidade)
// =============================================================================
import crypto from "node:crypto";

const TOKEN_TTL_MS = 10 * 60 * 1000;  // 10 min
// 2026-06-02 · Token stateless HMAC · em vez de Map in-memory (que quebra em
// PM2 cluster: token criado num worker some pros outros 3, fazendo o webhook
// Twilio retornar "Esta chamada expirou"). Agora self-contained + assinado.
const TOKEN_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET ||
                     process.env.VOICE_TOKEN_SECRET || "fallback-dev-secret-change-me";

export function isEnabled(){
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

function config(){
  if (!isEnabled()) throw Object.assign(new Error("twilio_not_configured"), { status: 503 });
  return {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_FROM_NUMBER,
    baseUrl: (process.env.APP_PUBLIC_URL || "https://app.calebe.tech").replace(/\/+$/, "")
  };
}

// E.164 helper · força +55 se telefone vier nu (10/11 dígitos)
function normalizeE164(phone){
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 12 && digits.startsWith("55")) return "+" + digits;
  if (digits.length === 10 || digits.length === 11) return "+55" + digits;
  return digits.startsWith("+") ? phone : "+" + digits;
}

// Cria token HMAC self-contained · stateless · funciona em PM2 cluster.
// Formato: base64url(JSON(payload)).base64url(HMAC-SHA256(body, secret))
function createToken(payload){
  const exp = Date.now() + TOKEN_TTL_MS;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig  = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function consumeToken(token){
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const idx = token.lastIndexOf(".");
  const body = token.slice(0, idx);
  const sig  = token.slice(idx + 1);
  const expectedSig = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  // Timing-safe compare pra evitar ataque de timing na assinatura
  const ok = sig.length === expectedSig.length &&
             crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  if (!ok) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// Cria uma chamada Twilio: dial corretor primeiro, depois conecta lead via TwiML.
//   corretorPhone: phone do associate (E.164 ou nacional)
//   leadPhone:     phone real do lead, já decrypt
//   meta:          { leadId, associateId } pra audit
export async function placeBridgeCall({ corretorPhone, leadPhone, meta }){
  const { sid, token, from, baseUrl } = config();
  const toCorretor = normalizeE164(corretorPhone);
  const toLead = normalizeE164(leadPhone);
  if (!toCorretor || !toLead) throw Object.assign(new Error("invalid_phone"), { status: 422 });

  const callToken = createToken({ leadPhoneNorm: toLead, leadId: meta?.leadId, associateId: meta?.associateId });
  const twimlUrl = `${baseUrl}/api/voice/twiml/${callToken}`;
  const statusCallbackUrl = `${baseUrl}/api/voice/status`;

  // 2026-05-12 · Gravação ativada · Twilio grava dual-channel (corretor + lead) com aviso LGPD
  // O TwiML do bridge faz `<Dial record="record-from-answer-dual">` pra capturar as 2 vozes
  const recordingStatusUrl = `${baseUrl}/api/voice/recording-status`;
  const body = new URLSearchParams({
    To: toCorretor,
    From: from,
    Url: twimlUrl,
    StatusCallback: statusCallbackUrl,
    "StatusCallbackEvent[0]": "initiated",
    "StatusCallbackEvent[1]": "ringing",
    "StatusCallbackEvent[2]": "answered",
    "StatusCallbackEvent[3]": "completed",
    Timeout: "30",
    // Recording acontece no <Dial> do TwiML (não no Calls.create) · dual-channel + auto webhook
    RecordingStatusCallback: recordingStatusUrl,
    RecordingStatusCallbackEvent: "completed"
  });

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000)
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok){
    const msg = json?.message || "twilio_call_failed";
    throw Object.assign(new Error(msg), { status: r.status, body: json });
  }
  return { ok: true, callSid: json.sid, status: json.status, to: toCorretor };
}

// Gera o TwiML que executa quando o corretor atende:
//   <Response>
//     <Say>Conectando agora com o cliente Calebe</Say>
//     <Dial timeout="30" callerId="+xxx"><Number>+5547999...</Number></Dial>
//   </Response>
export function buildBridgeTwiml(leadPhone, { baseUrl } = {}){
  const { from, baseUrl: defaultBase } = config();
  const safeLead = String(leadPhone || "").replace(/[^\d+]/g, "");
  // 2026-05-12 · LGPD · aviso obrigatório no início + gravação dual-channel
  // O <Dial record="..."> grava de ambas as pontas e dispara o callback de recording quando termina
  const recordingCallback = `${baseUrl || defaultBase}/api/voice/recording-status`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Camila" language="pt-BR">Atenção. Esta ligação será gravada para fins de qualidade e treinamento. Se não concordar, desligue agora. Conectando você com a Calebe Investimentos.</Say>
  <Dial timeout="30" callerId="${from}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackEvent="completed">
    <Number>${safeLead}</Number>
  </Dial>
</Response>`;
}
