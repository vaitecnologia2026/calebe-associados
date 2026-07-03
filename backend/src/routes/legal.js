import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { ensureCommissionForSale } from "../services/commissionService.js";
import { sseToUser, sseToAdmins } from "../services/sseHub.js";
import { sendPushToUser } from "../services/push.js";

const r = Router();

// Jurídico vê vendas SUBMITTED · IN_ANALYSIS · DRAFTING · SIGNING
r.get("/", requireAuth, requireRole("LEGAL","ADMIN"), async (req, res, next) => {
  try {
    const statuses = req.query.status ? [String(req.query.status)] : ["SUBMITTED","IN_ANALYSIS","DRAFTING","SIGNING","APPROVED","DENIED"];
    const data = await db.sale.findMany({
      where: { status: { in: statuses } },
      orderBy: { submittedAt: "desc" },
      include: { associate: { select: { user: { select: { name:true } } } }, property: { select: { code:true, title:true } }, documents: true }
    });
    res.json({ data });
  } catch (e){ next(e); }
});

r.patch("/:id/status", requireAuth, requireRole("LEGAL","ADMIN"), async (req, res, next) => {
  try {
    const { status, reason } = z.object({
      status: z.enum(["IN_ANALYSIS","DRAFTING","SIGNING","APPROVED","DENIED"]),
      reason: z.string().optional()
    }).parse(req.body);
    const data = { status };
    if (status === "APPROVED") data.approvedAt = new Date();
    if (status === "DENIED")   data.denialReason = reason || null;
    const s = await db.sale.update({
      where: { id: req.params.id },
      data,
      include: { associate: { select: { userId: true, user: { select: { name: true } } } }, property: { select: { code: true, title: true } } }
    });
    // Cria comissão automaticamente ao aprovar venda · commissionValue do _meta do imóvel
    // (fallback 5% de finalValue). Idempotente via upsert (saleId é @unique).
    if (status === "APPROVED"){
      await ensureCommissionForSale(s.id).catch(e => console.warn("commission auto-create failed:", e.message));
      // Push pro corretor: venda aprovada + comissão criada (dois eventos distintos).
      if (s.associate?.userId){
        sendPushToUser(s.associate.userId, {
          eventKey: "sale.approved",
          kind: "sale_approved",
          title: "✅ Venda aprovada",
          body: `Venda ${s.code || s.id.slice(0, 8)} aprovada pelo jurídico`,
          url: `/?screen=cors-vendas&sale=${s.id}`,
          tag: `sale-${s.id}`,
        }).catch(()=>{});
        sendPushToUser(s.associate.userId, {
          eventKey: "commission.created",
          kind: "commission_created",
          title: "💰 Comissão criada",
          body: `Comissão da venda ${s.code || s.id.slice(0, 8)} foi registrada`,
          url: `/?screen=cors-comissoes&sale=${s.id}`,
          tag: `commission-${s.id}`,
        }).catch(()=>{});
      }
    }
    await audit({ req, action: "LEGAL_STATUS_CHANGED", entity: `Sale:${s.id}`, metadata: { status, reason } });
    // Notifica corretor (dono) e admins · frontend recarrega a lista em tempo real
    try {
      const payload = {
        saleId: s.id,
        saleCode: s.code || null,
        status: s.status,
        propertyCode: s.property?.code || null,
        reason: reason || null
      };
      if (s.associate?.userId) sseToUser(s.associate.userId, "sale.status_changed", payload);
      sseToAdmins("sale.status_changed", payload);
    } catch (e){ console.warn("SSE sale.status_changed falhou:", e.message); }
    res.json({ id: s.id, status: s.status });
  } catch (e){ next(e); }
});

r.patch("/:id/assign", requireAuth, requireRole("LEGAL","ADMIN"), async (req, res, next) => {
  // Placeholder — em produção, atribuição a analistas jurídicos específicos
  res.json({ ok: true, message: "assignment stored in audit log" });
});

export default r;
