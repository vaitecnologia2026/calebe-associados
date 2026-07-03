// Envio de permuta/avaliação pelo corretor (imóvel ou carro). Admin revisa. 2026-06-09
import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";

const r = Router();
const PERMUTA_DIR = process.env.PERMUTA_STORAGE_DIR || "/root/vaidavenda-calebe/storage/permuta";
try { fs.mkdirSync(PERMUTA_DIR, { recursive: true }); } catch { /* ok */ }

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PERMUTA_DIR),
    filename: (_req, file, cb) => {
      const ts = Date.now();
      const rnd = crypto.randomBytes(4).toString("hex");
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 8) || "";
      const safe = path.basename(file.originalname, path.extname(file.originalname)).replace(/[^\w.-]/g, "_").slice(0, 40);
      cb(null, `${ts}-${rnd}-${safe}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.mimetype);
    cb(ok ? null : new Error("invalid_mime"), ok);
  },
});
const fields = upload.fields([
  { name: "imovelFotos", maxCount: 12 },
  { name: "carroFotos", maxCount: 12 },
  { name: "carroDoc", maxCount: 3 },
]);

// POST /api/permutas — corretor logado envia
r.post("/", requireAuth, fields, async (req, res, next) => {
  try {
    const b = req.body || {};
    const nome = (b.nome || "").trim();
    if (!nome) return res.status(400).json({ error: "nome_obrigatorio" });
    const files = req.files || {};
    const names = (k) => (files[k] || []).map((f) => f.filename);
    let associateId = null;
    try {
      const a = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      associateId = a?.id || null;
    } catch { /* ok */ }
    const created = await db.permuta.create({
      data: {
        associateId,
        associateNome: req.user?.name || null,
        nome,
        telefone: (b.telefone || "").trim() || null,
        tipoNegociacao: (b.tipoNegociacao || "").trim() || "nao_informado",
        imovelAvaliacao: (b.imovelAvaliacao || "").trim() || null,
        imovelObs: (b.imovelObs || "").trim() || null,
        imovelFotos: names("imovelFotos"),
        carroFotos: names("carroFotos"),
        carroDocUrl: (files.carroDoc || [])[0]?.filename || null,
      },
    });
    res.json({ ok: true, id: created.id });
  } catch (e) { next(e); }
});

// GET /api/permutas — admin lista
r.get("/", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const list = await db.permuta.findMany({ orderBy: { createdAt: "desc" }, take: 300 });
    res.json({ data: list });
  } catch (e) { next(e); }
});

// GET /api/permutas/:id/file/:name — admin vê foto/doc (protegido)
r.get("/:id/file/:name", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const p = await db.permuta.findUnique({ where: { id: req.params.id } });
    if (!p) return res.status(404).end();
    const name = path.basename(req.params.name);
    const all = [...(p.imovelFotos || []), ...(p.carroFotos || []), ...(p.carroDocUrl ? [p.carroDocUrl] : [])];
    if (!all.includes(name)) return res.status(403).end();
    const fp = path.join(PERMUTA_DIR, name);
    if (!fs.existsSync(fp)) return res.status(404).end();
    res.sendFile(fp);
  } catch (e) { next(e); }
});

export default r;
