import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { reloadVaiConfig } from "../services/vaiClient.js";

const r = Router();

// GET /api/settings/public · config que a landing page precisa ANTES do login (vídeo, handle, etc.)
// Whitelist de chaves · jamais devolve tokens/secrets.
//
// PUBLIC_KEY_FILTERS · sanitiza valor de uma key específica antes de devolver no /public.
// Necessário pra tracking.fb (que tem capiToken sensível · só fica no servidor)
// e qualquer outra key futura que precise expor parte do conteúdo.
const PUBLIC_KEYS = ["lp.video", "tracking.fb", "tracking.gads"];
const PUBLIC_KEY_FILTERS = {
  "tracking.fb": (val) => {
    if (!val || typeof val !== "object") return val;
    // Remove capiToken (segredo server-side) · pixelId + flags + eventos são OK pra LP
    const { capiToken, ...safe } = val;
    return safe;
  }
  // tracking.gads · não tem segredo · todo o objeto pode ir
};

r.get("/public", async (_req, res, next) => {
  try {
    const rows = await db.systemSetting.findMany({ where: { key: { in: PUBLIC_KEYS } } });
    const out = {};
    for (const row of rows){
      const filter = PUBLIC_KEY_FILTERS[row.key];
      out[row.key] = filter ? filter(row.value) : row.value;
    }
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ data: out });
  } catch (e){ next(e); }
});

r.get("/", requireAuth, async (_req, res, next) => {
  try { res.json({ data: await db.systemSetting.findMany() }); }
  catch (e){ next(e); }
});

r.patch("/:key", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { value } = req.body;
    const s = await db.systemSetting.upsert({
      where: { key: req.params.key },
      create: { key: req.params.key, value, updatedBy: req.user.id },
      update: { value, updatedBy: req.user.id }
    });
    await audit({ req, action: "SETTING_UPDATED", entity: `Setting:${s.key}`, metadata: { value: s.key.includes("password") ? "***" : value } });
    // Hot-reload da config VAI quando uma chave vai.* muda (zera token cache e força re-login)
    if (s.key.startsWith("vai.")) reloadVaiConfig().catch(() => {});
    res.json(s);
  } catch (e){ next(e); }
});

export default r;
