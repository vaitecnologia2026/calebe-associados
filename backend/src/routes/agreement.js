// =============================================================================
// /api/agreement · 2026-05-12 · Acordo Calebe ↔ Corretor Associado
// Admin sobe um PDF · corretores podem baixar pra ler.
// Por enquanto sem fluxo de assinatura (porta aberta pra implementar depois).
// =============================================================================
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { db } from "../db.js";

const r = Router();

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const AGREEMENT_DIR = path.join(PROJECT_ROOT, "Midias", "agreement");
try { fs.mkdirSync(AGREEMENT_DIR, { recursive: true }); } catch {}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AGREEMENT_DIR),
    filename: (_req, file, cb) => {
      const ts = Date.now();
      const safe = (file.originalname || "acordo.pdf").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
      cb(null, `acordo-${ts}-${safe}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },  // 20MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") return cb(new Error("Apenas PDF"));
    cb(null, true);
  }
});

const SETTING_KEY = "associate_agreement";

// GET /api/agreement · qualquer autenticado vê o documento atual (corretor lê / admin gerencia)
r.get("/", requireAuth, async (_req, res, next) => {
  try {
    const s = await db.systemSetting.findUnique({ where: { key: SETTING_KEY } });
    res.json(s?.value || null);
  } catch (e){ next(e); }
});

// POST /api/agreement/upload · admin sobe novo PDF (substitui o anterior · arquivo antigo fica no disco como histórico)
r.post("/upload", requireAuth, requireRole("ADMIN"), (req, res) => {
  upload.single("file")(req, res, async (err) => {
    try {
      if (err){
        const msg = err.code === "LIMIT_FILE_SIZE" ? "Arquivo > 20MB" : (err.message || "upload_failed");
        return res.status(400).json({ error: "upload_failed", message: msg });
      }
      if (!req.file) return res.status(400).json({ error: "file_required" });
      const url = `/midias/agreement/${req.file.filename}`;
      const value = {
        url,
        filename: req.file.originalname || req.file.filename,
        size: req.file.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy: req.user.id
      };
      await db.systemSetting.upsert({
        where: { key: SETTING_KEY },
        update: { value, updatedBy: req.user.id },
        create: { key: SETTING_KEY, value, updatedBy: req.user.id }
      });
      await audit({ req, action: "AGREEMENT_UPLOADED", entity: "SystemSetting", metadata: { filename: value.filename, size: value.size } });
      res.json({ ok: true, ...value });
    } catch (e){
      res.status(500).json({ error: e.message });
    }
  });
});

// DELETE /api/agreement · admin remove o documento ativo (arquivo permanece no disco)
r.delete("/", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    await db.systemSetting.deleteMany({ where: { key: SETTING_KEY } });
    await audit({ req, action: "AGREEMENT_REMOVED", entity: "SystemSetting" });
    res.json({ ok: true });
  } catch (e){ next(e); }
});

export default r;
