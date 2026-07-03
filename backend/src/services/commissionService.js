// =============================================================================
// Commission Service · cria/sincroniza registros de Commission a partir de Sale.
// Disparado por legal.js ao aprovar venda e por um backfill no boot.
// =============================================================================
import { db } from "../db.js";

const META_PREFIX = "__META__=";
const DEFAULT_COMMISSION_RATE = 0.05; // 5% do valor da venda se o imóvel não define

// Extrai commissionValue do _meta do imóvel (armazenado como features[0] = __META__=<json>)
function extractCommissionFromProperty(property){
  if (!property?.features || !Array.isArray(property.features)) return 0;
  const raw = property.features.find(f => typeof f === "string" && f.startsWith(META_PREFIX));
  if (!raw) return 0;
  try {
    const meta = JSON.parse(raw.slice(META_PREFIX.length));
    const v = meta?.commissionValue;
    if (v == null || v === "") return 0;
    const n = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

function calcDueDate(approvedAt){
  const base = approvedAt ? new Date(approvedAt) : new Date();
  const d = new Date(base);
  d.setDate(d.getDate() + 30);
  return d;
}

/**
 * Garante que existe um registro Commission pra venda (saleId é @unique).
 * Se já existe, não sobrescreve valores (admin pode ter ajustado manualmente).
 * Amount: prefere commissionValue do imóvel; fallback 5% do finalValue.
 */
export async function ensureCommissionForSale(saleId){
  const sale = await db.sale.findUnique({
    where: { id: saleId },
    include: { property: { select: { features: true } } }
  });
  if (!sale) return null;
  if (sale.status !== "APPROVED") return null;
  const existing = await db.commission.findUnique({ where: { saleId: sale.id } });
  if (existing) return existing;
  const fromProperty = extractCommissionFromProperty(sale.property);
  const finalValue   = Number(sale.finalValue || 0);
  const gross = fromProperty > 0 ? fromProperty : (finalValue * DEFAULT_COMMISSION_RATE);
  if (!(gross > 0)) return null; // sem base — não cria commission zerada
  return db.commission.create({
    data: {
      saleId: sale.id,
      associateId: sale.associateId,
      grossValue: gross,
      netValue: gross,
      status: "pending",
      dueDate: calcDueDate(sale.approvedAt)
    }
  });
}

/**
 * Backfill · cria Commission pras vendas APPROVED que ainda não têm.
 * Rodado no boot do server.
 */
export async function backfillMissingCommissions(){
  try {
    const approvedSales = await db.sale.findMany({
      where: { status: "APPROVED", commission: null },
      select: { id: true }
    });
    if (!approvedSales.length) return { checked: 0, created: 0 };
    let created = 0;
    for (const s of approvedSales){
      const c = await ensureCommissionForSale(s.id).catch(() => null);
      if (c) created++;
    }
    return { checked: approvedSales.length, created };
  } catch (e){
    return { error: e.message };
  }
}
