// =============================================================================
// /api/lp/video · upload do MP4 da LP (admin) · disco direto em public/videos/
// O nginx serve esses arquivos diretamente como estáticos via /videos/<file>.
// =============================================================================
import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { logger } from "../utils/logger.js";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const r = Router();

const VIDEOS_DIR = process.env.LP_VIDEOS_DIR || "/root/vaidavenda-calebe/public/videos";
try { fs.mkdirSync(VIDEOS_DIR, { recursive: true }); } catch {}

const ALLOWED_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_BYTES = 60 * 1024 * 1024; // 60MB · alinha com client (recomendado <=20MB, com folga)

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VIDEOS_DIR),
  filename: (_req, file, cb) => {
    const safeOrig = (file.originalname || "video").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60);
    const ext = path.extname(safeOrig).toLowerCase() || ".mp4";
    const base = path.basename(safeOrig, ext).slice(0, 40) || "video";
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}-${base}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error("invalid_mimetype"));
    cb(null, true);
  }
});

// POST /api/lp/video/upload · multipart com campo "file"
r.post("/upload", requireAuth, requireRole("ADMIN"), (req, res, next) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "file_too_large", limitMB: MAX_BYTES / 1024 / 1024 });
      if (err.message === "invalid_mimetype") return res.status(415).json({ error: "invalid_mimetype" });
      return next(err);
    }
    if (!req.file) return res.status(400).json({ error: "file_required" });

    const url = `/videos/${req.file.filename}`;
    try {
      await audit({ req, action: "LP_VIDEO_UPLOADED", entity: `LpVideo:${req.file.filename}`,
                     metadata: { size: req.file.size, mimetype: req.file.mimetype, originalName: req.file.originalname } });
    } catch (e) { logger.warn({ err: e.message }, "audit lp_video_uploaded failed"); }

    res.status(201).json({
      ok: true,
      url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  });
});

// DELETE /api/lp/video/:filename · remove arquivo de vídeo (admin), com sanitização
r.delete("/:filename", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const file = String(req.params.filename || "");
    if (!/^[a-zA-Z0-9._-]+$/.test(file)) return res.status(400).json({ error: "invalid_filename" });
    const full = path.join(VIDEOS_DIR, file);
    if (!full.startsWith(VIDEOS_DIR + path.sep)) return res.status(400).json({ error: "invalid_path" });
    if (!fs.existsSync(full)) return res.status(404).json({ error: "not_found" });
    fs.unlinkSync(full);
    try { await audit({ req, action: "LP_VIDEO_DELETED", entity: `LpVideo:${file}` }); } catch {}
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default r;
