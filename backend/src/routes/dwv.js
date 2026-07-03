// =============================================================================
// /api/dwv · 2026-05-12
// Sincroniza imóveis da DWV (https://api.dwvapp.com.br) com nosso CRM.
// Endpoints:
//   GET  /api/dwv/status   · enabled, token presente, último sync (audit)
//   GET  /api/dwv/preview  · puxa do DWV e retorna sem persistir (dry-run)
//   POST /api/dwv/sync     · puxa do DWV e persiste no DB (upsert)
// =============================================================================
import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { isEnabled, fetchAllProperties, syncProperties } from "../services/dwv.js";
import { db } from "../db.js";

const r = Router();

r.get("/status", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const lastSync = await db.auditEvent.findFirst({
    where: { action: "DWV_SYNC" }, orderBy: { createdAt: "desc" },
    select: { createdAt: true, metadata: true }
  }).catch(() => null);
  res.json({ enabled: isEnabled(), lastSync });
});

r.get("/preview", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
  try {
    if (!isEnabled()) return res.status(503).json({ error: "dwv_disabled", message: "Configure DWV_TOKEN no .env" });
    const data = await fetchAllProperties({ maxPages: 1, perPage: 25 });
    res.json({ count: data.length, sample: data });
  } catch (e){
    res.status(e.status || 500).json({ error: e.message, body: e.body });
  }
});

r.post("/sync", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    if (!isEnabled()) return res.status(503).json({ error: "dwv_disabled", message: "Configure DWV_TOKEN no .env" });
    const dryRun = !!req.body?.dryRun;
    const result = await syncProperties({ dryRun });
    await audit({ req, action: "DWV_SYNC", entity: "DWV", metadata: { ...result, errors: undefined, errorCount: result.errors?.length || 0 } });
    res.json(result);
  } catch (e){
    res.status(e.status || 500).json({ error: e.message, body: e.body });
  }
});

export default r;
