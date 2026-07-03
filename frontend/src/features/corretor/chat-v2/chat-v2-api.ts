// Camada de dados do Chat Lead v2.
// Usa o cliente oficial @/lib/api (Bearer + refresh dedup + same-origin),
// então NÃO há workaround de token — auth única e consistente com o app.
// Endpoints idênticos aos do backend Calebe já em produção.
// Transporte PRÓPRIO e resiliente (não usa o cliente compartilhado).
// - lê o access token FRESCO do localStorage ("calebe_auth") a cada chamada
//   (pega re-login feito em outra aba sem precisar recarregar)
// - refresh só como ÚLTIMO recurso E delegado ao single-flight do app (ver abaixo)
// - NUNCA apaga o token (clearAuth do cliente compartilhado derrubava a sessão)
import { api as sharedApi } from "@/lib/api";
const TOKEN_KEY = "calebe_auth";
let _mem: string | null = null;
function tokenFromStorage(): string | null {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || "{}").accessToken || null; } catch { return null; }
}
// REFRESH ÚNICO EM TODO O APP · delega para o single-flight de @/lib/api.
// Por quê: o /api/auth/refresh ROTACIONA o refresh-token (cookie httpOnly `rt`) e,
// se a rotação falhar, o backend faz clearCookie("rt") — matando a sessão. Quando o
// chat-v2 tinha refresh PRÓPRIO, abrir a tela disparava vários refresh concorrentes
// (loadConversations + loadMessages + poll) ao mesmo tempo que o app principal →
// rotações simultâneas com o MESMO `rt` → o perdedor recebia 401 e o cookie era
// limpo → cascata de 401 em "aceitar"/"enviar" no meio do atendimento.
// O sharedApi.refresh() deduplica chamadas concorrentes (uma só rotação por vez) e
// grava o novo token em localStorage["calebe_auth"] — que tokenFromStorage() lê.
// Usamos SOMENTE o refresh do shared (nunca o wrapper call(), que faz clearAuth).
async function refresh(): Promise<boolean> {
  try {
    const tok = await sharedApi.refresh();
    if (tok) { _mem = tok; return true; }
    return false;
  } catch { return false; }
}
function httpErr(status: number, txt: string): any {
  const e: any = new Error(txt ? `${status}:${txt.slice(0, 180)}` : `HTTP ${status}`);
  e.status = status;
  try { e.data = JSON.parse(txt); } catch { /* */ }
  return e;
}
async function authed(path: string, opts: any = {}): Promise<any> {
  let token = tokenFromStorage() || _mem;
  if (!token && !(await refresh())) throw httpErr(401, "");
  token = tokenFromStorage() || _mem;
  const isForm = opts.body instanceof FormData;
  const doFetch = () => fetch(path, {
    ...opts, credentials: "include",
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(isForm ? {} : { "Content-Type": "application/json" }) },
  });
  let res = await doFetch();
  if (res.status === 401) { const t = tokenFromStorage(); if (t && t !== token) { token = t; res = await doFetch(); } } // outra aba renovou
  if (res.status === 401 && await refresh()) { token = tokenFromStorage() || _mem; res = await doFetch(); }
  if (!res.ok) throw httpErr(res.status, await res.text().catch(() => ""));
  return res.status === 204 ? {} : res.json();
}
const api = {
  get: (p: string) => authed(p),
  post: (p: string, b?: any) => authed(p, { method: "POST", body: b instanceof FormData ? b : JSON.stringify(b ?? {}) }),
  patch: (p: string, b?: any) => authed(p, { method: "PATCH", body: JSON.stringify(b ?? {}) }),
};

