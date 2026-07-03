// =============================================================================
// dwv.js · 2026-05-12
// Integração DWV App (https://api.dwvapp.com.br/integration/properties).
//
// Funcionamento:
//  - Token de imobiliária no .env: DWV_TOKEN (string opaca fornecida pela DWV
//    no painel "Integração" da conta da imobiliária Calebe).
//  - Rate limit DWV: 100 req/min · respondemos com backoff em 429.
//  - Mapeamento DWV → CRM:
//      enterprise (empreendimento)  → Development
//      enterprise.units (unidades)  → Property
//      enterprise.images[0]         → Development.coverImageUrl
//      enterprise.video_url         → Development.videoUrl
//      enterprise.address.lat/lng   → Development.latitude/longitude
//
//  - upsert por chave externa: usa Development.dwvId / (não temos Property.dwvId
//    ainda · faremos upsert por code do Property pra evitar duplicar).
//
//  - Idempotente: pode rodar quantas vezes quiser, atualiza dados existentes.
// =============================================================================
import { db } from "../db.js";
import { logger } from "../utils/logger.js";

// Base correta da DWV Integration API · agencies.dwvapp.com.br (api.dwvapp.com.br é só docs)
const DWV_BASE = process.env.DWV_BASE_URL || "https://agencies.dwvapp.com.br";

function token(){
  const t = process.env.DWV_TOKEN;
  if (!t) throw Object.assign(new Error("dwv_token_missing"), { status: 503 });
  return t;
}

export function isEnabled(){
  return !!process.env.DWV_TOKEN;
}

// ---------- HTTP helper (respeita rate limit) -------------------------------
async function call(path, { query, retries = 1 } = {}){
  const t = token();
  let url = `${DWV_BASE}${path.startsWith("/") ? path : "/" + path}`;
  if (query){
    const usp = new URLSearchParams(Object.entries(query).filter(([_, v]) => v != null));
    if (usp.toString()) url += `?${usp}`;
  }
  const res = await fetch(url, {
    method: "GET",
    headers: { "token": t, "Accept": "application/json" },
    signal: AbortSignal.timeout(20_000)
  });
  if (res.status === 429 && retries > 0){
    // Rate limit · espera 60s e tenta de novo
    logger.warn({ url }, "DWV · rate limited · aguardando 60s");
    await new Promise(r => setTimeout(r, 60_000));
    return call(path, { query, retries: retries - 1 });
  }
  if (!res.ok){
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`dwv_http_${res.status}`), { status: res.status, body: body.slice(0, 300) });
  }
  return res.json();
}

// ---------- Fetch list of properties from DWV --------------------------------
// Retorna o array bruto · paginação se houver
export async function fetchProperties({ page = 1, perPage = 100 } = {}){
  const data = await call("/integration/properties", { query: { page, per_page: perPage } });
  // O endpoint pode retornar { data: [...], meta: {...} } ou direto array.
  // Aceitamos as duas formas.
  return Array.isArray(data) ? { data, meta: null } : { data: data.data || [], meta: data.meta || null };
}

// Pega TUDO (paginação até esgotar)
// IMPORTANTE: DWV ignora per_page e SEMPRE retorna 20/página · só dá pra parar
// quando a página vier vazia. Limitamos a maxPages pra evitar loop infinito.
export async function fetchAllProperties({ maxPages = 200, perPage = 100 } = {}){
  const all = [];
  for (let p = 1; p <= maxPages; p++){
    const { data, meta } = await fetchProperties({ page: p, perPage });
    if (!data.length) break;                      // unica condicao confiavel de parada
    all.push(...data);
    if (meta && typeof meta.last_page === "number" && p >= meta.last_page) break;
    await new Promise(r => setTimeout(r, 400));   // rate limit suave
  }
  return all;
}

// ---------- Mapeamento DWV → CRM ---------------------------------------------
// Shape REAL da DWV (descoberto 2026-05-12, agencies.dwvapp.com.br):
//   - Top-level = enterprise (empreendimento)
//   - third_party_property = unidade individual com address, fotos, preco, etc
//   - construction_company = construtora
//   - selected_photos = gallery do empreendimento (opcional, geralmente null)
function _pickCover(tpp){
  // tpp.cover é objeto {sizes, url} · tpp.gallery é array de objetos {url}
  if (tpp?.cover?.url) return tpp.cover.url;
  if (Array.isArray(tpp?.gallery) && tpp.gallery[0]?.url) return tpp.gallery[0].url;
  return null;
}
function _flattenFeatures(featuresList){
  // tpp.features = [{ type, tags, titles }] → flatten titles
  if (!Array.isArray(featuresList)) return [];
  const out = [];
  for (const f of featuresList){
    const titles = Array.isArray(f?.titles) ? f.titles : [];
    for (const t of titles) if (t) out.push(String(t));
  }
  return out.slice(0, 40);
}
function _statusFromDwv(stage, deleted){
  if (deleted) return "SUSPENDED";
  const s = String(stage || "").toLowerCase();
  if (s.includes("entreg") || s === "delivered") return "DELIVERED";
  if (s.includes("sold")  || s.includes("vendido")) return "SOLD_OUT";
  return "ACTIVE";
}

// Slug determinístico a partir de name+city — garante que MULTIPLAS rows DWV
// com mesmo predio (Grand Rubi Residence · Balneario Camboriu) virem 1 unico
// Development (em vez de 1 por unidade vendida na plataforma).
function _devCodeFromDwv(dwv){
  const tpp = dwv.third_party_property || {};
  const addr = tpp.address || {};
  // String fix: explicit escape pra remover combining diacritics (NFD)
  const stripDiacritics = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const name = stripDiacritics(String(dwv.title || dwv.advertisement_title || "emp").toLowerCase());
  const city = stripDiacritics(String(addr.city || "sc").toLowerCase());
  const slug = (name + "-" + city)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
  return `DWV-${slug}`.slice(0, 40);
}

