// =============================================================================
// Meta CAPI (Conversions API) · envio server-side de eventos para o Facebook
// Pixel + CAPI deduplicam pelo par (event_name, event_id).
// Habilitado quando META_PIXEL_ID e META_CAPI_TOKEN estão definidos no .env.
// META_TEST_EVENT_CODE liga o modo de teste (Events Manager · "Testar eventos").
// =============================================================================
import crypto from "crypto";
import { logger } from "../utils/logger.js";

const PIXEL_ID        = process.env.META_PIXEL_ID || "";
const ACCESS_TOKEN    = process.env.META_CAPI_TOKEN || "";
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || "";
const API_VERSION     = process.env.META_CAPI_VERSION || "v21.0";

export function isCapiEnabled(){
  return Boolean(PIXEL_ID && ACCESS_TOKEN);
}

function sha256(value){
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim().toLowerCase();
  if (!s) return undefined;
  return crypto.createHash("sha256").update(s).digest("hex");
}

function normalizePhone(phone){
  if (!phone) return undefined;
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return undefined;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function normalizeName(name){
  if (!name) return undefined;
  return String(name).trim().toLowerCase().replace(/\s+/g, " ");
}

function clientIpFromReq(req){
  const xff = req.headers?.["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || undefined;
}

function buildUserData(userInput = {}){
  const ud = {};
  const em = sha256(userInput.email);
  const ph = sha256(normalizePhone(userInput.phone));
  const fn = sha256(normalizeName(userInput.firstName));
  const ln = sha256(normalizeName(userInput.lastName));
  const ct = sha256(userInput.city ? String(userInput.city).toLowerCase().replace(/\s+/g, "") : undefined);
  const st = sha256(userInput.state ? String(userInput.state).toLowerCase() : undefined);
  const country = sha256(userInput.country || "br");
  const externalId = sha256(userInput.externalId);

  if (em)         ud.em = [em];
  if (ph)         ud.ph = [ph];
  if (fn)         ud.fn = [fn];
  if (ln)         ud.ln = [ln];
  if (ct)         ud.ct = [ct];
  if (st)         ud.st = [st];
  if (country)    ud.country = [country];
  if (externalId) ud.external_id = [externalId];
  if (userInput.fbp)        ud.fbp = userInput.fbp;
  if (userInput.fbc)        ud.fbc = userInput.fbc;
  if (userInput.ip)         ud.client_ip_address = userInput.ip;
  if (userInput.userAgent)  ud.client_user_agent = userInput.userAgent;
  return ud;
}

export async function sendCapiEvent(payload = {}){
  if (!isCapiEnabled()){
    logger.debug("[capi] desabilitado · faltam META_PIXEL_ID ou META_CAPI_TOKEN");
    return { skipped: true };
  }
  const eventName = payload.eventName || "PageView";
  const eventId   = payload.eventId   || crypto.randomUUID();
  const eventTime = Math.floor(Date.now() / 1000);

  const event = {
    event_name: eventName,
    event_id: eventId,
    event_time: eventTime,
    action_source: "website",
    user_data: buildUserData(payload.user || {})
  };
  if (payload.eventSourceUrl) event.event_source_url = payload.eventSourceUrl;
  if (payload.customData)     event.custom_data = payload.customData;

  const body = { data: [event] };
  if (TEST_EVENT_CODE) body.test_event_code = TEST_EVENT_CODE;

  const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok){
      logger.warn({ status: res.status, json, eventName, eventId }, "[capi] resposta de erro");
      return { ok: false, status: res.status, response: json };
    }
    logger.info({ eventName, eventId, fbtrace: json.fbtrace_id, eventsReceived: json.events_received }, "[capi] evento enviado");
    return { ok: true, eventId, response: json };
  } catch (err){
    logger.error({ err: err.message, eventName, eventId }, "[capi] falha de rede");
    return { ok: false, error: err.message };
  }
}

export function userFromReqAndForm(req, form = {}){
  const fullName = form.name || form.fullName || "";
  const parts = String(fullName).trim().split(/\s+/);
  const firstName = parts.shift() || undefined;
  const lastName  = parts.length ? parts.join(" ") : undefined;
  const cookies = req.cookies || {};
  return {
    email: form.email,
    phone: form.phone,
    firstName,
    lastName,
    city: form.city,
    state: form.creciUf || form.state,
    country: "br",
    externalId: form.cpf || form.externalId,
    fbp: form.fbp || cookies._fbp,
    fbc: form.fbc || cookies._fbc,
    ip: clientIpFromReq(req),
    userAgent: req.headers?.["user-agent"]
  };
}
