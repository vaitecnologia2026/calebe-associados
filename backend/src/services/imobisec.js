// =============================================================================
// services/imobisec.js · Pré-consulta de status de CRECI via API IMOBISEC.
// IMOBISEC é um AGREGADOR de terceiros (NÃO é o órgão oficial) — usar como
// apoio/priorização na aprovação; a conferência final continua no site oficial.
//
// API: GET https://api.imobisec.com.br/crecies/{UF}/{creci}/{tipo}
//   header X-API-Token-Key: <token>   ·   tipo = PF | PJ   ·   creci = inteiro
//   resposta: { name, status, lastProviderUpdate, ... } + header X-Remaining-Credits
//   custo: pay-per-use (~R$0,79/consulta) → cacheamos em disco pra não recobrar.
//
// >>> PLUGAR O TOKEN <<<
//   1. defina IMOBISEC_API_TOKEN no backend/.env (e em deploy/.env.production)
//   2. pm2 restart calebe-api
//   Sem token a feature fica dormente: status "not_configured", nenhuma cobranca.
// =============================================================================
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";

const BASE = process.env.IMOBISEC_API_BASE || "https://api.imobisec.com.br";
const token = () => (process.env.IMOBISEC_API_TOKEN || "").trim();
const CACHE_FILE = process.env.IMOBISEC_CACHE_FILE
  || path.join(process.cwd(), "..", "storage", "imobisec-cache.json");
const TTL_MS = Number(process.env.IMOBISEC_CACHE_TTL_DAYS || 30) * 86_400_000;
const UFS = new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE"]);

export function isConfigured(){ return !!token(); }

let _cache = null;
function cache(){
  if (_cache) return _cache;
  try { _cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); }
  catch { _cache = {}; }
  return _cache;
}
function persist(){
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache()));
  } catch (e){ logger.warn?.({ err: e.message }, "[imobisec] falha ao gravar cache"); }
}

// Classifica a string de status do provedor (enum nao documentado) em
// active | inactive | unknown. Mantemos o texto cru (rawStatus) pro tooltip.
function classify(s){
  const x = String(s || "").toLowerCase();
  if (/(ativ|regular|adimpl|habilit|active)/.test(x)) return "active";
  if (/(cancel|suspens|inativ|baixad|irregular|inadimpl|bloquead|inactive)/.test(x)) return "inactive";
  return "unknown";
}

// status ∈ active | inactive | unknown | not_found | not_configured | error
export async function checkCreci({ uf, creci, type = "PF", forceFresh = false } = {}){
  if (!isConfigured()) return { status: "not_configured", source: "imobisec" };
  const state = String(uf || "").trim().toUpperCase();
  const num = String(creci || "").replace(/\D+/g, "");
  const t = String(type || "PF").toUpperCase() === "PJ" ? "PJ" : "PF";
  if (!UFS.has(state) || !num) return { status: "unknown", reason: "invalid_input", source: "imobisec" };

  const key = `${state}:${num}:${t}`;
  const hit = cache()[key];
  if (!forceFresh && hit && (Date.now() - hit.checkedAt) < TTL_MS) return { ...hit, cached: true };

  try {
    const res = await fetch(`${BASE}/crecies/${state}/${num}/${t}`, {
      headers: { "X-API-Token-Key": token(), Accept: "application/json" },
    });
    const remaining = res.headers.get("X-Remaining-Credits");
    if (res.status === 404){
      const out = { status: "not_found", source: "imobisec", checkedAt: Date.now(), remaining };
      cache()[key] = out; persist(); return out;
    }
    if (res.status === 402) return { status: "error", reason: "payment_required", source: "imobisec" };
    if (!res.ok)            return { status: "error", reason: `http_${res.status}`, source: "imobisec" };
    const data = await res.json().catch(() => ({}));
    const out = {
      status: classify(data?.status),
      rawStatus: data?.status ?? null,
      name: data?.name ?? null,
      lastProviderUpdate: data?.lastProviderUpdate ?? null,
      source: "imobisec", checkedAt: Date.now(), remaining,
    };
    cache()[key] = out; persist();
    return { ...out, cached: false };
  } catch (e){
    logger.warn?.({ err: e.message, key }, "[imobisec] consulta falhou");
    return { status: "error", reason: e.message, source: "imobisec" };
  }
}

// Lote com concorrencia limitada (default 5). items: [{id, uf, creci, type?}].
export async function checkMany(items, { concurrency = 5 } = {}){
  const results = {};
  const queue = [...items];
  async function worker(){
    while (queue.length){
      const it = queue.shift();
      results[it.id] = await checkCreci({ uf: it.uf, creci: it.creci, type: it.type });
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}
