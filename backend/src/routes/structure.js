// /api/structure · solicitações de avião/carro/apartamento/visita
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";

const r = Router();

r.get("/", requireAuth, async (req, res, next) => {
  try {
    let where = {};
    if (req.user.role === "ASSOCIATE"){
      const a = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      where = { associateId: a?.id };
    }
    if (req.query.status) where.status = req.query.status;
    if (req.query.type)   where.structureType = req.query.type;
    const data = await db.structureRequest.findMany({
      where, take: 200, orderBy: { createdAt: "desc" },
      include: { associate: { select: { user: { select: { name:true } } } } }
    });
    res.json({ data });
  } catch (e){ next(e); }
});

const schema = z.object({
  structureType: z.enum(["PLANE","VEHICLE","APARTMENT","GUIDED_VISIT"]),
  requestedDate: z.string().datetime(),
  urgency: z.enum(["low","medium","high"]).default("medium"),
  linkedLeadName: z.string().optional(),
  linkedValue: z.union([z.number(), z.string()]).optional(),
  city: z.string().optional(),
  motive: z.string().min(10)
});

r.post("/", requireAuth, requireRole("ASSOCIATE","ADMIN"), async (req, res, next) => {
  try {
    const data = schema.parse(req.body);
    const associate = await db.associate.findUnique({ where: { userId: req.user.id } });
    if (!associate && req.user.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
    const sr = await db.structureRequest.create({
      data: { ...data, associateId: associate?.id || req.body.associateId, requestedDate: new Date(data.requestedDate) }
    });
    await audit({ req, action: "STRUCTURE_REQUESTED", entity: `Structure:${sr.id}`, metadata: { type: sr.structureType } });
    res.status(201).json(sr);
  } catch (e){ next(e); }
});

r.patch("/:id/respond", requireAuth, requireRole("ADMIN","SECRETARY"), async (req, res, next) => {
  try {
    const { status, notes, newDate } = z.object({
      status: z.enum(["APPROVED","DENIED","RESCHEDULED","REVIEWING"]),
      notes: z.string().optional(),
      newDate: z.string().datetime().optional()
    }).parse(req.body);
    const data = { status, respondedBy: req.user.id, respondedAt: new Date(), responseNotes: notes };
    if (status === "RESCHEDULED" && newDate) data.requestedDate = new Date(newDate);
    const sr = await db.structureRequest.update({ where: { id: req.params.id }, data });
    await audit({ req, action: "STRUCTURE_RESPONDED", entity: `Structure:${sr.id}`, metadata: { status, notes } });
    res.json(sr);
  } catch (e){ next(e); }
});

export default r;
