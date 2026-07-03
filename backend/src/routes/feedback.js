// =============================================================================
// /api/feedback · usuário reporta bug/sugestão com screenshot automático.
// Salva a imagem em <PROJECT_ROOT>/Midias/feedback/ + cria 1 Notification por ADMIN
// + grava audit log. Sem tabela nova — reusa Notification + audit pra inbox/registro.
// =============================================================================
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { logger } from "../utils/logger.js";
import { sseToAdmins } from "../services/sseHub.js";
import { sendPushToRole } from "../services/push.js";

const r = Router();

const PROJECT_ROOT  = path.resolve(process.cwd(), "..");
const FEEDBACK_DIR  = path.join(PROJECT_ROOT, "Midias", "feedback");
try { fs.mkdirSync(FEEDBACK_DIR, { recursive: true }); } catch {}

const feedbackUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FEEDBACK_DIR),
    filename: (req, file, cb) => {
      const ts = Date.now();
      const rawExt = path.extname(file.originalname || ".png").toLowerCase();
      const ext = /^\.(jpe?g|png|webp)$/i.test(rawExt) ? rawExt : ".png";
      const userId = (req.user && req.user.id) ? String(req.user.id).slice(-10) : "anon";
      cb(null, `feedback-${userId}-${ts}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB · screenshot full-page pode ser grande
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpe?g|png|webp)$/i.test(file.mimetype)) {
      return cb(new Error("Tipo não suportado · use PNG, JPG ou WebP"));
    }
    cb(null, true);
  }
});

const CATEGORIES = ["bug", "ux", "performance", "sugestao", "duvida", "outro"];

// POST /api/feedback · multipart com (screenshot file opcional) + body { type, description, currentUrl?, userAgent? }
r.post("/", requireAuth, (req, res, next) => {
  // Aceita com OU sem screenshot. .single("screenshot") faz field opcional.
  feedbackUpload.single("screenshot")(req, res, async (err) => {
    try {
      if (err) {
        const msg = err.code === "LIMIT_FILE_SIZE"
          ? "Screenshot > 10MB · reduza a resolução"
          : (err.message || "Falha no upload");
        return res.status(400).json({ error: "upload_failed", message: msg });
      }

      const parsed = z.object({
        type: z.enum(CATEGORIES),
        description: z.string().min(10).max(4000),
        currentUrl: z.string().max(1000).optional(),
        userAgent: z.string().max(500).optional(),
      }).safeParse({
        type: String(req.body.type || "").toLowerCase(),
        description: String(req.body.description || ""),
        currentUrl: req.body.currentUrl ? String(req.body.currentUrl) : undefined,
        userAgent: req.body.userAgent ? String(req.body.userAgent) : undefined,
      });
      if (!parsed.success) {
        return res.status(422).json({ error: "invalid_payload", issues: parsed.error.issues });
      }
      const { type, description, currentUrl, userAgent } = parsed.data;

      const screenshotUrl = req.file ? `/midias/feedback/${req.file.filename}` : null;

      // Cria 1 Notification por ADMIN com link pro screenshot. Inclui label da categoria
      // no title pra admin priorizar visualmente.
      const admins = await db.user.findMany({
        where: { role: "ADMIN", active: true },
        select: { id: true }
      });
      const CAT_LABEL = {
        bug: "Bug", ux: "UX/Design", performance: "Performance",
        sugestao: "Sugestão", duvida: "Dúvida", outro: "Outro"
      };
      const senderLabel = `${req.user.name || req.user.email} (${req.user.role})`;
      const title = `🐛 ${CAT_LABEL[type]} · ${senderLabel}`;
      // O body fica curto pra cabe na notification; descrição completa fica no audit/link
      const bodyTrimmed = description.length > 240 ? description.slice(0, 240) + "…" : description;

      const created = await Promise.all(admins.map((a) =>
        db.notification.create({
          data: {
            userId: a.id,
            type: "bug_report",
            title,
            body: bodyTrimmed,
            link: screenshotUrl || (currentUrl || "/admin"),
          }
        }).catch((e) => { logger.warn({ err: e.message, adminId: a.id }, "feedback notification create failed"); return null; })
      ));
      const notifications = created.filter(Boolean);

      // Audit · preserva descrição completa e metadados (URL, userAgent)
      await audit({
        req,
        action: "FEEDBACK_SUBMITTED",
        entity: `Feedback:${req.file?.filename || "no-screenshot"}`,
        metadata: {
          type, currentUrl, userAgent,
          screenshotUrl, descriptionLen: description.length,
          descriptionPreview: description.slice(0, 500),
          adminsNotified: notifications.length,
        }
      }).catch(() => {});

      // SSE pra admins online · realtime sem refresh
      try {
        sseToAdmins("feedback.submitted", {
          type, sender: senderLabel,
          screenshotUrl, currentUrl,
          preview: bodyTrimmed,
          at: new Date().toISOString()
        });
      } catch {}

      // Push pra admins (mesmo offline)
      sendPushToRole("ADMIN", {
        eventKey: "feedback.submitted",
        kind: "feedback_submitted",
        title,
        body: bodyTrimmed,
        url: screenshotUrl || currentUrl || "/admin",
        tag: `feedback-${Date.now()}`,
      }).catch(()=>{});

      logger.info({
        type, screenshotUrl, currentUrl,
        senderUserId: req.user.id, adminsNotified: notifications.length
      }, "🐛 feedback submitted");

      res.status(201).json({
        ok: true,
        screenshotUrl,
        adminsNotified: notifications.length,
      });
    } catch (e) { next(e); }
  });
});

export default r;
