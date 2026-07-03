// =============================================================================
// Cliente da API VAI (vaicrm.com.br) — Fluxo real de produção
// Autenticação: POST /auth/login (JWT expira em 1h · refresh a cada 55min)
// Docs internas: calebe_api_doc.docx · Projeto Calebe Imobiliária
// =============================================================================
import { logger } from "../utils/logger.js";
import { db } from "../db.js";
import { normalizePhone, sha256Hex } from "../crypto.js";

// Config VAI · inicia com .env, depois enriquece com valores salvos via UI (/api/settings)
// Ordem de precedência: banco > .env > default. Alterações aplicam após restart do backend.
const cfg = {
  base:       process.env.VAI_API_BASE_URL || "https://api.vaicrm.com.br",
  email:      process.env.VAI_LOGIN_EMAIL  || "",
  password:   process.env.VAI_LOGIN_PASSWORD || "",
  channelId:  process.env.VAI_CHANNEL_ID || "",
  flowSecret: process.env.VAI_FLOW_SECRET || ""
};

export async function reloadVaiConfig(){
  const keys = ["vai.apiBaseUrl","vai.loginEmail","vai.loginPassword","vai.channelId","vai.flowSecret"];
  try {
    const rows = await db.systemSetting.findMany({ where: { key: { in: keys } } });
    const map = new Map();
    for (const s of rows){
      const v = (typeof s.value === "string") ? s.value : (s.value?.value ?? s.value);
      if (v !== null && v !== undefined && v !== "") map.set(s.key, String(v));
    }
    if (map.get("vai.apiBaseUrl"))    cfg.base       = map.get("vai.apiBaseUrl");
    if (map.get("vai.loginEmail"))    cfg.email      = map.get("vai.loginEmail");
    if (map.get("vai.loginPassword")) cfg.password   = map.get("vai.loginPassword");
    if (map.get("vai.channelId"))     cfg.channelId  = map.get("vai.channelId");
    if (map.get("vai.flowSecret"))    cfg.flowSecret = map.get("vai.flowSecret");
    // invalida token pra forçar re-login com as novas credenciais
    accessToken = ""; tokenExpiresAt = 0; cachedChannelId = "";
    logger.info({ base: cfg.base, hasEmail: !!cfg.email, hasChannelId: !!cfg.channelId, hasFlowSecret: !!cfg.flowSecret }, "🔄 VAI config recarregada do banco");
    return { ok: true };
  } catch (e){
    logger.warn({ err: e.message }, "VAI config: usando apenas .env (banco indisponível)");
    return { ok: false, error: e.message };
  }
}

// Dispara o primeiro load no boot (async · não bloqueia o import)
reloadVaiConfig().catch(() => {});

const EMAIL = () => cfg.email;
const PASSWORD = () => cfg.password;
const CHANNEL_ID_ENV = () => cfg.channelId;
export const getVaiFlowSecret = () => cfg.flowSecret;

// ----- Estado em memória (token + channelId) --------------------------------
let accessToken = "";
let refreshToken = "";
let tokenExpiresAt = 0;           // epoch ms
let cachedChannelId = "";
let loginInFlight = null;         // Promise para evitar race

class VaiError extends Error {
  constructor(msg, status, body){ super(msg); this.status = status; this.body = body; }
}

/** Detecta mensagens de "atividade" do CRM VAI (eventos de start/close de
 *  atendimento, transferencia, etc) que NAO devem aparecer como mensagem real
 *  no chat dos corretores. Identificacao por contentType (activity/system/event)
 *  ou por padrao textual conhecido. Usado em webhooks (gravacao) e em sync-vai.
 *  Conservador: so casa textos curtos com o padrao "<verbo> o atendimento". */
export function isVaiActivity({ type, contentType, content, text } = {}){
  const ct = String(type || contentType || "").toLowerCase();
  if (ct === "activity" || ct === "system" || ct === "event") return true;
  const t = String(content ?? text ?? "");
  if (!t) return false;
  return /\b(iniciou|encerrou|transferiu|assumiu|finalizou|reabriu)\s+o\s+atendimento\b/i.test(t);
}

/** Normaliza telefone BR para E.164 com prefixo "+".
 *  Regra VAI · WhatsApp: quando o DDD for > 31, remove o nono dígito (convenção legada).
 *  - "(11) 99123-4234" → "+5511991234234"  (DDD 11 · mantém o 9)
 *  - "(31) 99123-4234" → "+5531991234234"  (DDD 31 · mantém o 9)
 *  - "(47) 99123-4234" → "+554791234234"   (DDD 47 > 31 · remove o 9)
 *  - "(11) 3333-4444"  → "+551133334444"   (fixo · não afetado)
 */
export function toE164(phoneRaw){
  if (!phoneRaw) return "";
  let digits = String(phoneRaw).replace(/\D/g, "");
  if (!digits) return "";
  if (!digits.startsWith("55")) {
    if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  }
  // DDD > 31 · número com 13 dígitos (55 + DDD + 9 + 8 locais) · remove o 9
  if (digits.length === 13 && digits.startsWith("55")) {
    const ddd = parseInt(digits.slice(2, 4), 10);
    if (ddd > 31 && digits[4] === "9") {
      digits = digits.slice(0, 4) + digits.slice(5);
    }
  }
  return "+" + digits;
}

// ----- Auth ------------------------------------------------------------------

async function doLogin(){
  if (!EMAIL() || !PASSWORD()){
    throw new VaiError("VAI_LOGIN_EMAIL/VAI_LOGIN_PASSWORD não configurados", 503);
  }
  const res = await fetch(cfg.base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ email: EMAIL(), password: PASSWORD() })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok){
    throw new VaiError(data?.message || data?.error || ("login HTTP " + res.status), res.status, data);
  }
  accessToken = data.access_token || data.accessToken || data.token || "";
  refreshToken = data.refresh_token || data.refreshToken || "";
  // Token da VAI expira em 1h · renovamos 5min antes
  tokenExpiresAt = Date.now() + 55 * 60 * 1000;
  if (!accessToken) throw new VaiError("login sem access_token", 502, data);
  logger.info("vai_login_ok");
  return accessToken;
}

async function doRefresh(){
  if (!refreshToken) return doLogin();
  try {
    const res = await fetch(cfg.base + "/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken, refreshToken })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok){
      logger.warn({ status: res.status }, "vai_refresh_failed · relogin");
      return doLogin();
    }
    accessToken = data.access_token || data.accessToken || data.token || accessToken;
    refreshToken = data.refresh_token || data.refreshToken || refreshToken;
    tokenExpiresAt = Date.now() + 55 * 60 * 1000;
    return accessToken;
  } catch {
    return doLogin();
  }
}