// [kind, text, time, status, fileUrl?, dir?]
//   kind: "in" | "out" | "sys" | "audio" | "image" | "video" | "document"
//   p/ mídia: fileUrl = caminho do anexo, dir = "in"/"out" (alinhamento da bolha)
export type ChatMsg = [string, string, string, (string | null)?, string?, string?];
export interface Conv {
  id: string; leadId?: string; n: string; org: string; phone: string;
  ts: number; t: string; win: boolean; accepted: boolean;
  lastInbound: number; // ms do último inbound do cliente (abre a janela Meta de 24h)
  _lastInbound: boolean; _lastOut: boolean; stage: string;
  unread: number; msgs: number; last: string; chat: ChatMsg[]; st: string;
  sortTs?: number; // ordenação local (atividade real OU bump de aceite/envio) · estilo WhatsApp Web
  // 2026-06-09 · alerta de redistribuição: ms do assignedAt + se nunca houve contato
  assignedAt?: number; firstContactAt?: number | null; redistributionCount?: number;
  // 2026-06-13 · fixar conversa no topo (estilo WhatsApp)
  pinned?: boolean; pinnedAt?: number;
}
export interface Imovel { id: string; n: string; loc: string; price: string; ic: string; code: string | number; }
export interface TmplBtn { type: string; text: string; url?: string }
export interface Template { name: string; language: string; body: string; vars: number; headerFormat: string; headerText?: string; buttons: TmplBtn[]; recommended?: boolean; category?: string; }

const STAGE_LABEL: Record<string, string> = {
  NEW: "Novo", QUALIFYING: "Qualificando", NEGOTIATING: "Negociação",
  CLOSING: "Fechamento", CLOSED: "Ganho", LOST: "Perdido",
};
const STAGE_ENUM: Record<string, string> = {
  "Novo": "NEW", "Qualificando": "QUALIFYING", "Negociação": "NEGOTIATING",
  "Fechamento": "CLOSING", "Ganho": "CLOSED", "Perdido": "LOST",
};

// Origem do lead em rótulo AMIGÁVEL — o corretor nunca vê termo técnico (ex.: WEBHOOK).
const ORIGIN_LABEL: Record<string, string> = { WEBHOOK: "Captação", MANUAL: "Manual", IMPORT: "Importado" };
const originLabel = (o?: string | null) => (o ? (ORIGIN_LABEL[o] || "Captação") : "—");

// 2026-06-10 · Traduz contentType inbound não-mídia/texto pra texto legível.
// Casos: sticker sem download, location compartilhada, vCard, button reply,
// reaction, lista interativa, mensagem não suportada pelo Cloud API.
function humanizeContentType(ct?: string | null): string {
  switch (String(ct || "").toLowerCase()) {
    case "sticker":     return "🏷️ Sticker";
    case "location":    return "📍 Localização compartilhada";
    case "contacts":    return "👤 Contato compartilhado";
    case "interactive":
    case "button":      return "🔘 Resposta de botão";
    case "list_reply":  return "📋 Resposta de lista";
    case "reaction":    return "❤️ Reação";
    case "order":       return "🛒 Pedido";
    case "system":      return "⚙️ Mensagem do sistema";
    case "unsupported": return "⚠️ Mensagem não suportada (peça pro cliente enviar de novo)";
    case "":
    case undefined:
    case "text":        return "(mensagem vazia)";
    default:            return `📎 ${ct}`;
  }
}

function fmtTime(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 2) return "Ontem";
  return `${Math.floor(diff)}d`;
}
function preview(m: any): string {
  return (m.direction === "outbound" ? "Você: " : "") +
    (m.text || (m.contentType ? `[${m.contentType}]` : "")).slice(0, 40);
}
function statusFrom(c: any): string {
  // 2026-06-12 · SÓ status LOST = descartado de verdade (sai das abas).
  // discardedAt sozinho NÃO basta: o auto-flag \"Sem WhatsApp\" (131026) seta discardedAt
  // mantendo status NEW — esses leads continuam na carteira e o corretor trabalha neles.
  // Antes, tratá-los como descartado escondia leads ativos (reclamação \"sumiu tudo\").
  if (c.lead?.status === "LOST") return "discarded";
  if (!c._lastInbound) return "new";
  if (c.windowOpen) return c._lastOut ? "waiting_reply" : "responded";
  return "template";
}

// Monta as <source> de áudio com o TYPE CORRETO (crucial: iOS/Safari rejeita
// source com type errado — era a causa do "áudio não toca no celular").
// Hoje o backend entrega tudo em .mp3; p/ .ogg/.opus legado, adiciona fallback
// mp3 transcodado via /api/audio-mp3/.
export function audioSources(url: string): { src: string; type: string }[] {
  if (!url) return [];
  const ext = ((url.split("?")[0].match(/\.([a-z0-9]+)$/i) || [])[1] || "").toLowerCase();
  const TYPE: Record<string, string> = {
    mp3: "audio/mpeg", mpeg: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg",
    opus: "audio/ogg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/mp4",
    wav: "audio/wav", webm: "audio/webm",
  };
  const out: { src: string; type: string }[] = [{ src: url, type: TYPE[ext] || "audio/mpeg" }];
  if (ext === "ogg" || ext === "opus" || ext === "oga") {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/midias/")) out.push({ src: "/api/audio-mp3/" + path.replace(/^\/midias\//, ""), type: "audio/mpeg" });
  }
  return out;
}

