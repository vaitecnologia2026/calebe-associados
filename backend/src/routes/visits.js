import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { sendPushToRole } from "../services/push.js";

const r = Router();

r.get("/", requireAuth, async (req, res, next) => {
  try {
    let where = {};
    if (req.user.role === "ASSOCIATE"){
      const a = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      where = { associateId: a?.id };
    }
    if (req.query.status) where.status = req.query.status;
    const data = await db.visit.findMany({ where, take: 200, orderBy: { scheduledAt: "desc" }, include: { property: { select: { code:true, title:true } }, associate: { select: { user: { select: { name:true } } } } } });
    res.json({ data });
  } catch (e){ next(e); }
});

const visitSchema = z.object({
  leadName: z.string().min(2),
  propertyId: z.string().cuid(),
  scheduledAt: z.string().datetime(),
  notes: z.string().optional()
});

r.post("/", requireAuth, async (req, res, next) => {
  try {
    const data = visitSchema.parse(req.body);
    const associate = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
    if (!associate && req.user.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
    const v = await db.visit.create({
      data: { ...data, associateId: associate?.id || req.body.associateId, scheduledAt: new Date(data.scheduledAt) }
    });
    await audit({ req, action: "VISIT_SCHEDULED", entity: `Visit:${v.id}` });
    sendPushToRole("ADMIN", {
      eventKey: "visit.scheduled",
      kind: "visit_scheduled",
      title: "📅 Visita agendada",
      body: `${data.leadName} · ${new Date(data.scheduledAt).toLocaleString("pt-BR")}`,
      url: `/?screen=adm-visitas&visit=${v.id}`,
      tag: `visit-${v.id}`,
    }).catch(()=>{});
    res.status(201).json(v);
  } catch (e){ next(e); }
});

r.patch("/:id/confirm", requireAuth, async (req, res, next) => {
  try {
    const v = await db.visit.update({ where: { id: req.params.id }, data: { status: "CONFIRMED" } });
    await audit({ req, action: "VISIT_CONFIRMED", entity: `Visit:${v.id}` });
    sendPushToRole("ADMIN", {
      eventKey: "visit.confirmed",
      kind: "visit_confirmed",
      title: "✅ Visita confirmada",
      body: `Visita ${v.id.slice(0, 8)} marcada como confirmada`,
      url: `/?screen=adm-visitas&visit=${v.id}`,
      tag: `visit-${v.id}`,
    }).catch(()=>{});
    res.json(v);
  } catch (e){ next(e); }
});

r.patch("/:id/status", requireAuth, async (req, res, next) => {
  try {
    const status = z.enum(["PENDING","CONFIRMED","DONE","CANCELLED","RESCHEDULED"]).parse(req.body.status);
    const v = await db.visit.update({ where: { id: req.params.id }, data: { status } });
    await audit({ req, action: "VISIT_STATUS_CHANGED", entity: `Visit:${v.id}`, metadata: { status } });
    if (status === "DONE") {
      sendPushToRole("ADMIN", {
        eventKey: "visit.done",
        kind: "visit_done",
        title: "🏁 Visita realizada",
        body: `Visita ${v.id.slice(0, 8)} marcada como concluída`,
        url: `/?screen=adm-visitas&visit=${v.id}`,
        tag: `visit-${v.id}`,
      }).catch(()=>{});
    }
    res.json(v);
  } catch (e){ next(e); }
});

export default r;