async function getToken(force = false){
  if (force) accessToken = "";
  if (!accessToken || Date.now() >= tokenExpiresAt){
    if (!loginInFlight){
      loginInFlight = (refreshToken ? doRefresh() : doLogin())
        .finally(() => { loginInFlight = null; });
    }
    await loginInFlight;
  }
  return accessToken;
}

// ----- Fetch com retry em 401 -----------------------------------------------

async function vaiFetch(path, { method = "GET", body, headers = {}, retry = true } = {}){
  const token = await getToken();
  const init = {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  };
  // 2026-05-07 · trace de TODA chamada VAI · ASCII puro p/ grep confiável
  const _t0 = Date.now();
  logger.info({ trace: "VAI_TRACE", op: "fetch_start", method, path, body: body || null }, "VAI_TRACE op=fetch_start");
  let res, data;
  try {
    res = await fetch(cfg.base + path, init);
    data = await res.json().catch(() => ({}));
  } catch (e){
    logger.warn({ trace: "VAI_TRACE", op: "fetch_network_fail", method, path, err: e.message, ms: Date.now()-_t0 }, "VAI_TRACE op=fetch_network_fail");
    throw new VaiError("vai_network: " + e.message, 0, null);
  }
  logger.info({ trace: "VAI_TRACE", op: "fetch_done", method, path, status: res.status, ms: Date.now()-_t0, dataId: data?.id || null, dataStatus: data?.status || null, dataKeys: data && typeof data === "object" ? Object.keys(data).slice(0,15) : null }, "VAI_TRACE op=fetch_done");
  if (res.status === 401 && retry){
    await getToken(true);
    return vaiFetch(path, { method, body, headers, retry: false });
  }
  if (!res.ok){
    logger.warn({ trace: "VAI_TRACE", op: "fetch_http_error", path, status: res.status, msg: data?.message || data?.error, dataFull: data }, "VAI_TRACE op=fetch_http_error · vai_http_error");
    throw new VaiError(data?.message || data?.error || ("HTTP " + res.status), res.status, data);
  }
  return data;
}

// ===== CHANNELS ==============================================================

/** Busca e faz cache do channelId WhatsApp do tenant Calebe. */
export async function vaiGetChannelId(){
  if (cachedChannelId) return cachedChannelId;
  if (CHANNEL_ID_ENV()){ cachedChannelId = CHANNEL_ID_ENV(); return cachedChannelId; }
  const list = await vaiFetch("/channels/type/whatsapp");
  const arr = Array.isArray(list) ? list : (list?.data || []);
  const first = arr.find(c => c.status === "connected") || arr[0];
  if (!first?.id) throw new VaiError("nenhum canal WhatsApp encontrado", 404, list);
  cachedChannelId = first.id;
  return cachedChannelId;
}

export async function vaiListChannels(){
  return vaiFetch("/channels/type/whatsapp");
}

// ===== CONTATOS ==============================================================

export async function vaiListContacts(params = {}){
  const qs = new URLSearchParams(params).toString();
  return vaiFetch("/contacts" + (qs ? "?" + qs : ""));
}

export async function vaiGetContact(contactId){
  return vaiFetch(`/contacts/${contactId}`);
}

/**
 * Extrai identificadores do objeto de contato VAI.
 * WhatsApp trabalha com 2 endereços: phone (@s.whatsapp.net) e LID (@lid).
 * Mesmo contato pode receber msgs por ambos — precisamos casar os dois.
 */
export function extractContactIds(contact){
  if (!contact || typeof contact !== "object") return { id: null, phone: null, lid: null };
  const cd = contact.channelData || {};
  const meta = cd.whatsapp || cd || {};
  let lid = meta.lid || cd.lid || contact.lid || null;
  // LID bruto vem como "34283049750568:80@lid" — extraímos só o número ou mantemos inteiro
  if (lid && typeof lid === "string") lid = lid.trim();
  const phone = contact.identifier || contact.phone || null;
  return { id: contact.id || null, phone, lid };
}

export async function vaiCreateContact({ name, phone, email, externalId, customFields }){
  const e164 = toE164(phone);
  if (!e164) throw new VaiError("phone inválido", 400);
  // 2026-05-07 · Payload IDÊNTICO ao script Python validado (vai_crm_teste.py).
  // 6 campos exatos · NÃO inclui customFields (script novo removeu):
  //   {"name":"...","channel":"whatsapp","identifier":"555180341965",
  //    "phone":"555180341965","addressingMode":"pn","email":""}
  // Pontos chave:
  //   - identifier: dígitos puros sem "+" (toE164 já tira nono dígito p/ DDD>31)
  //   - phone: MESMO valor do identifier
  //   - addressingMode: "pn" (phone number)
  const identifier = e164.replace(/^\+/, "");
  return vaiFetch("/contacts", {
    method: "POST",
    body: {
      name,
      channel: "whatsapp",
      identifier,
      phone: identifier,
      addressingMode: "pn",
      email: ""
    }
  });
}

/**
 * Procura contato por phone ou LID. Cria se nenhum bater.
 * Anti-colisão WhatsApp: mesmo cliente pode aparecer como phone (@s.whatsapp.net)
 * OU como LID (@lid). Verificamos ambos antes de criar um novo.
 * Ordem de busca:
 *   1. phone E.164 (mais comum)
 *   2. LID (se já conhecido via webhook prévio)
 */