export async function loadConversations(): Promise<Conv[]> {
  const j: any = await api.get("/api/conversations?limit=300");
  const arr: any[] = j.data || j || [];
  return arr.map((c: any) => {
    const last = (c.messages && c.messages[0]) || null;
    const lastIn = c.lastInboundAt ? new Date(c.lastInboundAt).getTime() : 0;
    const tsMs = c.lastMessageAt ? new Date(c.lastMessageAt).getTime()
      : (lastIn || (c.createdAt ? new Date(c.createdAt).getTime() : 0));
    const o: any = {
      id: c.id, leadId: c.leadId, n: c.lead?.name || "(sem nome)", org: originLabel(c.lead?.origin),
      phone: c.lead?.phone || c.lead?.phoneE164 || c.lead?.whatsapp || c.lead?.phoneMasked || "",
      ts: tsMs, t: fmtTime(tsMs), accepted: !!c.accepted,
      // Janela 24h (Meta): usa windowOpen do backend SE vier; senão calcula de lastInboundAt.
      win: (typeof c.windowOpen === "boolean" ? c.windowOpen : (lastIn > 0 && Date.now() - lastIn < 86400000)),
      lastInbound: lastIn,
      _lastInbound: lastIn > 0, _lastOut: last?.direction === "outbound",
      stage: STAGE_LABEL[c.lead?.status] || "Novo",
      // unread = mensagens do cliente sem resposta (vem do backend); ChatV2 zera ao abrir.
      unread: Number(c.unread) || 0, msgs: c._count?.messages || (last ? 1 : 0),
      last: last ? preview(last) : "—",
      chat: last
        ? [[last.direction === "inbound" ? "in" : "out", last.text || "", fmtTime(new Date(last.createdAt).getTime())]]
        : [],
      // 2026-06-09 · redistribuição: assignedAt + firstContactAt pra calcular risco no cliente
      assignedAt: c.lead?.assignedAt ? new Date(c.lead.assignedAt).getTime() : undefined,
      firstContactAt: c.lead?.firstContactAt ? new Date(c.lead.firstContactAt).getTime() : null,
      redistributionCount: c.lead?.redistributionCount ?? 0,
      pinned: !!c.pinned, pinnedAt: c.pinnedAt ? new Date(c.pinnedAt).getTime() : undefined,
    };
    return { ...o, st: statusFrom({ ...c, _lastInbound: o._lastInbound, _lastOut: o._lastOut }) };
  });
}

export async function loadMessages(id: string): Promise<{ win: boolean; chat: ChatMsg[]; phone: string; lastInbound: number }> {
  const j: any = await api.get(`/api/conversations/${id}/messages`);
  // JANELA DE 24h (regra Meta) · ABERTA se houve INBOUND do cliente nas últimas 24h.
  // O backend deveria mandar windowOpen; quando NÃO vem (refactor removeu), calculamos
  // das mensagens — que são recém-buscadas (não há estado velho). Sem isso o sistema
  // exigia template com a janela aberta = custo indevido.
  const beWin = (typeof j.conversation?.windowOpen === "boolean") ? j.conversation.windowOpen
    : (typeof j.window?.windowOpen === "boolean") ? j.window.windowOpen : null;
  let liMs = 0;
  for (const m of (j.messages || [])) {
    if (m.direction === "inbound" || m.direction === "IN") {
      const t = new Date(m.createdAt).getTime();
      if (Number.isFinite(t) && t > liMs) liMs = t;
    }
  }
  const win = beWin != null ? beWin : (liMs > 0 && Date.now() - liMs < 86400000);
  // telefone REAL só vem quando liberado (admin/manual/contato liberado) — respeita a regra
  const phone = j.lead?.phone || j.conversation?.lead?.phone || "";
  const chat: ChatMsg[] = (j.messages || []).map((m: any) => {
    const dir = (m.direction === "inbound" || m.direction === "IN") ? "in" : "out";
    const t = fmtTime(new Date(m.createdAt).getTime());
    const status = m.messageStatus || null;
    const ct = m.contentType;
    // Mídia: carrega fileUrl + direção (o player/preview é montado no render).
    if (m.fileUrl && (ct === "audio" || ct === "image" || ct === "video")) return [ct, m.text || "", t, status, m.fileUrl, dir];
    // 2026-06-10 · Sticker do WhatsApp vem como image-like com fileUrl. Renderiza como image.
    if (m.fileUrl && ct === "sticker") return ["image", m.text || "", t, status, m.fileUrl, dir];
    if (m.fileUrl && ct && ct !== "text") return ["document", m.text || m.fileName || "Anexo", t, status, m.fileUrl, dir];
    // 2026-06-10 · Inbound sem fileUrl mas com contentType exótico (location, contacts,
    // reaction, interactive, sticker sem download). Corretor reclamou "Cliente enviou
    // algo que não sei o que é" — antes mostrava literal `[contentType]`. Traduz pra
    // descrição amigável.
    return [dir, m.text || humanizeContentType(ct), t, status];
  });
  // lastInbound (ms) volta SEMPRE — o frontend recalcula a janela ao vivo e não
  // fica preso a um windowOpen velho quando o cliente acabou de responder.
  return { win, chat, phone, lastInbound: liMs };
}

