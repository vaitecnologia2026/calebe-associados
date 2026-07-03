// =============================================================================
// /api/sales/:id/contract · template + edição livre + persistência
// =============================================================================
import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import { db } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { decrypt } from "../crypto.js";
import { audit } from "../utils/audit.js";

const r = Router();

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const CONTRATOS_DIR = path.join(PROJECT_ROOT, "Contratos");
try { fs.mkdirSync(CONTRATOS_DIR, { recursive: true }); } catch {}

const TEMPLATE_PATH = path.join(process.cwd(), "templates", "contract.html");
// Lê o template a cada chamada — evita servir versão em cache após troca de logo/layout.
function loadTemplate(){
  try { return fs.readFileSync(TEMPLATE_PATH, "utf8"); }
  catch { return "<p><em>Template de contrato ainda não configurado.</em></p>"; }
}

function _fmtBRL(v){
  const n = Number(v || 0);
  if (!isFinite(n)) return "—";
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Resolve dados para preencher o template (saleRec + lead + imovel + comprador)
async function buildContext(saleId){
  const sale = await db.sale.findUnique({
    where: { id: saleId },
    include: {
      property: true,
      associate: { include: { user: { select: { name: true, email: true } } } }
    }
  });
  if (!sale) return null;
  // clientName vem em claro · clientDataEncrypted tem CPF/RG
  let clientCpf = "—", clientRg = "—";
  try {
    const plain = JSON.parse(decrypt(sale.clientDataEncrypted) || "{}");
    clientCpf = plain.cpf || "—";
    clientRg  = plain.rg  || "—";
  } catch {}
  return {
    compradorNome:         sale.clientName || "—",
    compradorCnpj:         clientCpf,   // assumimos CPF (PF) · admin pode trocar manualmente
    compradorResponsavel:  sale.clientName || "—",
    compradorCnh:          clientRg,
    compradorCpf:          clientCpf,
    valorTotal:            _fmtBRL(sale.finalValue),
    imovelCodigo:          sale.property?.code || "—",
    imovelTitulo:          sale.property?.title || "—",
    imovelEndereco:        [sale.property?.neighborhood, sale.property?.city].filter(Boolean).join(", ") || "—",
    imovelCidade:          sale.property?.city || "—",
    corretorNome:          sale.associate?.user?.name || "—",
    corretorEmail:         sale.associate?.user?.email || "—",
    dataVenda:             sale.submittedAt ? new Date(sale.submittedAt).toLocaleDateString("pt-BR") : "—"
  };
}

function fillTemplate(html, ctx){
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = ctx[k];
    return (v == null || v === "") ? `{{${k}}}` : String(v);
  });
}

// Permissão: ADMIN · LEGAL · ou associate dono da venda
async function canAccessSale(req, sale){
  if (!sale) return false;
  if (["ADMIN","LEGAL"].includes(req.user.role)) return true;
  if (req.user.role === "ASSOCIATE"){
    const a = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
    return a?.id === sale.associateId;
  }
  return false;
}

// GET /api/sales/:id/contract
// Se já existe Contratos/<saleId>.html retorna · senão gera do template preenchido
r.get("/:id/contract", requireAuth, async (req, res, next) => {
  try {
    const sale = await db.sale.findUnique({ where: { id: req.params.id } });
    if (!sale) return res.status(404).json({ error: "not_found" });
    if (!(await canAccessSale(req, sale))) return res.status(403).json({ error: "forbidden" });

    const filePath = path.join(CONTRATOS_DIR, `${sale.id}.html`);
    if (fs.existsSync(filePath)){
      const html = fs.readFileSync(filePath, "utf8");
      const stat = fs.statSync(filePath);
      return res.json({ html, edited: true, updatedAt: stat.mtime.toISOString() });
    }
    const tpl = loadTemplate();
    const ctx = await buildContext(sale.id);
    const html = fillTemplate(tpl, ctx || {});
    res.json({ html, edited: false });
  } catch (e){ next(e); }
});

// PUT /api/sales/:id/contract · salva HTML editado
r.put("/:id/contract", requireAuth, async (req, res, next) => {
  try {
    const sale = await db.sale.findUnique({ where: { id: req.params.id } });
    if (!sale) return res.status(404).json({ error: "not_found" });
    if (!(await canAccessSale(req, sale))) return res.status(403).json({ error: "forbidden" });

    const html = String(req.body?.html || "");
    if (html.length < 50) return res.status(400).json({ error: "empty_or_too_small" });
    if (html.length > 500_000) return res.status(413).json({ error: "too_large", max: 500_000 });

    const filePath = path.join(CONTRATOS_DIR, `${sale.id}.html`);
    fs.writeFileSync(filePath, html, "utf8");
    await audit({ req, action: "CONTRACT_SAVED", entity: `Sale:${sale.id}`, metadata: { size: html.length } });
    const stat = fs.statSync(filePath);
    res.json({ ok: true, updatedAt: stat.mtime.toISOString(), size: html.length });
  } catch (e){ next(e); }
});

// DELETE /api/sales/:id/contract · volta ao template original (admin/legal apenas)
r.delete("/:id/contract", requireAuth, async (req, res, next) => {
  try {
    if (!["ADMIN","LEGAL"].includes(req.user.role)) return res.status(403).json({ error: "forbidden" });
    const sale = await db.sale.findUnique({ where: { id: req.params.id } });
    if (!sale) return res.status(404).json({ error: "not_found" });
    const filePath = path.join(CONTRATOS_DIR, `${sale.id}.html`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await audit({ req, action: "CONTRACT_RESET", entity: `Sale:${sale.id}` });
    res.json({ ok: true });
  } catch (e){ next(e); }
});

export default r;