export async function vaiFindOrCreateContact({ name, phone, email, externalId, customFields, lid }){
  const e164 = toE164(phone);
  if (!e164) throw new VaiError("phone inválido", 400);
  const identifierNoPlus = e164.replace(/^\+/, ""); // formato novo da VAI
  const last10 = identifierNoPlus.slice(-10);
  // Matcher estrito: aceita só hits cujo identifier ou phone bate o número exato
  // OU termina nos últimos 10 dígitos. Evita pegar contato errado quando search
  // da VAI tem indice fraco (causou bug do Caio Falcão pegando LID-órfão).
  const matches = c => {
    const idDigits = (c.identifier || "").replace(/\D/g, "");
    const phDigits = (c.phone || "").replace(/\D/g, "");
    return idDigits === identifierNoPlus
        || phDigits === identifierNoPlus
        || (last10 && last10.length >= 8 && idDigits.endsWith(last10))
        || (last10 && last10.length >= 8 && phDigits.endsWith(last10));
  };
  // 0 · 2026-05-07 · busca exata IGUAL ao script Python validado
  //   (vai_crm_teste.py): GET /contacts?phone=NUMERO&channel=whatsapp&limit=5
  //   SEM o "+", usando channel filter. Esta é a forma mais confiável de achar
  //   contato criado por inbound prévio (que tem phone=numero_real e
  //   identifier=LID). Sem isso, vaiCreateContact cria contato órfão sem LID
  //   e WhatsApp Web não despacha (bug "chat sem binding inbound").
  try {
    const list = await vaiListContacts({ phone: identifierNoPlus, channel: "whatsapp", limit: "5" });
    const arr = Array.isArray(list) ? list : (list?.data || []);
    const hit = arr.find(matches);
    if (hit?.id) return hit;
  } catch {}
  // 1 · busca por identifier (formato atual · sem +)
  try {
    const list = await vaiListContacts({ search: identifierNoPlus });
    const arr = Array.isArray(list) ? list : (list?.data || []);
    const hit = arr.find(matches);
    if (hit?.id) return hit;
  } catch {}
  // 2 · fallback · busca por phone com + (contatos antigos criados com formato E.164)
  try {
    const list = await vaiListContacts({ phone: e164 });
    const arr = Array.isArray(list) ? list : (list?.data || []);
    const hit = arr.find(matches);
    if (hit?.id) return hit;
  } catch {}
  // 3 · LID — só se fornecido
  if (lid){
    try {
      const lidCore = String(lid).split("@")[0];
      const list = await vaiListContacts({ search: lidCore });
      const arr = Array.isArray(list) ? list : (list?.data || []);
      const found = arr.find(c => {
        const ids = extractContactIds(c);
        return ids.lid && ids.lid.includes(lidCore);
      });
      if (found?.id) return found;
    } catch {}
  }
  // 3.5 · 2026-05-14 · busca por EMAIL antes de tentar criar
  // VAI search por phone tem indice fraco quando contato foi criado sem phone OU
  // por outro canal · search por email costuma achar nesses casos (fix do bug do
  // Gustavo Boelter e dos 52 falhos do broadcast 2026-05-14).
  if (email){
    try {
      const list = await vaiListContacts({ search: email });
      const arr = Array.isArray(list) ? list : (list?.data || []);
      const emailLower = String(email).toLowerCase();
      const hit = arr.find(c => String(c.email || "").toLowerCase() === emailLower);
      if (hit?.id){
        logger.info({ email, hitId: hit.id, label: "by_email_match" }, "vai_contact · achado via email");
        return hit;
      }
    } catch {}
  }
  // 4 · cria · se 409 (já existe), recupera contato existente via múltiplas queries
  try {
    return await vaiCreateContact({ name, phone, email, externalId, customFields });
  } catch (e){
    if (e.status !== 409) throw e;
    logger.info({ phone, identifierNoPlus, errBody: e.body }, "vai_contact · 409 · tentando recuperar existente");

    // Tenta variações da query · VAI search tem índice fraco quando phone="",
    // então testamos search com vários formatos + paginação como último recurso.
    const last10 = identifierNoPlus.slice(-10);  // DDD+8dígitos (fixo local)
    const last11 = identifierNoPlus.slice(-11);  // com 9º dígito
    const tries = [
      { params: { phone: identifierNoPlus },      label: "by_phone_no_plus" },
      { params: { phone: e164 },                  label: "by_phone_e164" },
      { params: { search: identifierNoPlus },     label: "by_search_full" },
      { params: { search: last10 },               label: "by_search_last10" },
      { params: { search: last11 },               label: "by_search_last11" },
      { params: { search: e164 },                 label: "by_search_e164" }
    ];
    const matches = c => {
      const idDigits = String(c.identifier || "").replace(/\D/g, "");
      const phDigits = String(c.phone      || "").replace(/\D/g, "");
      return idDigits === identifierNoPlus
          || phDigits === identifierNoPlus
          || idDigits.endsWith(last10)
          || phDigits.endsWith(last10);
    };
    for (const t of tries){
      try {
        const list = await vaiListContacts(t.params);
        const arr = Array.isArray(list) ? list : (list?.data || []);
        const count = arr.length;
        const hit = arr.find(matches);
        if (hit?.id){
          logger.info({ label: t.label, hitId: hit.id, count }, "vai_contact · 409 · recuperado");
          return hit;
        }
        logger.info({ label: t.label, count, sampleIds: arr.slice(0,3).map(c => ({id:c.id, identifier:c.identifier, phone:c.phone})) }, "vai_contact · 409 · tentativa sem hit");
      } catch (ee){
        logger.warn({ label: t.label, err: ee.message }, "vai_contact · 409 · query falhou");
      }
    }
    // 2026-05-14 · 409 recovery por EMAIL · pega contatos criados em outro canal
    // ou sem phone que nao aparecem nas buscas por numero acima.
    if (email){
      try {
        const list = await vaiListContacts({ search: email });
        const arr = Array.isArray(list) ? list : (list?.data || []);
        const emailLower = String(email).toLowerCase();
        const hit = arr.find(c => String(c.email || "").toLowerCase() === emailLower);
        if (hit?.id){
          logger.info({ label: "by_email_match_409", email, hitId: hit.id }, "vai_contact · 409 · recuperado via email");
          return hit;
        }
        logger.info({ label: "by_email_match_409", email, count: arr.length }, "vai_contact · 409 · email sem hit");
      } catch (ee){
        logger.warn({ label: "by_email_match_409", err: ee.message }, "vai_contact · 409 · busca email falhou");
      }
    }

    // Último recurso · paginação exaustiva. VAI às vezes indexa mal identifier
    // quando phone="", então listamos tudo e filtramos client-side.
    try {
      for (let page = 1; page <= 10; page++){
        const list = await vaiListContacts({ page: String(page), limit: "100" });
        const arr = Array.isArray(list) ? list : (list?.data || []);
        if (arr.length === 0) break;
        const hit = arr.find(matches);
        if (hit?.id){
          logger.info({ label: "by_pagination", page, hitId: hit.id, total: arr.length }, "vai_contact · 409 · recuperado via paginação");
          return hit;
        }
        if (arr.length < 100) break;
      }
      logger.warn({ identifierNoPlus, label: "by_pagination" }, "vai_contact · 409 · paginação exaustiva sem hit");
    } catch (ee){
      logger.warn({ err: ee.message, label: "by_pagination" }, "vai_contact · 409 · paginação falhou");
    }

    logger.warn({ identifierNoPlus }, "vai_contact · 409 · nenhuma query achou · repassa erro");
    throw e;
  }
}

