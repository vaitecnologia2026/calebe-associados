// =============================================================================
// /api/welcome-video · upload do vídeo de boas-vindas (admin) · disco local
// Salva em <PROJECT_ROOT>/Midias/welcome/ · servido publicamente em /midias/welcome/<file>
// URL retornada é permanente (sem expiração) · diferente do /api/upload que usa MinIO presigned.
// =============================================================================
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";

const r = Router();

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const WELCOME_DIR = path.join(PROJECT_ROOT, "Midias", "welcome");
try { fs.mkdirSync(WELCOME_DIR, { recursive: true }); } catch {}

const welcomeUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, WELCOME_DIR),
    filename: (req, file, cb) => {
      const ts = Date.now();
      const safe = (file.originalname || "video.mp4").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
      cb(null, `welcome-${ts}-${safe}`);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (!/^video\/(mp4|webm|quicktime)$/i.test(file.mimetype)) {
      return cb(new Error("Tipo não suportado · use MP4 ou WebM"));
    }
    cb(null, true);
  }
});

// POST /api/welcome-video/upload · admin envia o arquivo · retorna URL pública persistente
r.post("/upload", requireAuth, requireRole("ADMIN"), (req, res, next) => {
  welcomeUpload.single("file")(req, res, async (err) => {
    try {
      if (err) {
        const msg = err.code === "LIMIT_FILE_SIZE"
          ? "Arquivo > 100MB · reduza o vídeo"
          : (err.message || "Falha no upload");
        return res.status(400).json({ error: "upload_failed", message: msg });
      }
      if (!req.file) return res.status(400).json({ error: "file_required" });
      const url = `/midias/welcome/${req.file.filename}`;
      try {
        await audit({
          req,
          action: "WELCOME_VIDEO_UPLOADED",
          entity: req.file.filename,
          metadata: { size: req.file.size, mime: req.file.mimetype, originalName: req.file.originalname }
        });
      } catch { /* audit não deve quebrar o upload */ }
      res.status(201).json({
        ok: true,
        url,
        filename: req.file.filename,
        size: req.file.size,
        mime: req.file.mimetype
      });
    } catch (e){ next(e); }
  });
});

export default r;
