// =============================================================================
// /api/upload · proxy para MinIO · retorna URL pré-assinada para leitura
// =============================================================================
import { Router } from "express";
import multer from "multer";
import { Client as Minio } from "minio";
import { requireAuth } from "../auth/middleware.js";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const minio = new Minio({
  endPoint: process.env.MINIO_ENDPOINT || "localhost",
  port:     Number(process.env.MINIO_PORT || 9000),
  useSSL:   process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
  secretKey: process.env.MINIO_SECRET_KEY || "minioadmin"
});
const BUCKET = process.env.MINIO_BUCKET || "calebe-documentos";

// Garante que o bucket existe (idempotente)
async function ensureBucket(){
  try {
    const exists = await minio.bucketExists(BUCKET);
    if (!exists) await minio.makeBucket(BUCKET, "us-east-1");
  } catch (e){ logger.warn({ err: e.message }, "minio bucket check failed"); }
}
ensureBucket();

async function handleUpload(req, res, prefix){
  if (!req.file) return res.status(400).json({ error: "file_required" });
  const key = `${prefix}/${new Date().toISOString().slice(0,10)}/${randomUUID()}-${req.file.originalname}`;
  try {
    await minio.putObject(BUCKET, key, req.file.buffer, req.file.size, { "Content-Type": req.file.mimetype });
    // URL pré-assinada de 7 dias
    const url = await minio.presignedGetObject(BUCKET, key, 7 * 24 * 3600);
    res.status(201).json({ key, url, size: req.file.size, mimetype: req.file.mimetype });
  } catch (e){
    logger.error({ err: e }, "minio upload failed");
    res.status(500).json({ error: "upload_failed", message: e.message });
  }
}

// POST /api/upload/creci
r.post("/creci", requireAuth, upload.single("file"), (req, res) => handleUpload(req, res, "creci"));

// POST /api/upload/sale-document
r.post("/sale-document", requireAuth, upload.single("file"), (req, res) => handleUpload(req, res, "sale-doc"));

export default r;
