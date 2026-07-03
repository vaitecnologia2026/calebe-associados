// =============================================================================
// /api/developments · empreendimentos (nível 1). Cada um agrupa várias unidades
// (Property) com as características comuns do prédio: área comum, lazer, data
// de entrega, localização compartilhada.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";

const r = Router();

// 2026-05-14 · Upload de capa/video do empreendimento. Arquivos vao para
// PROJECT_ROOT/Midias/dev-${id}/ servidos via /midias/dev-${id}/...
const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const MIDIAS_DIR   = path.join(PROJECT_ROOT, "Midias");
try { fs.mkdirSync(MIDIAS_DIR, { recursive: true }); } catch {}
function sanitizeFilename(name){
  return String(name || "").replace(/[^\w.\- ]/g, "_").replace(/\s+/g, "_").slice(0, 120);
}
const devUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(MIDIAS_DIR, `dev-${req.params.id}`);
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${randomUUID()}-${sanitizeFilename(file.originalname)}`)
  }),
  limits: { fileSize: 200 * 1024 * 1024 }  // 200MB · video pode ser maior
});

const developmentSchema = z.object({
  code:            z.string().min(2).max(40),
  name:            z.string().min(2).max(200),
  description:     z.string().max(4000).optional().nullable(),

  address:         z.string().max(300).optional().nullable(),
  neighborhood:    z.string().min(2).max(120),
  city:            z.string().min(2).max(120),
  state:           z.string().length(2),
  zipCode:         z.string().max(20).optional().nullable(),

  developmentType: z.string().max(60).optional().nullable(),
  totalUnits:      z.number().int().positive().max(5000).optional().nullable(),
  totalFloors:     z.number().int().positive().max(200).optional().nullable(),
  totalTowers:     z.number().int().positive().max(50).optional().nullable(),
  deliveryDate:    z.string().datetime().optional().nullable(),
  launchDate:      z.string().datetime().optional().nullable(),

  commonAreas:     z.array(z.string().max(80)).max(40).optional().default([]),
  leisureFeatures: z.array(z.string().max(80)).max(40).optional().default([]),
  differentials:   z.string().max(4000).optional().nullable(),

  builder:         z.string().max(200).optional().nullable(),
  registryNumber:  z.string().max(120).optional().nullable(),

  status:          z.enum(["ACTIVE","SOLD_OUT","DELIVERED","SUSPENDED"]).optional().default("ACTIVE"),

  // 2026-05-12 · Capa + vídeo + mapa + comissão + flags
  // 2026-05-14 · relaxado .url() pra .max(500) · suporta paths locais como /midias/dev-xxx/...
  coverImageUrl:     z.string().max(500).optional().nullable(),
  videoUrl:          z.string().max(500).optional().nullable(),
  latitude:          z.number().min(-90).max(90).optional().nullable(),
  longitude:         z.number().min(-180).max(180).optional().nullable(),
  commissionDefault: z.string().max(20).optional().nullable(),  // "2,5%"
  acceptsPermuta:    z.boolean().optional(),
  acceptsParcelado:  z.boolean().optional(),
  cubBaseValue:      z.number().nonnegative().optional().nullable(),
  // 2026-05-13 · Capa do card: tipologias + valor único permuta/parcelado
  tipologias: z.array(z.object({
    suites:      z.number().int().min(0).max(20).optional().nullable(),
    label:       z.string().max(60).optional().nullable(),       // ex: "Cobertura", "Garden"
    valorAvista: z.number().nonnegative().optional().nullable()
  })).max(20).optional().nullable(),
  valorPermutaParcelado: z.number().nonnegative().optional().nullable()
});

// Converte strings ISO/date em Date para Prisma.
function normalizeDates(data){
  const out = { ...data };
  if (out.deliveryDate) out.deliveryDate = new Date(out.deliveryDate);
  if (out.launchDate)   out.launchDate   = new Date(out.launchDate);
  return out;
}

// ---------- Listagem ---------------------------------------------------------
r.get("/", requireAuth, async (req, res, next) => {
  try {
    // 2026-05-12 · cap aumentado pra 5000 · DWV importado tem ~1700+ devs e
    // o painel corretor precisa listar todos pra agrupar com unidades.
    const take = Math.min(Number(req.query.limit) || 50, 5000);
    const skip = Number(req.query.offset) || 0;
    const where = {
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(req.query.city   ? { city:   String(req.query.city) }   : {}),
      ...(req.query.q ? { OR: [
        { name: { contains: String(req.query.q), mode: "insensitive" } },
        { code: { contains: String(req.query.q), mode: "insensitive" } },
        { neighborhood: { contains: String(req.query.q), mode: "insensitive" } }
      ] } : {})
    };
    const [data, total] = await Promise.all([
      db.development.findMany({
        where, take, skip,
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { units: true } } }
      }),
      db.development.count({ where })
    ]);
    // 2026-05-12 · Agregados por empreendimento · qtd disponíveis, valor min/max das unidades disponíveis
    const ids = data.map(d => d.id);
    let aggMap = new Map();
    if (ids.length){
      const agg = await db.$queryRaw`
        SELECT "developmentId" AS id,
               COUNT(*) FILTER (WHERE status = 'AVAILABLE')::int AS available,
               COUNT(*) FILTER (WHERE status = 'SOLD')::int      AS sold,
               COUNT(*) FILTER (WHERE status = 'RESERVED')::int  AS reserved,
               MIN(CASE WHEN status='AVAILABLE' THEN "priceCash" END)::numeric::float8 AS minPrice,
               MAX(CASE WHEN status='AVAILABLE' THEN "priceCash" END)::numeric::float8 AS maxPrice
        FROM "Property"
        WHERE "developmentId" = ANY(${ids})
        GROUP BY "developmentId"
      `;
      aggMap = new Map(agg.map(r => [r.id, { available: r.available, sold: r.sold, reserved: r.reserved, minPrice: r.minprice, maxPrice: r.maxprice }]));
    }
    const enriched = data.map(d => ({ ...d, agg: aggMap.get(d.id) || { available: 0, sold: 0, reserved: 0, minPrice: null, maxPrice: null } }));
    res.json({ data: enriched, total, limit: take, offset: skip });
  } catch (e){ next(e); }
});

// ---------- Detalhe + unidades vinculadas ------------------------------------
r.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const dev = await db.development.findUnique({
      where: { id: req.params.id },
      include: {
        units: {
          orderBy: [{ status: "asc" }, { unitNumber: "asc" }],
          select: {
            id: true, code: true, title: true, unitNumber: true, tower: true, floor: true,
            unitType: true, area: true, bedrooms: true, suites: true, garages: true,
            value: true, priceList: true, priceCash: true, status: true
          }
        },
        _count: { select: { units: true } }
      }
    });
    if (!dev) return res.status(404).json({ error: "not_found" });
    res.json(dev);
  } catch (e){ next(e); }
});

// ---------- Criar -----------------------------------------------------------
r.post("/", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const data = developmentSchema.parse(req.body);
    const dev = await db.development.create({ data: normalizeDates(data) });
    await audit({ req, action: "DEVELOPMENT_CREATED", entity: `Development:${dev.id}`, metadata: { code: dev.code, name: dev.name } });
    res.status(201).json(dev);
  } catch (e){
    if (e.code === "P2002") return res.status(409).json({ error: "code_already_exists" });
    next(e);
  }
});

// ---------- Atualizar --------------------------------------------------------
r.patch("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    // patch parcial · valida apenas campos presentes
    const partialSchema = developmentSchema.partial();
    const data = partialSchema.parse(req.body);
    const dev = await db.development.update({
      where: { id: req.params.id },
      data: normalizeDates(data)
    });
    await audit({ req, action: "DEVELOPMENT_UPDATED", entity: `Development:${dev.id}`, metadata: { fields: Object.keys(data) } });
    res.json(dev);
  } catch (e){
    if (e.code === "P2025") return res.status(404).json({ error: "not_found" });
    if (e.code === "P2002") return res.status(409).json({ error: "code_already_exists" });
    next(e);
  }
});

// ---------- Excluir ----------------------------------------------------------
// Unidades vinculadas NÃO são excluídas — o FK é SetNull (ficam "avulsas").
r.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const dev = await db.development.delete({ where: { id: req.params.id } });
    await audit({ req, action: "DEVELOPMENT_DELETED", entity: `Development:${dev.id}`, metadata: { code: dev.code, name: dev.name } });
    res.json({ ok: true });
  } catch (e){
    if (e.code === "P2025") return res.status(404).json({ error: "not_found" });
    next(e);
  }
});

// ---------- Upload de capa / vídeo (ADMIN-only) ------------------------------
// POST /api/developments/:id/upload/:tipo
//   tipo=cover  → image (jpg/png/webp) · seta Development.coverImageUrl
//   tipo=video  → mp4/mov/webm         · seta Development.videoUrl
// Sobrescreve URL anterior (intencional · admin substitui capa/video do empreendimento).
// 2026-05-14 · adicionado pra UX do admin nao precisar hospedar imagem/video em URL externo.
r.post("/:id/upload/:tipo", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  if (!["cover", "video"].includes(req.params.tipo)){
    return res.status(400).json({ error: "invalid_type", message: "tipo deve ser 'cover' ou 'video'" });
  }
  try {
    const exists = await db.development.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: "development_not_found" });
  } catch (e){ return next(e); }

  devUpload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: "upload_failed", message: err.message });
    const f = req.file;
    if (!f) return res.status(400).json({ error: "no_file" });
    try {
      const publicUrl = `/midias/dev-${req.params.id}/${f.filename}`;
      const field = req.params.tipo === "cover" ? "coverImageUrl" : "videoUrl";
      const updated = await db.development.update({
        where: { id: req.params.id },
        data:  { [field]: publicUrl }
      });
      await audit({ req, action: "DEVELOPMENT_MEDIA_UPLOAD", entity: `Development:${updated.id}`, metadata: { tipo: req.params.tipo, filename: f.filename, size: f.size } });
      res.status(201).json({ ok: true, url: publicUrl, field, size: f.size, mimetype: f.mimetype });
    } catch (e){ next(e); }
  });
});

export default r;
