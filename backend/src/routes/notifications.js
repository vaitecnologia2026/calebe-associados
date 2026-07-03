import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { sseToUser } from "../services/sseHub.js";
import { sendPushToUser } from "../services/push.js";
import { invalidatePushSettingsCache } from "../services/pushSettingsCache.js";
import { logger } from "../utils/logger.js";

const r = Router();

r.get("/", requireAuth, async (req, res, next) => {
  try {
    const data = await db.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" }, take: 100 });
    const unread = data.filter(n => !n.readAt).length;
    res.json({ data, unread });
  } catch (e){ next(e); }
});

r.patch("/:id/read", requireAuth, async (req, res, next) => {
  try {
    const n = await db.notification.update({ where: { id: req.params.id }, data: { readAt: new Date() } });
    res.json({ id: n.id, readAt: n.readAt });
  } catch (e){ next(e); }
});

r.post("/read-all", requireAuth, async (req, res, next) => {
  try {
    await db.notification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
    res.json({ ok: true });
  } catch (e){ next(e); }
});

// 2026-05-11 · admin manda recado pro corretor via sistema (sininha + SSE + Web Push)
const createSchema = z.object({
  userId: z.string().min(5),         // alvo · User.id do corretor
  title:  z.string().min(1).max(120),
  body:   z.string().max(2000).optional(),
  type:   z.string().max(60).default("admin_message"),
  link:   z.string().max(500).optional()
});

r.post("/", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const target = await db.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true, email: true, active: true } });
    if (!target) return res.status(404).json({ error: "user_not_found" });
    if (!target.active) return res.status(409).json({ error: "user_inactive" });

    const n = await db.notification.create({
      data: {
        userId: target.id,
        title:  input.title,
        body:   input.body || null,
        type:   input.type,
        link:   input.link || null
      }
    });

    // Push em tempo real (sino na UI) + Web Push (notificação OS) · ambos best-effort
    sseToUser(target.id, "notification.new", {
      id: n.id, title: n.title, body: n.body, type: n.type, link: n.link, createdAt: n.createdAt
    });
    sendPushToUser(target.id, {
      eventKey: "notification.custom",
      title: input.title,
      body:  input.body ? input.body.slice(0, 140) : undefined,
      data:  { notificationId: n.id, link: input.link || "" }
    }).catch(()=>{});

    logger.info({ from: req.user.email, to: target.email, title: input.title }, "📨 admin notification created");
    res.status(201).json(n);
  } catch (e){ next(e); }
});

// =============================================================================
// 2026-06-22 · Configuração de push por evento (admin) — tela "Configuração de
// Notificações". Lista os 24 eventos pusháveis do sistema e permite ligar/desligar
// cada um. Guard em services/push.js#sendPushToUser respeita isActive.
// =============================================================================

r.get("/push-settings", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const data = await db.pushNotificationSetting.findMany({
      orderBy: [{ category: "asc" }, { label: "asc" }]
    });
    res.json({ data });
  } catch (e) { next(e); }
});

const pushSettingPatchSchema = z.object({
  isActive: z.boolean()
});

r.put("/push-settings/:key", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const parsed = pushSettingPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: "invalid_payload", issues: parsed.error.issues });

    const existing = await db.pushNotificationSetting.findUnique({ where: { key: req.params.key } });
    if (!existing) return res.status(404).json({ error: "push_event_not_found" });

    const updated = await db.pushNotificationSetting.update({
      where: { key: req.params.key },
      data: { isActive: parsed.data.isActive }
    });

    // Invalida cache local (pm2 cluster: outras instâncias convergem em até 60s).
    invalidatePushSettingsCache();

    logger.info(
      { admin: req.user.email, key: updated.key, isActive: updated.isActive },
      "🔔 push setting toggled"
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default r;