// ===== CHATS =================================================================

export async function vaiListChats(params = {}){
  const qs = new URLSearchParams(params).toString();
  return vaiFetch("/chats" + (qs ? "?" + qs : ""));
}

export async function vaiGetChat(chatId){
  return vaiFetch(`/chats/${chatId}`);
}

export async function vaiListChatMessages(chatId, params = {}){
  const qs = new URLSearchParams(params).toString();
  return vaiFetch(`/chats/${chatId}/messages` + (qs ? "?" + qs : ""));
}

/**
 * Upload de arquivo (genérico, sem auto-envio de mensagem).
 * Usa /files/upload — só faz upload e retorna { id, fileName, originalName, mimeType, size, url }.
 * O endpoint /chats/{chatId}/messages/upload auto-envia a msg (efeito colateral indesejado),
 * por isso preferimos o /files/upload para fazer o 2-step upload + send limpo.
 * @param {string} chatId usado apenas como reference (opcional)
 * @param {{buffer: Buffer, fileName: string, mimeType: string}} file
 */
export async function vaiUploadFile(chatId, { buffer, fileName, mimeType }){
  if (!buffer) throw new VaiError("buffer do arquivo obrigatório", 400);
  const token = await getToken();
  const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  const form = new FormData();
  form.append("file", blob, fileName || "arquivo");
  const qs = chatId ? `?referenceType=chat&referenceId=${encodeURIComponent(chatId)}` : "";
  const url = `${cfg.base}/files/upload${qs}`;
  let res, data;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    data = await res.json().catch(() => ({}));
  } catch (e){ throw new VaiError("vai_network: " + e.message, 0, null); }
  if (res.status === 401){
    await getToken(true);
    return vaiUploadFile(chatId, { buffer, fileName, mimeType });
  }
  if (!res.ok){
    logger.warn({ status: res.status, msg: data?.message }, "vai_upload_failed");
    throw new VaiError(data?.message || data?.error || ("HTTP " + res.status), res.status, data);
  }
  return data;
}

/**
 * Envia mídia: faz upload + envia mensagem referenciando fileUrl.
 * type = "image" | "audio" | "video" | "document" | "file" | "sticker" | "gif"
 */
export async function vaiSendMediaSafe({ chatId, contactId, type = "image", content = "", buffer, fileName, mimeType }){
  try {
    let cid = chatId;
    if (!cid && contactId){
      const chat = await vaiEnsureChatForContact(contactId);
      cid = chat?.id;
    }
    if (!cid) return { ok: false, reason: "no_chat_id" };
    const uploaded = await vaiUploadFile(cid, { buffer, fileName, mimeType });
    if (!uploaded?.url) return { ok: false, error: "upload_sem_url", data: uploaded };
    const msg = await vaiSendChatMessage(cid, { content, type, fileUrl: uploaded.url });
    return { ok: true, chatId: cid, fileUrl: uploaded.url, mimeType: uploaded.mimeType, size: uploaded.size, data: msg };
  } catch (e){
    logger.warn({ err: e.message, status: e.status }, "vai_send_media_failed");
    return { ok: false, error: e.message, status: e.status };
  }
}

/**
 * Busca o conteúdo real de uma mensagem específica · fallback quando
 * o Flow da VAI manda content vazio (bug do seu editor).
 */
export async function vaiFetchMessageContentSafe({ chatId, messageId }){
  if (!chatId || !messageId) return null;
  try {
    const list = await vaiListChatMessages(chatId, { limit: "20" });
    const arr = Array.isArray(list) ? list : (list?.data || []);
    const m = arr.find(x => x.id === messageId);
    return m || null;
  } catch (e){
    logger.warn({ err: e.message, chatId, messageId }, "vaiFetchMessageContentSafe falhou");
    return null;
  }
}

/** Cria um chat vinculando contato ao canal Calebe.
 * 2026-05-07 · Payload IDÊNTICO ao script Python validado · só {contactId, channelId}.
 * Os parâmetros category e departmentId ficam na assinatura pra preservar callers
 * mas NÃO são enviados no body (script novo removeu category, e a VAI define o
 * default automaticamente).
 */
export async function vaiCreateChat({ contactId, category = "pendente", departmentId } = {}){
  if (!contactId) throw new VaiError("contactId obrigatório", 400);
  const channelId = await vaiGetChannelId();
  return vaiFetch("/chats", {
    method: "POST",
    body: {
      contactId,
      channelId
    }
  });
}

/** Garante um chat aberto para o contato (procura chats existentes · cria se não).
 * IMPORTANTE: filtra por channelId atual. Senão pode retornar chats órfãos de canal
 * deletado (status:"open" no banco da VAI mas sem canal vinculado), causando erro
 * 409 "Este chat não está vinculado a nenhum canal" no envio. */
export async function vaiEnsureChatForContact(contactId){
  if (!contactId) throw new VaiError("contactId obrigatório", 400);
  const channelId = await vaiGetChannelId();
  try {
    const list = await vaiListChats({ contactId, status: "open", limit: "10" });
    const arr = Array.isArray(list) ? list : (list?.data || []);
    // Só aceita chat que pertence ao canal atual
    const valid = arr.find(c => c.channelId === channelId || c.channel?.id === channelId);
    if (valid?.id) return valid;
  } catch {}
  return vaiCreateChat({ contactId });
}

// Cache idempotente para evitar disparar "Agente iniciou atendimento" no
// chat VAI a cada outbound. TTL de 5min cobre re-conexoes/reload do worker
// sem deixar de re-iniciar quando realmente necessario.
const _startServiceCache = new Map();           // chatId -> lastCalledAt(ms)
const _startServiceTTL_MS = 5 * 60 * 1000;      // 5min

export async function vaiStartService(chatId){
  if (!chatId) return { skipped: true, reason: "no_chat_id" };
  const now = Date.now();
  const last = _startServiceCache.get(chatId);
  if (last && (now - last) < _startServiceTTL_MS){
    return { skipped: true, reason: "already_started_recently", lastCalledAt: last, chatId };
  }
  const r = await vaiFetch(`/chats/${chatId}/start-service`, { method: "POST" });
  _startServiceCache.set(chatId, now);
  return r;
}

