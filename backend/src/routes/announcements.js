import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { sendPushToRole } from "../services/push.js";

const r = Router();

// =============================================================================
// Uploads de anexos: <root>/Avisos/<announcementId>/<uuid>-<arquivo>
// URL público: /avisos/<announcementId>/<uuid>-<arquivo>
// =============================================================================
const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const AVISOS_DIR = path.join(PROJECT_ROOT, "Avisos");
try { fs.mkdirSync(AVISOS_DIR, { recursive: true }); } catch {}

// Upload temporário · movemos manualmente pra pasta do aviso após criar a linha
// limite 100MB por arquivo · acomoda video curto (ex: 30-60s mp4 720p ~30-60MB).
// Imagens/docs continuam pequenas naturalmente · sem regressao.
const tempUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

function sanitize(name){
  return String(name || "file").replace(/[^\w.\- ]/g, "_").replace(/\s+/g, "_").slice(0, 120);
}

// Associado só vê avisos direcionados a ele · admin vê tudo
r.get("/", requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === "ADMIN"){
      const data = await db.announcement.findMany({ orderBy: { createdAt: "desc" } });
      return res.json({ data });
    }
    const a = await db.associate.findUnique({ where: { userId: req.user.id } });
    const data = await db.announcement.findMany({
      where: {
        OR: [
          { target: "ALL" },
          { target: "SEGMENT", targetSegment: a?.segment },
          { target: "INDIVIDUAL", targetUserId: req.user.id }
        ]
      },
      orderBy: { createdAt: "desc" }
    });
    const reads = await db.announcementRead.findMany({ where: { userId: req.user.id }, select: { announcementId: true } });
    const readSet = new Set(reads.map(r => r.announcementId));
    res.json({ data: data.map(d => ({ ...d, read: readSet.has(d.id) })) });
  } catch (e){ next(e); }
});

// POST aceita multipart/form-data OU application/json. Campos:
// title, body, target (ALL|SEGMENT|INDIVIDUAL), targetSegment, targetUserId, showOnLogin, expiresAt
// Arquivos: imagem (image/*), documento (pdf/doc/docx)
const baseSchema = z.object({
  title: z.string().min(2),
  body: z.string().min(1),
  target: z.enum(["ALL","SEGMENT","INDIVIDUAL"]).default("ALL"),
  targetSegment: z.string().optional(),
  targetUserId: z.string().optional(),
  showOnLogin: z.boolean().default(false),
  expiresAt: z.string().datetime().optional()
});

r.post("/",
  requireAuth, requireRole("ADMIN"),
  tempUpload.fields([
    { name: "imagem",    maxCount: 1 },
    { name: "documento", maxCount: 1 },
    { name: "video",     maxCount: 1 }
  ]),
  async (req, res, next) => {
    try {
      // Multipart strings chegam como string → normaliza antes do zod
      const b = req.body || {};
      const parsed = baseSchema.parse({
        title: b.title,
        body:  b.body,
        target: b.target || "ALL",
        targetSegment: b.targetSegment || undefined,
        targetUserId:  b.targetUserId  || undefined,
        showOnLogin: b.showOnLogin === true || b.showOnLogin === "true",
        expiresAt: b.expiresAt || undefined
      });
      const a = await db.announcement.create({
        data: {
          ...parsed,
          createdBy: req.user.id,
          expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined
        }
      });
      // Move arquivos temporários pra pasta final do aviso
      const dir = path.join(AVISOS_DIR, a.id);
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      const updates = {};
      const img = req.files?.imagem?.[0];
      const doc = req.files?.documento?.[0];
      const vid = req.files?.video?.[0];
      if (img){
        const finalName = `${randomUUID()}-${sanitize(img.originalname)}`;
        fs.renameSync(img.path, path.join(dir, finalName));
        updates.imageUrl = `/avisos/${a.id}/${finalName}`;
      }
      if (doc){
        const finalName = `${randomUUID()}-${sanitize(doc.originalname)}`;
        fs.renameSync(doc.path, path.join(dir, finalName));
        updates.documentUrl = `/avisos/${a.id}/${finalName}`;
      }
      if (vid){
        const finalName = `${randomUUID()}-${sanitize(vid.originalname)}`;
        fs.renameSync(vid.path, path.join(dir, finalName));
        updates.videoUrl = `/avisos/${a.id}/${finalName}`;
      }
      const final = Object.keys(updates).length
        ? await db.announcement.update({ where: { id: a.id }, data: updates })
        : a;
      await audit({ req, action: "ANNOUNCEMENT_CREATED", entity: `Announcement:${a.id}`, metadata: { target: a.target, hasImage: !!img, hasDoc: !!doc, hasVideo: !!vid } });
      // Push pra associados (segmentação fina via target é decisão futura — por enquanto,
      // qualquer aviso novo vira push pro role ASSOCIATE; admin desativa no toggle se quiser silenciar).
      sendPushToRole("ASSOCIATE", {
        eventKey: "announcement.created",
        kind: "announcement_created",
        title: `📣 ${final.title || "Novo aviso"}`,
        body: (final.body || "").slice(0, 140) || "Há um novo aviso na sua tela inicial",
        url: `/?screen=avisos&announcement=${final.id}`,
        tag: `announcement-${final.id}`,
      }).catch(()=>{});
      res.status(201).json(final);
    } catch (e){
      // Limpa arquivos órfãos em caso de erro
      for (const f of [req.files?.imagem?.[0], req.files?.documento?.[0], req.files?.video?.[0]]){
        if (f?.path) try { fs.unlinkSync(f.path); } catch {}
      }
      next(e);
    }
  }
);

r.patch("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try { res.json(await db.announcement.update({ where: { id: req.params.id }, data: req.body })); }
  catch (e){ next(e); }
});

r.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    await db.announcement.delete({ where: { id: req.params.id } });
    // Remove pasta de anexos (se existir)
    const dir = path.join(AVISOS_DIR, req.params.id);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    await audit({ req, action: "ANNOUNCEMENT_DELETED", entity: `Announcement:${req.params.id}` });
    res.json({ ok: true });
  } catch (e){ next(e); }
});

r.post("/:id/read", requireAuth, async (req, res, next) => {
  try {
    await db.announcementRead.upsert({
      where: { announcementId_userId: { announcementId: req.params.id, userId: req.user.id } },
      create: { announcementId: req.params.id, userId: req.user.id },
      update: {}
    });
    res.json({ ok: true });
  } catch (e){ next(e); }
});

export default r;
