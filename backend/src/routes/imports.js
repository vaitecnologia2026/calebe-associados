// =============================================================================
// /api/imports · recebe planilha CSV/XLSX · processa em background
// =============================================================================
import { Router } from "express";
import multer from "multer";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { processImport } from "../services/importProcessor.js";

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

r.get("/", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const data = await db.leadImport.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    res.json({ data });
  } catch (e){ next(e); }
});

r.get("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const imp = await db.leadImport.findUnique({ where: { id: req.params.id } });
    if (!imp) return res.status(404).json({ error: "not_found" });
    // Sem cache · polling de progresso precisa de status fresco sempre (ETag 304 quebra cliente)
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json(imp);
  } catch (e){ next(e); }
});

// POST /api/imports/leads
r.post("/leads", requireAuth, requireRole("ADMIN"), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file_required" });
    const imp = await db.leadImport.create({
      data: { fileName: req.file.originalname, fileSize: req.file.size, status: "RECEIVED", createdBy: req.user.id }
    });
    // Processa em background · retorna imediatamente com o ID
    processImport({ importId: imp.id, buffer: req.file.buffer, filename: req.file.originalname, createdBy: req.user.id })
      .catch(err => console.error("import processing failed", err));
    res.status(202).json({ id: imp.id, status: imp.status, message: "processing_started" });
  } catch (e){ next(e); }
});

export default r;