export async function loadTemplates(): Promise<Template[]> {
  try {
    const j: any = await api.get("/api/whatsapp/templates");
    const _tpls: Template[] = (j.data || []).map((t: any) => {
      const body = (t.components || []).find((c: any) => (c.type || "").toUpperCase() === "BODY")?.text || t.name;
      const vars = new Set([...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m: any) => m[1])).size;
      const header = (t.components || []).find((c: any) => (c.type || "").toUpperCase() === "HEADER");
      const headerFormat = (header?.format || "TEXT").toUpperCase();
      const headerText = headerFormat === "TEXT" ? (header?.text || "") : "";
      const btnComp = (t.components || []).find((c: any) => (c.type || "").toUpperCase() === "BUTTONS");
      const buttons: TmplBtn[] = (btnComp?.buttons || []).map((b: any) => ({ type: (b.type || "").toUpperCase(), text: b.text || "", url: b.url || undefined }));
      return { name: t.name, language: t.language || "pt_BR", body, vars, headerFormat, headerText, buttons, category: t.category };
    });
    // 2026-06-12 · Mostra TODOS os templates liberados pelo backend (allowlist), exceto os de
    // SISTEMA (notificação/acesso/suporte). Antes priorizava UTILITY e a lista COLAPSAVA pra 1
    // sempre que existia exatamente 1 UTILITY — foi a reclamação "só aparece 1 template".
    // A allowlist no .env já decide o que pode ser enviado; aqui só tiramos os de sistema.
    const SISTEMA = new Set(["calebe_novo_lead","calebe_acesso_aprovado","calebe_acesso_bloqueado","calebe_lead_respondeu","calebe_suporte_ajuda_v1","calebe_chamado_ok_v1","calebe_chamado_resolvido_v3","calebe_reconhecimento","calebe_treinamento","calebe_ligacao_iniciada"]);
    const result = _tpls.filter((t) => !SISTEMA.has(t.name));
    // 2026-06-12 · resiliência: guarda última lista boa — Meta Graph cai de vez em quando
    // e o corretor ficava com \"Nenhum template liberado\".
    if (result.length) { try { localStorage.setItem("CALEBE_TPL_CACHE_V2", JSON.stringify(result)); } catch { /* */ } }
    return result;
  } catch {
    // API falhou → usa última lista boa do localStorage em vez de deixar o corretor sem nada
    try {
      const cached = JSON.parse(localStorage.getItem("CALEBE_TPL_CACHE_V2") || "[]");
      if (Array.isArray(cached) && cached.length) return cached;
    } catch { /* */ }
    return [];
  }
}