function mapDevFromDwv(dwv){
  const tpp = dwv.third_party_property || {};
  const addr = tpp.address || {};
  const company = dwv.construction_company || {};
  const id = dwv.id;
  const code = _devCodeFromDwv(dwv);
  return {
    dwvId: String(id || "").slice(0, 80),
    code,
    name: (dwv.title || dwv.advertisement_title || "Empreendimento DWV").toString().slice(0, 200),
    description: (dwv.description_text || dwv.description || "").toString().slice(0, 5000) || null,
    address: addr.street_name || null,
    neighborhood: (addr.neighborhood || "—").toString().slice(0, 120),
    city: (addr.city || "—").toString().slice(0, 120),
    state: ((addr.state || "SC").toString().slice(0, 2)).toUpperCase(),
    zipCode: addr.zip_code || null,
    builder: (company.title || null)?.toString().slice(0, 200) || null,
    totalUnits: null,
    totalFloors: null,
    totalTowers: null,
    deliveryDate: tpp.delivery_date ? new Date(tpp.delivery_date) : null,
    launchDate: tpp.start_building ? new Date(tpp.start_building) : null,
    commonAreas: [],
    leisureFeatures: _flattenFeatures(tpp.features),
    coverImageUrl: _pickCover(tpp),
    videoUrl: null,
    latitude: addr.latitude ? Number(addr.latitude) : null,
    longitude: addr.longitude ? Number(addr.longitude) : null,
    status: _statusFromDwv(dwv.construction_stage, dwv.deleted)
  };
}

function mapUnitFromDwv(dwv, devId){
  const tpp = dwv.third_party_property || {};
  const addr = tpp.address || {};
  const id = tpp.id || dwv.id;
  const cover = _pickCover(tpp);
  return {
    code: `DWV-U-${id}`.slice(0, 40),
    title: (tpp.unit_info || tpp.title || `Unidade ${tpp.id || dwv.id}`).toString().slice(0, 160),
    neighborhood: (addr.neighborhood || "—").toString().slice(0, 120),
    city: (addr.city || "—").toString().slice(0, 120),
    propertyType: tpp.type || "Apartamento",
    value: tpp.price ? Number(tpp.price) : 0,
    priceCash: tpp.price ? Number(tpp.price) : null,
    priceList: null,
    commission: "—",
    area: tpp.private_area ? `${tpp.private_area} m²` : (tpp.util_area ? `${tpp.util_area} m²` : null),
    bedrooms: typeof tpp.dorms === "number" ? tpp.dorms : null,
    suites: typeof tpp.suites === "number" ? tpp.suites : null,
    garages: typeof tpp.parking_spaces === "number" ? tpp.parking_spaces : null,
    description: (dwv.description_text || tpp.description || null)?.toString().slice(0, 5000) || null,
    features: _flattenFeatures(tpp.features),
    unitNumber: tpp.unit_info ? String(tpp.unit_info).replace(/^.*?(\d+)\D*$/, "$1") : null,
    tower: null,
    floor: null,
    unitType: tpp.type || null,
    status: "AVAILABLE",
    developmentId: devId
  };
}

// ---------- Sync: persiste no DB com upsert ----------------------------------
// Retorna stats { fetched, devsCreated, devsUpdated, unitsCreated, unitsUpdated, errors }
export async function syncProperties({ dryRun = false } = {}){
  if (!isEnabled()) throw Object.assign(new Error("dwv_disabled"), { status: 503 });
  const stats = { fetched: 0, devsCreated: 0, devsUpdated: 0, unitsCreated: 0, unitsUpdated: 0, errors: [] };
  const all = await fetchAllProperties();
  stats.fetched = all.length;

  // Log primeiro item · ajuda mapear caso DWV mude shape
  if (all.length > 0){
    try { logger.info({ sample: Object.keys(all[0]) }, "DWV · sample shape de enterprise"); } catch {}
  }

  if (dryRun) return { ...stats, sample: all.slice(0, 3) };

  for (const e of all){
    try {
      const devData = mapDevFromDwv(e);
      // Upsert Development por dwvId · cair pra code se necessário
      let dev = devData.dwvId ? await db.development.findFirst({ where: { dwvId: devData.dwvId } }) : null;
      if (!dev) dev = await db.development.findUnique({ where: { code: devData.code } }).catch(() => null);
      if (dev){
        dev = await db.development.update({ where: { id: dev.id }, data: devData });
        stats.devsUpdated++;
      } else {
        dev = await db.development.create({ data: devData });
        stats.devsCreated++;
      }

      // Unidade · no shape da DWV, third_party_property = a unit em si.
      // Cada row do listing representa enterprise + 1 unit, então criamos
      // sempre 1 Property por row (upsert por code).
      if (e.third_party_property){
        try {
          const unitData = mapUnitFromDwv(e, dev.id);
          const existing = await db.property.findUnique({ where: { code: unitData.code } }).catch(() => null);
          if (existing){
            await db.property.update({ where: { id: existing.id }, data: unitData });
            stats.unitsUpdated++;
          } else {
            await db.property.create({ data: unitData });
            stats.unitsCreated++;
          }
        } catch (ex){
          stats.errors.push(`unit ${e.third_party_property?.id || e.id}: ${ex.message}`);
        }
      }
    } catch (ex){
      stats.errors.push(`dev ${e.code || e.id}: ${ex.message}`);
    }
  }
  return stats;
}
