// =============================================================================
// /api/profile-photo · upload da foto de perfil do corretor (qualquer user auth)
// Salva em <PROJECT_ROOT>/Midias/perfil/ · servido publicamente em /midias/perfil/<file>
// URL retornada é permanente (sem expiração) · igual padrão do /api/welcome-video.
// =============================================================================
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireAuth } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";

const r = Router();

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const PERFIL_DIR = path.join(PROJECT_ROOT, "Midias", "perfil");
try { fs.mkdirSync(PERFIL_DIR, { recursive: true }); } catch {}

const perfilUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PERFIL_DIR),
    filename: (req, file, cb) => {
      const ts = Date.now();
      const rawExt = path.extname(file.originalname || ".jpg").toLowerCase();
      const ext = /^\.(jpe?g|png|webp|gif)$/i.test(rawExt) ? rawExt : ".jpg";
      const userId = (req.user && req.user.id) ? String(req.user.id).slice(-10) : "anon";
      cb(null, `perfil-${userId}-${ts}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB · suficiente pra fotos de perfil
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpe?g|png|webp|gif)$/i.test(file.mimetype)) {
      return cb(new Error("Tipo não suportado · use JPG, PNG, WebP ou GIF"));
    }
    cb(null, true);
  }
});

// POST /api/profile-photo/upload · corretor (ou admin) envia a própria foto · retorna URL
r.post("/upload", requireAuth, (req, res, next) => {
  perfilUpload.single("file")(req, res, async (err) => {
    try {
      if (err) {
        const msg = err.code === "LIMIT_FILE_SIZE"
          ? "Arquivo > 8MB · reduza a foto"
          : (err.message || "Falha no upload");
        return res.status(400).json({ error: "upload_failed", message: msg });
      }
      if (!req.file) return res.status(400).json({ error: "file_required" });
      const url = `/midias/perfil/${req.file.filename}`;
      try {
        await audit({
          req,
          action: "PROFILE_PHOTO_UPLOADED",
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