export async function vaiCloseChat(chatId, { closeReasonId, notes } = {}){
  return vaiFetch(`/chats/${chatId}/close`, {
    method: "POST",
    body: { ...(closeReasonId ? { closeReasonId } : {}), ...(notes ? { notes } : {}) }
  });
}

/** Envia mensagem num chat existente.
 * 2026-05-07 · Body IDÊNTICO ao painel VAI (capturado via DevTools):
 *   {"content":"...","type":"text","isNote":false}
 * O campo isNote sempre vai no body (true ou false), não só quando true.
 * Para nota interna (isNote=true), type vira "note".
 * Mídia (fileUrl/metadata) continua spread condicional.
 */
export async function vaiSendChatMessage(chatId, { content, type = "text", fileUrl, fileName, mimeType, isNote = false } = {}){
  if (!chatId) throw new VaiError("chatId obrigatório", 400);
  // Texto puro exige content · mídia pode ter content vazio
  if (type === "text" && (!content || !content.trim())) throw new VaiError("content vazio", 400);
  const request = await vaiFetch(`/chats/${chatId}/messages`, {
    method: "POST",
    body: {
      content: content || "",
      type: isNote ? "note" : type,
      isNote,
      ...(fileUrl ? { fileUrl } : {}),
      ...(fileName || mimeType ? { metadata: { fileName, mimeType } } : {})
    }
  });

  console.log(request)
  
  return request
}

// ===== HEALTH / VALIDAÇÃO ====================================================

export async function vaiHealthCheck(){
  if (!EMAIL() || !PASSWORD()){
    return { ok: false, status: 503, message: "VAI_LOGIN_EMAIL/PASSWORD não configurados no .env" };
  }
  try {
    await getToken(true);
    const channelId = await vaiGetChannelId();
    return { ok: true, status: 200, message: "OK · login válido", channelId };
  } catch (e){
    return { ok: false, status: e.status || 0, message: e.message || "erro desconhecido" };
  }
}

// ===== WRAPPERS BEST-EFFORT ==================================================

/**
 * Envia mensagem num chat VAI; se não houver chatId, tenta criar chat a partir do contactId.
 * Se o chatId estiver stale (chat fechado/arquivado/inexistente na VAI), recria automaticamente
 * a partir do contactId e refaz o envio. Nunca lança erro — CRM continua funcional se VAI cair.
 *
 * Retorna `chatId` atualizado quando recria — o caller deve persistir em Conversation.vaiConvId.
 */
export async function vaiSendSafe({ text, chatId, contactId }){
  // Indica se o erro retornado pela VAI significa "chat não existe mais" (recuperável)
  const isStaleChatError = (err) => {
    if (!err) return false;
    if (err.status === 404) return true;  // "Chat não encontrado"
    if (err.status === 400){
      const m = String(err.message || "").toLowerCase();
      return m.includes("não existe") || m.includes("not found") || m.includes("referenciado");
    }
    return false;
  };

  const tryStartAndSend = async (cid) => {
    try { await vaiStartService(cid); }
    catch (e){ logger.debug({ chatId: cid, err: e.message, status: e.status }, "vai_send · start-service ignorado"); }
    return vaiSendChatMessage(cid, { content: text });
  };

  try {
    let cid = chatId;
    if (!cid && contactId){
      const chat = await vaiEnsureChatForContact(contactId);
      cid = chat?.id;
    }
    if (!cid){
      logger.warn("vai_send_skip · sem chatId/contactId");
      return { ok: false, reason: "no_chat_id" };
    }

    // Tentativa 1 · usando o chatId que temos
    try {
      const r = await tryStartAndSend(cid);
      return { ok: true, data: r, chatId: cid };
    } catch (e){
      // Se foi chat stale + temos contactId, tenta recriar e retry
      if (isStaleChatError(e) && contactId){
        logger.warn({ chatId: cid, err: e.message, status: e.status }, "vai_send · chat stale · recriando");
        try {
          // ensureChat busca chats abertos do contato · se não houver, cria novo
          const chat = await vaiEnsureChatForContact(contactId);
          const newCid = chat?.id;
          if (newCid && newCid !== cid){
            const r2 = await tryStartAndSend(newCid);
            logger.info({ oldChatId: cid, newChatId: newCid }, "vai_send · recuperado com novo chat");
            return { ok: true, data: r2, chatId: newCid, recovered: true };
          }
          // Se ensureChat devolveu o mesmo chat stale · força criar novo
          const forced = await vaiCreateChat({ contactId });
          if (forced?.id){
            const r3 = await tryStartAndSend(forced.id);
            logger.info({ oldChatId: cid, newChatId: forced.id }, "vai_send · recuperado forçando criação");
            return { ok: true, data: r3, chatId: forced.id, recovered: true };
          }
        } catch (ee){
          logger.warn({ err: ee.message, status: ee.status }, "vai_send · retry após stale falhou");
          throw ee;
        }
      }
      throw e;
    }
  } catch (e){
    logger.warn({ err: e.message, status: e.status }, "vai_send_failed");
    return { ok: false, error: e.message, status: e.status };
  }
}

export async function vaiCreateContactSafe(params){
  try { return { ok: true, data: await vaiFindOrCreateContact(params) }; }
  catch (e){
    logger.warn({ err: e.message, status: e.status }, "vai_contact_failed");
    return { ok: false, error: e.message, status: e.status };
  }
}

/**
 * 2026-05-06 · Envio outbound com "reset" do chat — replica fluxo do script
 * `vai_crm_teste.py` que ENTREGA quando o chat foi auto-criado pela VAI a
 * partir de inbound (lead respondeu primeiro). A VAI nesse cenário aceita o
 * POST mas não despacha pro WhatsApp; reusar o chat ou só fazer
 * vaiStartService não resolve. Solução validada (Python script + caso
 * Ronaldo Garcia 2026-05-06): fechar TODOS os chats open+pending, criar
 * chat fresco via POST /chats { category:"pendente" } e só então enviar.
 *
 * Esta função é OPT-IN: chamada apenas quando hasInboundBinding=true em
 * conversations.js. Para o caso comum (cold outbound, sem inbound prévio),
 * o fluxo continua sendo vaiSendSafe (intacto).
 *
 * Retorna a mesma shape do vaiSendSafe: { ok, data, chatId, recovered? }
 * para compat com o caller. Se algo der errado em qualquer etapa, devolve
 * { ok:false, ... } e o caller faz fallback pro vaiSendSafe.
 */
