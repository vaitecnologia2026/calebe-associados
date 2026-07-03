// =============================================================================
// /api/hygiene · HIGIENIZAR · leads nao-contataveis + acoes do BI (ADMIN-only)
// SQL raw na tabela LeadProblema (fora do schema Prisma) · nunca apaga Lead.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { encrypt, normalizePhone, maskPhone, sha256Hex } from "../crypto.js";
import { audit } from "../utils/audit.js";

const r = Router();
const ADMIN = [requireAuth, requireRole("ADMIN")];

// GET /api/hygiene · lista paginada com filtros
r.get("/", ...ADMIN, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const conds = []; const params = [];
    const push = (sql, val) => { params.push(val); conds.push(sql.replace("?", "$" + params.length)); };
    if (req.query.status)   push('lp."status" = ?', String(req.query.status));
    if (req.query.motivo)   push('lp."motivo" = ?', String(req.query.motivo));
    if (req.query.corretor) push('lp."corretorId" = ?', String(req.query.corretor));
    if (req.query.origem)   push('lp."origem" = ?', String(req.query.origem));
    if (req.query.campanha) push('lp."campanha" = ?', String(req.query.campanha));
    if (req.query.de)       push('lp."createdAt" >= ?', new Date(String(req.query.de)));
    if (req.query.ate)      push('lp."createdAt" <= ?', new Date(String(req.query.ate)));
    const whereSql = conds.length ? ("WHERE " + conds.join(" AND ")) : "";
    const data = await db.$queryRawUnsafe(
      'SELECT lp.id, lp."leadId", lp.motivo, lp."codErroMeta", lp.origem, lp.campanha, lp."corretorId", ' +
      'lp."ultimaTentativa", lp.status, lp."substituidoPorLeadId", lp."biUserId", lp."createdAt", lp."updatedAt", ' +
      'l.name AS lead_nome, l."phoneMasked" AS lead_telefone, l.status AS lead_status, cu.name AS corretor_nome ' +
      'FROM "LeadProblema" lp JOIN "Lead" l ON l.id = lp."leadId" ' +
      'LEFT JOIN "Associate" ca ON ca.id = lp."corretorId" LEFT JOIN "User" cu ON cu.id = ca."userId" ' +
      whereSql + ' ORDER BY lp."createdAt" DESC LIMIT ' + limit + ' OFFSET ' + offset, ...params);
    const totalR = await db.$queryRawUnsafe('SELECT count(*)::int AS total FROM "LeadProblema" lp ' + whereSql, ...params);
    res.json({ data, total: totalR[0]?.total ?? 0, limit, offset });
  } catch (e) { next(e); }
});

// GET /api/hygiene/stats · contagens p/ cards e filtros
r.get("/stats", ...ADMIN, async (_req, res, next) => {
  try {
    const porMotivo = await db.$queryRawUnsafe('SELECT motivo, count(*)::int AS qtd FROM "LeadProblema" GROUP BY motivo ORDER BY qtd DESC');
    const porStatus = await db.$queryRawUnsafe('SELECT status, count(*)::int AS qtd FROM "LeadProblema" GROUP BY status ORDER BY qtd DESC');
    res.json({ porMotivo, porStatus });
  } catch (e) { next(e); }
});

// POST /api/hygiene/:id/acao · acoes do BI
const schema = z.object({
  acao: z.enum(["em_analise", "descartar", "liberar", "corrigir_telefone", "substituir"]),
  substitutoLeadId: z.string().optional(),
  novoTelefone: z.string().optional(),
  observacao: z.string().max(2000).optional()
});
r.post("/:id/acao", ...ADMIN, async (req, res, next) => {
  try {
    const { acao, substitutoLeadId, novoTelefone, observacao } = schema.parse(req.body);
    const rows = await db.$queryRawUnsafe('SELECT * FROM "LeadProblema" WHERE id = $1', req.params.id);
    const lp = rows[0];
    if (!lp) return res.status(404).json({ error: "not_found" });
    let novoStatus = lp.status, sub = null;
    if (acao === "em_analise") novoStatus = "em_analise";
    else if (acao === "liberar") novoStatus = "liberado";
    else if (acao === "descartar") {
      novoStatus = "descartado";
      await db.lead.update({ where: { id: lp.leadId }, data: { assignedToId: null } });
    } else if (acao === "corrigir_telefone") {
      if (!novoTelefone) return res.status(400).json({ error: "novoTelefone_required" });
      const norm = normalizePhone(novoTelefone);
      await db.lead.update({ where: { id: lp.leadId }, data: { phoneEncrypted: encrypt(norm), phoneMasked: maskPhone(norm), phoneHash: sha256Hex(norm) } });
      novoStatus = "corrigido";
    } else if (acao === "substituir") {
      if (!substitutoLeadId) return res.status(400).json({ error: "substitutoLeadId_required" });
      const sl = await db.lead.findUnique({ where: { id: substitutoLeadId } });
      if (!sl) return res.status(400).json({ error: "substituto_nao_encontrado" });
      await db.lead.update({ where: { id: lp.leadId }, data: { assignedToId: null } });
      novoStatus = "substituido"; sub = substitutoLeadId;
    }
    await db.$executeRawUnsafe(
      'UPDATE "LeadProblema" SET status=$1, "substituidoPorLeadId"=COALESCE($2,"substituidoPorLeadId"), "biUserId"=$3, observacao=COALESCE($4,observacao), "updatedAt"=now() WHERE id=$5',
      novoStatus, sub, req.user.id, observacao ?? null, req.params.id);
    await audit({ req, action: "HYGIENE_BI_ACTION", entity: "LeadProblema:" + req.params.id, metadata: { acao, leadId: lp.leadId, novoStatus, substitutoLeadId: sub } });
    res.json({ ok: true, id: req.params.id, status: novoStatus, substituidoPorLeadId: sub });
  } catch (e) { next(e); }
});

export default r;