// --- Personalização por gênero (inferida do 1º nome do lead) + params de exemplo ---
// 2026-06-08 · v2 · ampliada com nomes terminados em -e e exceções -el/-or femininos
const _GF = new Set([
  "maria","ana","julia","juliana","fernanda","patricia","camila","leticia","amanda","bruna",
  "carla","sandra","aline","beatriz","larissa","gabriela","mariana","luana","jessica","vanessa",
  "tatiane","tatiana","cristina","cristiane","daniela","daniele","rafaela","rosana","simone",
  "sabrina","viviane","vivian","claudia","adriana","andrea","andreia","monica","priscila","renata",
  "sara","sarah","silvana","sonia","luciana","lucia","helena","heloisa","isabela","isabella",
  "isadora","manuela","valentina","alice","laura","lara","nicole","yasmin","eduarda","carolina",
  "caroline","debora","elaine","fabiana","flavia","ingrid","kelly","marcia","marta","nara",
  "raquel","regina","rita","rosangela","tania","teresa","vera","vitoria","leila","cassia",
  "clenia","margareth","inae","giulia","rosilene","marilene","catia","suzete","jaque","jaqueline",
  // nomes terminados em -e (femininos frequentes não cobertos pela regra de sufixo -a)
  "eliane","adriane","naiane","ciane","silvane","suane","rosane","deise","neide","loide",
  "noeme","noemi","mirele","franciele","graziela","graciele","luane","taiane","josiane",
  "fabiane","luciane","silviane","ediane","eridiane","leidiane","luziane","gislaine",
  "marlene","helene","irene","lorene","dione","ivone","leonice","ednilce","valdirene",
  "monique","dominique","veronique","angelique","eloize","eloisa","elouise","louise",
  "denise","elise","eloise","micheli","michely","micheline","daiane","laiane","keite",
  "cintia","cindy","wendy","sandy","evellyn","evelyn","emelyn","nathalie","natalie",
  "nadia","diane","dianne","anne","annie","suzane","suzanne","suzanny",
  // terminadas em -el/-or (sufixos masculinos clássicos com exceções femininas reais)
  "rachel","leonor","flor",
  // nomes em -i (diminutivos femininos comuns no BR)
  "gabi","nati","cami",
]);
const _GM = new Set(["joao","jose","carlos","paulo","pedro","lucas","marcos","luiz","luis","rafael","felipe","fernando","bruno","gustavo","guilherme","gabriel","daniel","danilo","diego","eduardo","rodrigo","ricardo","roberto","sergio","andre","alex","alexandre","anderson","fabio","jefferson","jeferson","julio","leandro","leonardo","marcelo","mateus","matheus","mauricio","murilo","otavio","renato","thiago","tiago","vinicius","wagner","wesley","william","willian","cleocir","valdir","edson","elias","jean","maiquel","osmar","valter","ronipeterson","layon","waldemir","josiel","fabricio","eder","jeferson","vinicius"]);
export function genderFromName(full?: string | null): "f" | "m" | "n" {
  const first = (full || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/)[0];
  if (!first) return "n";
  if (_GM.has(first)) return "m";
  if (_GF.has(first)) return "f";
  const exMascA = new Set(["luca","juca","jonas","tomas","dimas","silas","lucas","mateus","matias","elias","nicolas"]);
  if (first.endsWith("a") && !exMascA.has(first)) return "f";
  // "el" e "or" removidos como indicadores masculinos — Rachel, Leonor, Flor são femininos.
  // "son" e "ton" mantidos (exclusivamente masculinos no contexto BR).
  if (first.endsWith("o") || first.endsWith("son") || first.endsWith("ton")) return "m";
  return "n"; // ambíguo → versão neutra e profissional "bem-vindo(a)"
}
// Escolhe a forma de uma palavra com gênero. Neutro → forma combinada "(a)".
export function gword(masc: string, fem: string, g: "f" | "m" | "n"): string {
  if (g === "f") return fem;
  if (g === "m") return masc;
  let i = 0; while (i < masc.length && i < fem.length && masc[i] === fem[i]) i++;
  return masc + "(" + fem.slice(i) + ")";
}
// Params de exemplo do template — MESMA lógica do envio (preview 100% fiel ao enviado).
export function templateParams(t: Template, leadName?: string | null, corretorName?: string | null): string[] {
  const leadFirst = (leadName || "").trim().split(/\s+/)[0] || "tudo bem";
  const corretorFirst = (corretorName || "").trim().split(/\s+/)[0] || "Calebe";
  if (t.name === "calebe_corretor_apresenta" || t.name === "calebe_corretora_apresenta" || t.name === "calebe_reabordagem_v1" || t.name === "calebe_reabordagem_v2") return [corretorFirst, leadFirst]; // {{1}}=corretor, {{2}}=lead
  if (t.name === "calebe_abordagem_inicial") return [leadFirst, corretorFirst];  // {{1}}=lead, {{2}}=corretor (REMOVIDO da allowlist · 3 vars)
  // {{2}} = palavra com GÊNERO do cliente (bem-vindo/bem-vinda/bem-vindo(a)), escolhida pela engine.
  if (t.name === "calebe_boas_vindas") return [leadFirst, gword("bem-vindo", "bem-vinda", genderFromName(leadName))];
  return Array.from({ length: t.vars || 0 }, () => leadFirst);
}