export async function vaiSendOutboundFresh({ contactId, text }){
  if (!contactId){
    return { ok: false, reason: "no_contact_id" };
  }
  try {
    // PASSO 1+2 · Lista TODOS chats open + pending do contato
    const closeTargets = [];
    for (const status of ["open", "pending"]){
      try {
        const list = await vaiListChats({ contactId, status, limit: "20" });
        const arr = Array.isArray(list) ? list : (list?.data || []);
        for (const c of arr) if (c?.id) closeTargets.push({ id: c.id, status });
      } catch (eList){
        // Falha em listar não é fatal · loga e segue
        logger.warn({ contactId, status, err: eList.message, code: eList.status }, "vai_outbound_fresh · falha ao listar · seguindo");
      }
    }

    // PASSO 3 · Fecha cada um (best-effort · 404/400 já fechado é OK)
    for (const t of closeTargets){
      try {
        await vaiCloseChat(t.id, { notes: "outbound-fresh · reset pré-envio" });
      } catch (eClose){
        // Já fechado/órfão — ignora e segue
        logger.debug({ chatId: t.id, err: eClose.message, code: eClose.status }, "vai_outbound_fresh · close ignorado");
      }
    }
    if (closeTargets.length){
      logger.info({ contactId, closed: closeTargets.length }, "vai_outbound_fresh · chats antigos fechados");
    }

    // PASSO 4 · Cria chat fresco (igual ao script Python validado · vai_crm_teste.py)
    const fresh = await vaiCreateChat({ contactId });
    if (!fresh?.id){
      return { ok: false, reason: "create_chat_failed", error: "vaiCreateChat sem id" };
    }
    logger.info({ contactId, chatId: fresh.id, protocol: fresh.protocol }, "vai_outbound_fresh · chat fresco criado");

    // PASSO 5 · Envia DIRETO · script validado NÃO chama start-service nem espera.
    // Remover essas duas etapas garante paridade exata com o fluxo que comprovadamente entrega.
    const r = await vaiSendChatMessage(fresh.id, { content: text, type: "text" });
    return { ok: true, data: r, chatId: fresh.id, recovered: closeTargets.length > 0 };
  } catch (e){
    logger.warn({ contactId, err: e.message, status: e.status }, "vai_outbound_fresh_failed");
    return { ok: false, error: e.message, status: e.status };
  }
}

/**
 * Fluxo completo: cria/acha contato + abre chat.
 * Retorna { ok, contactId, chatId, lid, phone } — todos os identificadores para anti-colisão.
 */
// ===== APROVAÇÃO DE CORRETOR · WhatsApp boas-vindas =========================

const APROVACAO_VIDEO_URL = "https://youtu.be/HsPwDr-lJRw?si=C7yoZqjh9hbmIvlG";
const APROVACAO_VIDEO_BLOCK = `\n\n🎬 Assista ao vídeo de boas-vindas e veja como funciona a sua plataforma:\n${APROVACAO_VIDEO_URL}`;

const APROVACAO_TEMPLATE_DEFAULT = `Parabéns! Você foi aprovado na Calebe Imóveis e está pronto para usar nossa plataforma e receber leads todos os dias.

Segue seu usuário e senha:

* E-mail: {email}
* Senha temporária: {senha}

Acesse: {urlSistema}

Troque sua senha no primeiro acesso em Meu Perfil.${APROVACAO_VIDEO_BLOCK}`;

async function _getAprovacaoCfg(){
  try {
    const rows = await db.systemSetting.findMany({
      where: { key: { in: ["vai.aprovacaoTemplate", "vai.aprovacaoAtivo"] } }
    });
    let tpl = null, ativo = true;
    for (const s of rows){
      const v = (typeof s.value === "string") ? s.value : (s.value?.value ?? s.value);
      if (s.key === "vai.aprovacaoTemplate" && v) tpl = String(v);
      if (s.key === "vai.aprovacaoAtivo") ativo = !(v === false || v === "false" || v === "nao");
    }
    return { template: tpl || APROVACAO_TEMPLATE_DEFAULT, ativo };
  } catch { return { template: APROVACAO_TEMPLATE_DEFAULT, ativo: true }; }
}

/**
 * Envia mensagem de boas-vindas ao corretor recém-aprovado via VAI WhatsApp.
 * Estratégia:
 *   - Se existe Conversation bound pro phone (chat com vaiConvId), envia direto (funciona).
 *   - Senão, enfileira em Associate.welcomePending e dispara no 1º inbound do phone (webhook).
 * Best-effort: nunca lança erro. Retorna { ok, error?, skipped?, queued? }.
 */
export async function notificarCorretorAprovado({ associateId, name, email, phone, tempPassword, urlSistema }){
  try {
    const { template, ativo } = await _getAprovacaoCfg();
    if (!ativo){
      logger.info({ email }, "aprovacao_whatsapp · desativado via settings");
      return { ok: false, skipped: "disabled" };
    }
    if (!phone){
      logger.warn({ email }, "aprovacao_whatsapp · sem telefone");
      return { ok: false, skipped: "no_phone" };
    }
    const url = urlSistema || process.env.APP_PUBLIC_URL || "https://app.calebe.tech";
    let content = String(template)
      .split("{nome}").join(name || "")
      .split("{email}").join(email || "")
      .split("{senha}").join(tempPassword || "")
      .split("{urlSistema}").join(url);
    // Garante que o link do vídeo tutorial esteja sempre presente, mesmo que o admin
    // tenha salvo um template customizado no DB sem incluir a URL.
    if (!content.includes(APROVACAO_VIDEO_URL)){
      content = content.trimEnd() + APROVACAO_VIDEO_BLOCK;
    }

    // 1. Tenta achar Conversation existente com chat bound (inbound prévio do corretor)
    const phoneNorm = normalizePhone(String(phone));
    const phoneStripped = (phoneNorm.length === 13 && parseInt(phoneNorm.slice(2,4),10) > 31 && phoneNorm[4] === "9")
      ? phoneNorm.slice(0,4) + phoneNorm.slice(5) : null;
    const hashes = [sha256Hex(phoneNorm), phoneStripped ? sha256Hex(phoneStripped) : null].filter(Boolean);
    const lead = await db.lead.findFirst({ where: { phoneHash: { in: hashes } }, select: { id:true } });
    const conv = lead ? await db.conversation.findFirst({
      where: { leadId: lead.id, vaiConvId: { not: null } },
      orderBy: { lastMessageAt: "desc" },
      select: { vaiConvId:true, vaiContactId:true }
    }) : null;

    // 1. Tenta reusar chat bound (se corretor já mandou msg pro canal antes)
    if (conv?.vaiConvId){
      const r = await vaiSendSafe({ text: content, chatId: conv.vaiConvId, contactId: conv.vaiContactId });
      if (r.ok){
        if (associateId){
          await db.associate.update({ where: { id: associateId }, data: { welcomeSentAt: new Date(), welcomePending: null, welcomePhoneHash: null } }).catch(()=>{});
        }
        logger.info({ email, chatId: r.chatId, messageId: r.data?.id }, "✅ aprovacao_whatsapp · enviado (bound existente)");
        return { ok: true, mode: "direct_bound", chatId: r.chatId, messageId: r.data?.id };
      }
      logger.warn({ email, err: r.error, status: r.status }, "aprovacao_whatsapp · send bound falhou · tenta fluxo API");
    }

    // 2. Sem bound · outbound-fresh (close-all + create + send) pra evitar 409
    // "Já existe uma conversa aberta para este contato neste canal" quando o contato
    // tem chat antigo travado em outro status/canal (mesmo bug do reset de senha).
    try {
      const contact = await vaiFindOrCreateContact({ name, phone, email });
      if (!contact?.id) throw new Error("contact_no_id");
      const fresh = await vaiSendOutboundFresh({ contactId: contact.id, text: content });
      if (!fresh.ok){
        logger.warn({ email, phone, contactId: contact.id, err: fresh.error || fresh.reason, status: fresh.status }, "aprovacao_whatsapp · outbound-fresh falhou · vou enfileirar");
        throw new Error(fresh.error || fresh.reason || "outbound_fresh_failed");
      }
      if (associateId){
        await db.associate.update({ where: { id: associateId }, data: { welcomeSentAt: new Date(), welcomePending: null, welcomePhoneHash: null } }).catch(()=>{});
      }
      logger.info({ email, phone, contactId: contact.id, chatId: fresh.chatId, messageId: fresh.data?.id, status: fresh.data?.status, recovered: fresh.recovered }, "✅ aprovacao_whatsapp · enviado (outbound-fresh)");
      return { ok: true, mode: "outbound_fresh", contactId: contact.id, chatId: fresh.chatId, messageId: fresh.data?.id, status: fresh.data?.status };
    } catch (e){
      logger.warn({ email, phone, err: e.message, status: e.status }, "aprovacao_whatsapp · fluxo API falhou · vou enfileirar");
    }

    // 3. Fallback · enfileira pra despachar no 1º inbound (dispara na webhook se aprovado)
    if (associateId){
      await db.associate.update({
        where: { id: associateId },
        data: { welcomePending: content, welcomePhoneHash: hashes[0], welcomeQueuedAt: new Date(), welcomeSentAt: null }
      });
      logger.info({ associateId, email, phone }, "📬 aprovacao_whatsapp · enfileirado como fallback");
      return { ok: true, mode: "queued", queued: true };
    }
    return { ok: false, skipped: "no_binding_no_associate_id" };
  } catch (e){
    logger.warn({ err: e.message, status: e.status, email, phone }, "❌ aprovacao_whatsapp · exceção");
    return { ok: false, error: e.message, status: e.status };
  }
}

// ===== RECUPERAÇÃO DE SENHA · WhatsApp ====================================
// Envia nova senha temporária para o corretor que clicou em "Esqueci minha senha"
// na tela de login. Reusa o mesmo fluxo do welcome (bound chat -> API -> queue),
// porém com template proprio de reset.
const RESET_SENHA_TEMPLATE = `🔐 Calebe Investimentos · Recuperação de senha

Olá {nome},

Recebemos sua solicitação de recuperação de senha. Sua nova senha temporária é:

🔑 Senha: {senha}

Acesse {urlSistema}, faça login com seu e-mail ({email}) e troque por uma senha pessoal em "Meu Perfil → Trocar Senha".

Se você não solicitou esta recuperação, entre em contato imediatamente com a equipe Calebe.`;

export async function notificarSenhaRecuperada({ name, email, phone, novaSenha, urlSistema }){
  try {
    if (!phone){
      logger.warn({ email }, "reset_senha_whatsapp · sem telefone");
      return { ok: false, skipped: "no_phone" };
    }
    const url = urlSistema || process.env.APP_PUBLIC_URL || "https://app.calebe.tech";
    const content = String(RESET_SENHA_TEMPLATE)
      .split("{nome}").join(name || "")
      .split("{email}").join(email || "")
      .split("{senha}").join(novaSenha || "")
      .split("{urlSistema}").join(url);

    // 1. Tenta achar Conversation existente com chat bound (mesmo padrao do welcome)
    const phoneNorm = normalizePhone(String(phone));
    const phoneStripped = (phoneNorm.length === 13 && parseInt(phoneNorm.slice(2,4),10) > 31 && phoneNorm[4] === "9")
      ? phoneNorm.slice(0,4) + phoneNorm.slice(5) : null;
    const hashes = [sha256Hex(phoneNorm), phoneStripped ? sha256Hex(phoneStripped) : null].filter(Boolean);
    const lead = await db.lead.findFirst({ where: { phoneHash: { in: hashes } }, select: { id:true } });
    const conv = lead ? await db.conversation.findFirst({
      where: { leadId: lead.id, vaiConvId: { not: null } },
      orderBy: { lastMessageAt: "desc" },
      select: { vaiConvId:true, vaiContactId:true }
    }) : null;

    // 1. Reusa chat bound se existir
    if (conv?.vaiConvId){
      const r = await vaiSendSafe({ text: content, chatId: conv.vaiConvId, contactId: conv.vaiContactId });
      if (r.ok){
        logger.info({ email, chatId: r.chatId, messageId: r.data?.id }, "✅ reset_senha_whatsapp · enviado (bound existente)");
        return { ok: true, mode: "direct_bound", chatId: r.chatId, messageId: r.data?.id };
      }
      logger.warn({ email, err: r.error, status: r.status }, "reset_senha_whatsapp · send bound falhou · tenta fluxo API");
    }

    // 2. Sem bound · usa outbound-fresh (close-all + create + send) pra evitar 409
    // "Já existe uma conversa aberta para este contato neste canal" que afetava corretores
    // sem registro de Lead/Conversation no nosso DB (caso comum em reset de senha).
    try {
      const contact = await vaiFindOrCreateContact({ name, phone, email });
      if (!contact?.id) throw new Error("contact_no_id");
      const fresh = await vaiSendOutboundFresh({ contactId: contact.id, text: content });
      if (!fresh.ok){
        logger.warn({ email, phone, contactId: contact.id, err: fresh.error || fresh.reason, status: fresh.status }, "reset_senha_whatsapp · outbound-fresh falhou");
        return { ok: false, error: fresh.error || fresh.reason, status: fresh.status };
      }
      logger.info({ email, phone, contactId: contact.id, chatId: fresh.chatId, messageId: fresh.data?.id, status: fresh.data?.status, recovered: fresh.recovered }, "✅ reset_senha_whatsapp · enviado (outbound-fresh)");
      return { ok: true, mode: "outbound_fresh", contactId: contact.id, chatId: fresh.chatId, messageId: fresh.data?.id, status: fresh.data?.status };
    } catch (e){
      logger.warn({ email, phone, err: e.message, status: e.status }, "reset_senha_whatsapp · fluxo API falhou");
      return { ok: false, error: e.message, status: e.status };
    }
  } catch (e){
    logger.warn({ err: e.message, status: e.status, email, phone }, "❌ reset_senha_whatsapp · exceção");
    return { ok: false, error: e.message, status: e.status };
  }
}