export async function loadImoveis(): Promise<Imovel[]> {
  try {
    const j: any = await api.get("/api/properties?limit=100");
    const arr: any[] = j.data || [];
    if (!arr.length) return [];
    return arr.map((p: any) => ({
      id: p.id,
      n: p.title || p.name || "Imóvel",
      loc: [p.city, p.neighborhood].filter(Boolean).join(" · ") || p.address || "—",
      price: p.priceLabel || (p.price ? "R$ " + Number(p.price).toLocaleString("pt-BR") : "Sob consulta"),
      ic: "🏠", code: p.code || p.id,
    }));
  } catch { return []; }
}

export const sendText = (id: string, text: string) =>
  api.post(`/api/conversations/${id}/messages`, { text });
export const sendTemplate = (id: string, name: string, lang: string, bodyParams: string[] = []) =>
  api.post(`/api/whatsapp/conversations/${id}/send-template`, { templateName: name, languageCode: lang || "pt_BR", bodyParams });
export const acceptConv = (id: string) =>
  api.post(`/api/conversations/${id}/accept`, {});
// 2026-06-13 · fixar/desafixar conversa no topo (estilo WhatsApp, máx 5)
export const pinConv = (id: string, pinned: boolean) =>
  api.post(`/api/conversations/${id}/pin`, { pinned });
export const setStageApi = (leadId: string, label: string) =>
  api.patch(`/api/leads/${leadId}/status`, { status: STAGE_ENUM[label] || "NEW" });
export const createLead = (d: any) =>
  api.post(`/api/leads/manual`, d);
// Ligação por API (Twilio bridge mascarado): toca o telefone do corretor e conecta
// no lead, com número protegido + gravação. NÃO precisa liberar contato.
export const voiceCall = (leadId: string) =>
  api.post(`/api/leads/${leadId}/voice-call`, {});
export const voiceCallConfirm = (leadId: string) =>
  api.post(`/api/leads/${leadId}/voice-call`, { confirm: true });
// Ações do menu ⋮ (mesmos endpoints do chat antigo que os corretores já usam):
export const setLeadStatus = (leadId: string, status: string, reason?: string) =>
  api.patch(`/api/leads/${leadId}/status`, reason ? { status, reason } : { status });
export const linkProperty = (leadId: string, propertyId: string) =>
  api.patch(`/api/leads/${leadId}`, { linkedPropertyId: propertyId });
export const phoneRelease = (conversationId: string, justification: string) =>
  api.post(`/api/phone-release`, { conversationId, justification });

// --- Ajuda Comercial Calebe (corretor pede apoio do time Calebe nesta negociação) ---
export const csRequestHelp = (conversationId: string, justification?: string) =>
  api.post(`/api/commercial-support/request`, justification ? { conversationId, justification } : { conversationId });
export const csActive = (conversationId: string): Promise<{ active: boolean; status: string | null; atuando: boolean }> =>
  api.get(`/api/commercial-support/conversation/${conversationId}/active`);

// Áudio: multipart. O cliente @/lib/api detecta FormData e não seta Content-Type.
export async function sendAudio(id: string, blob: Blob) {
  const fd = new FormData();
  fd.append("file", blob, "audio.webm");
  return api.post(`/api/conversations/${id}/media`, fd);
}
// Mídia genérica (imagem/vídeo/documento). O backend deduz o tipo pelo mime,
// valida contra a Meta (JPEG/PNG, MP4, PDF/DOC/…) e devolve erro claro se não aceitar.
export async function sendFile(id: string, file: File) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  return api.post(`/api/conversations/${id}/media`, fd);
}
export function mediaKind(file: File): "image" | "video" | "document" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "document";
}