// ===== NEGAÇÃO DE CADASTRO DE CORRETOR · WhatsApp =========================

const NEGACAO_TEMPLATE_DEFAULT = `Olá, {nome}. Seu cadastro no programa de Associados Calebe foi analisado e, neste momento, não foi aprovado.

Motivo: {motivo}

Se entender que houve um equívoco ou quiser conversar a respeito, é só responder esta mensagem — nossa equipe está à disposição.

Obrigado pelo interesse na Calebe Investimentos Imobiliários.`;

async function _getNegacaoCfg(){
  try {
    const rows = await db.systemSetting.findMany({
      where: { key: { in: ["vai.negacaoTemplate", "vai.negacaoAtivo"] } }
    });
    let tpl = null, ativo = true;
    for (const s of rows){
      const v = (typeof s.value === "string") ? s.value : (s.value?.value ?? s.value);
      if (s.key === "vai.negacaoTemplate" && v) tpl = String(v);
      if (s.key === "vai.negacaoAtivo") ativo = !(v === false || v === "false" || v === "nao");
    }
    return { template: tpl || NEGACAO_TEMPLATE_DEFAULT, ativo };
  } catch { return { template: NEGACAO_TEMPLATE_DEFAULT, ativo: true }; }
}

/**
 * Envia mensagem ao WhatsApp do corretor informando que o cadastro foi NEGADO,
 * incluindo o motivo registrado pelo admin. Best-effort · nunca lança.
 * Sem fallback de fila (não há Associate criado em negação).
 */
export async function notificarCorretorNegado({ name, email, phone, reason }){
  try {
    const { template, ativo } = await _getNegacaoCfg();
    if (!ativo){
      logger.info({ email }, "negacao_whatsapp · desativado via settings");
      return { ok: false, skipped: "disabled" };
    }
    if (!phone){
      logger.warn({ email }, "negacao_whatsapp · sem telefone");
      return { ok: false, skipped: "no_phone" };
    }
    const content = String(template)
      .split("{nome}").join(name || "")
      .split("{email}").join(email || "")
      .split("{motivo}").join(reason || "—");

    const phoneNorm = normalizePhone(String(phone));
    const phoneStripped = (phoneNorm.length === 13 && parseInt(phoneNorm.slice(2,4),10) > 31 && phoneNorm[4] === "9")
      ? phoneNorm.slice(0,4) + phoneNorm.slice(5) : null;
    const hashes = [sha256Hex(phoneNorm), phoneStripped ? sha256Hex(phoneStripped) : null].filter(Boolean);
    const lead = await db.lead.findFirst({ where: { phoneHash: { in: hashes } }, select: { id:true } });
    const conv = lead ? await db.conversation.findFirst({
      where: { leadId: lead.id, vaiConvId: { not: null } },
      orderBy: { lastMessageAt: "desc" },
      select: { vaiConvId:true, vaiContactId:true }
    }) : null;

    if (conv?.vaiConvId){
      const r = await vaiSendSafe({ text: content, chatId: conv.vaiConvId, contactId: conv.vaiContactId });
      if (r.ok){
        logger.info({ email, chatId: r.chatId, messageId: r.data?.id }, "✅ negacao_whatsapp · enviado (bound existente)");
        return { ok: true, mode: "direct_bound", chatId: r.chatId, messageId: r.data?.id };
      }
      logger.warn({ email, err: r.error, status: r.status }, "negacao_whatsapp · send bound falhou · tenta fluxo API");
    }

    try {
      const contact = await vaiFindOrCreateContact({ name, phone, email });
      if (!contact?.id) throw new Error("contact_no_id");
      const fresh = await vaiSendOutboundFresh({ contactId: contact.id, text: content });
      if (!fresh.ok){
        logger.warn({ email, phone, contactId: contact.id, err: fresh.error || fresh.reason, status: fresh.status }, "negacao_whatsapp · outbound-fresh falhou");
        throw new Error(fresh.error || fresh.reason || "outbound_fresh_failed");
      }
      logger.info({ email, phone, contactId: contact.id, chatId: fresh.chatId, messageId: fresh.data?.id, status: fresh.data?.status, recovered: fresh.recovered }, "✅ negacao_whatsapp · enviado (outbound-fresh)");
      return { ok: true, mode: "outbound_fresh", contactId: contact.id, chatId: fresh.chatId, messageId: fresh.data?.id, status: fresh.data?.status };
    } catch (e){
      logger.warn({ email, phone, err: e.message, status: e.status }, "negacao_whatsapp · fluxo API falhou");
    }

    return { ok: false, skipped: "no_binding_no_fallback" };
  } catch (e){
    logger.warn({ err: e.message, status: e.status, email, phone }, "❌ negacao_whatsapp · exceção");
    return { ok: false, error: e.message, status: e.status };
  }
}

export async function vaiOnboardLeadSafe({ name, phone, externalId, customFields }){
  try {
    const contact = await vaiFindOrCreateContact({ name, phone, externalId, customFields });
    if (!contact?.id) return { ok: false, error: "contact_without_id" };
    const ids = extractContactIds(contact);
    const chat = await vaiEnsureChatForContact(contact.id);
    return {
      ok: true,
      contactId: contact.id,
      chatId: chat?.id || null,
      lid: ids.lid,
      phone: ids.phone
    };
  } catch (e){
    logger.warn({ err: e.message, status: e.status }, "vai_onboard_failed");
    return { ok: false, error: e.message, status: e.status };
  }
}
