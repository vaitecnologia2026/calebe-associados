// =============================================================================
// CRM Calebe Associados · API Express
// =============================================================================
import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { logger } from "./utils/logger.js";
import { db } from "./db.js";
import { initChatDb, chatPool } from "./chatDb.js";

// Rotas
import authRoutes          from "./routes/auth.js";
import magicRoutes         from "./routes/magic.js";
import associatesRoutes    from "./routes/associates.js";
import permutasRoutes      from "./routes/permutas.js";
import leadsRoutes         from "./routes/leads.js";
import assistantRoutes     from "./routes/assistant.js";
import distributionRoutes  from "./routes/distribution.js";
import campaignsRoutes     from "./routes/campaigns.js";
import { resumeRunningCampaigns } from "./services/campaignRunner.js";
import importsRoutes       from "./routes/imports.js";
import commercialSupportRoutes from "./routes/commercialSupport.js";
import conversationsRoutes from "./routes/conversations.js";
import propertiesRoutes    from "./routes/properties.js";
import developmentsRoutes  from "./routes/developments.js";
import visitsRoutes        from "./routes/visits.js";
import salesRoutes         from "./routes/sales.js";
import contractsRoutes     from "./routes/contracts.js";
import legalRoutes         from "./routes/legal.js";
import commissionsRoutes   from "./routes/commissions.js";
import structureRoutes     from "./routes/structure.js";
import notificationsRoutes from "./routes/notifications.js";
import announcementsRoutes from "./routes/announcements.js";
import settingsRoutes      from "./routes/settings.js";
import dashboardsRoutes    from "./routes/dashboards.js";
import webhooksRoutes      from "./routes/webhooks.js";
import uploadRoutes        from "./routes/upload.js";
import welcomeVideoRoutes  from "./routes/welcome-video.js";
import profilePhotoRoutes  from "./routes/profile-photo.js";
import vaiRoutes           from "./routes/vai.js";
import chatHistoryRoutes   from "./routes/chatHistory.js";
import streamRoutes        from "./routes/stream.js";
import phoneReleaseRoutes  from "./routes/phoneRelease.js";
import pushRoutes          from "./routes/push.js";
import whatsappCloudRoutes        from "./routes/whatsappCloud.js";
import coachRoutes          from "./routes/coach.js";
import audioMp4Routes, { audioMp3Router } from "./routes/audioMp4.js";
import feedbackRoutes        from "./routes/feedback.js"; // 2026-06-01 · Reportar problema (modal + screenshot)
import devRoutes             from "./routes/dev.js"; // 2026-06-01 · Painel Dev (feedback + audit + msg stats + IA)
import whatsappCloudWebhookRoutes from "./routes/whatsappCloudWebhook.js";
// 2026-05-14 · DWV temporariamente desativado · re-ativar removendo o stub abaixo
import dwvRoutes                  from "./routes/dwv.js";
import voiceRoutes                from "./routes/voice.js";
import agreementRoutes            from "./routes/agreement.js";
import hygieneRoutes from "./routes/hygiene.js";
// 2026-05-27 · Fase 0 instrumentação · event loop / memory / slow queries
import metricsRoutes              from "./routes/metrics.js";
import iaRoutes               from "./routes/ia.js"; // 2026-05-31 · Assistente IA (ADMIN-only)
import assistsRoutes from "./routes/assists.js"; // 2026-06-01 add F1 Eder
import suporteRoutes from "./routes/suporte.js"; // 2026-06-10 · Suporte Técnico IA

// Jobs (agendados)
import { startLeadQueueWorker }    from "./jobs/leadQueueWorker.js";
import { startInactivityWorker }   from "./jobs/inactivityRedistributionWorker.js";
import { startCampaignRoletaWorker } from "./jobs/campaignRoletaWorker.js";
import { startDashboardWorker }    from "./jobs/dashboardMetricsWorker.js";
import { startReactivationWorker } from "./jobs/leadReactivationWorker.js";

const app = express();
const PORT = Number(process.env.PORT || 4000);

// ----- Middlewares globais ---------------------------------------------------
app.set("trust proxy", 1);
app.use(pinoHttp({ logger, redact: ["req.headers.authorization","req.headers.cookie"] }));

app.use(cors({
  origin: (process.env.CORS_ORIGIN || "").split(",").map(o => o.trim()).filter(Boolean),
  credentials: true
}));
app.use(cookieParser());

// Body parsers · webhooks precisam de raw body · roteadores montam-o isoladamente
// 2026-05-11 · Webhook WhatsApp Cloud API · MONTADO PRIMEIRO porque /api/webhooks abaixo
// é prefix-match e pegaria /whatsapp-cloud antes desse roteador especifico. Router faz
// raw() internamente pra HMAC X-Hub-Signature-256.
app.use("/api/webhooks/whatsapp-cloud", whatsappCloudWebhookRoutes);

app.use("/api/webhooks", webhooksRoutes);     // monta antes com raw()
// 2026-05-06 · ALIAS CURTO p/ painel VAI (limite 50 chars na URL do "Webhook de Saida").
// Mesmo router, prefix curto. Caminho final p/ Flow: /api/wf/x?s=<secret-curto>.
// Demais rotas (leads/vai) tambem ficam expostas em /api/wf/* mas continuam protegidas
// por HMAC/secret proprios — nenhum vetor de bypass adicional.
app.use("/api/wf",       webhooksRoutes);     // alias curto

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Arquivos locais: /midias · /documentos · /documentos-juridicos · /pagamentos-comissoes · /avisos
const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const MIDIAS_DIR     = path.join(PROJECT_ROOT, "Midias");
const DOCUMENTOS_DIR = path.join(PROJECT_ROOT, "Documentos");
const JURIDICOS_DIR  = path.join(PROJECT_ROOT, "Documentos Juridicos");
const COMISSOES_DIR  = path.join(PROJECT_ROOT, "Pagamentos Comissoes");
const AVISOS_DIR     = path.join(PROJECT_ROOT, "Avisos");
for (const d of [MIDIAS_DIR, DOCUMENTOS_DIR, JURIDICOS_DIR, COMISSOES_DIR, AVISOS_DIR]){
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
}
app.use("/midias",                express.static(MIDIAS_DIR,     { maxAge: "30d", fallthrough: true }));
app.use("/documentos",            express.static(DOCUMENTOS_DIR, { maxAge: "30d", fallthrough: true }));
app.use("/documentos-juridicos",  express.static(JURIDICOS_DIR,  { maxAge: "30d", fallthrough: true }));
app.use("/pagamentos-comissoes",  express.static(COMISSOES_DIR,  { maxAge: "30d", fallthrough: true }));
app.use("/avisos",                express.static(AVISOS_DIR,     { maxAge: "30d", fallthrough: true }));

// Rate limit geral (exceto webhooks, que já têm HMAC)
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max:      Number(process.env.RATE_LIMIT_MAX || 240),
  standardHeaders: true,
  legacyHeaders: false
});
app.use("/api", limiter);

// 2026-07-02 · Rate-limit ESTRITO no login (anti brute-force). O global (240/min)
// e frouxo demais pra senha. trust proxy=1 (acima) garante req.ip real do cliente.
const authLoginLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS || 600_000),
  max:      Number(process.env.RATE_LIMIT_AUTH_MAX || 40),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_attempts", message: "Muitas tentativas de login. Aguarde alguns minutos e tente de novo." }
});

// ----- Health ----------------------------------------------------------------
app.get("/api/health", async (req, res) => {
  try { await db.$queryRaw`SELECT 1`; res.json({ ok: true, ts: new Date().toISOString() }); }
  catch (e){ res.status(503).json({ ok: false, error: e.message }); }
});

// 2026-05-27 · Fase 0 · /api/_metrics (event loop, memory, slow queries)
app.use("/api/_metrics", metricsRoutes);

// ----- Rotas -----------------------------------------------------------------
app.use("/api/auth/magic",     magicRoutes);   // 2026-05-11 · magic link primeiro acesso · ANTES de /api/auth pra evitar prefix-shadow
app.use("/api/auth/login", authLoginLimiter); // estrito antes do handler
app.use("/api/auth",           authRoutes);
app.use("/api/associates",     associatesRoutes);
app.use("/api/permutas", permutasRoutes);
app.use("/api/leads",          leadsRoutes);
app.use("/api/assistant",     assistantRoutes);
app.use("/api/distribution",   distributionRoutes);
app.use("/api/campaigns",      campaignsRoutes);
try { resumeRunningCampaigns(); } catch (e) { /* boot resume best-effort */ }
app.use("/api/imports",        importsRoutes);
app.use("/api/conversations",  conversationsRoutes);
app.use("/api/commercial-support", commercialSupportRoutes);
app.use("/api/properties",     propertiesRoutes);
app.use("/api/developments",   developmentsRoutes);
app.use("/api/hygiene", hygieneRoutes);
// 2026-05-14 · /api/dwv desativado temporariamente a pedido do Calebe · re-ativar trocando pelo dwvRoutes original
app.use("/api/dwv",            (_req, res) => res.status(503).json({ error: "dwv_disabled", message: "Integração DWV temporariamente desativada." }));
void dwvRoutes; // mantem o import vivo p/ reativacao rapida sem refazer linter
// Voice (Twilio click-to-call) · expõe /api/leads/:id/voice-call + /api/voice/twiml/:token (público)
app.use("/api",                voiceRoutes);
app.use("/api/agreement",      agreementRoutes);
app.use("/api/visits",         visitsRoutes);
app.use("/api/sales",          salesRoutes);
app.use("/api/sales",          contractsRoutes);
app.use("/api/legal",          legalRoutes);
app.use("/api/commissions",    commissionsRoutes);
app.use("/api/structure",      structureRoutes);
app.use("/api/notifications",  notificationsRoutes);
app.use("/api/announcements",  announcementsRoutes);
app.use("/api/settings",       settingsRoutes);
app.use("/api/dashboards",     dashboardsRoutes);
app.use("/api/upload",         uploadRoutes);
app.use("/api/welcome-video",  welcomeVideoRoutes);
app.use("/api/profile-photo",  profilePhotoRoutes);
app.use("/api/vai",            vaiRoutes);
app.use("/api/chat-history",   chatHistoryRoutes);
app.use("/api/stream",         streamRoutes);
app.use("/api/phone-release",  phoneReleaseRoutes);
app.use("/api/push",           pushRoutes);
app.use("/api/whatsapp",       whatsappCloudRoutes);   // 2026-05-11 · templates + send via Cloud API oficial
app.use("/api/coach",         coachRoutes);
app.use("/api/audio-mp4",     audioMp4Routes);
app.use("/api/audio-mp3",     audioMp3Router);  // 2026-05-16 · fallback MP3 universal (Safari Mac com AAC bugado)
app.use("/api/feedback", feedbackRoutes); // 2026-06-01 · Reportar problema
app.use("/api/dev", devRoutes); // 2026-06-01 · Painel Dev
app.use("/api/ia", iaRoutes);  // 2026-05-31 · Assistente IA (ADMIN-only)
app.use("/api/assists", assistsRoutes); // 2026-06-01 add F1 Eder
app.use("/api/suporte", suporteRoutes); // 2026-06-10 · Suporte Técnico IA

// ----- 404 + error handler ---------------------------------------------------
app.use("/api", (req, res) => res.status(404).json({ error: "not_found", path: req.path }));

app.use((err, req, res, _next) => {
  req.log?.error({ err }, "uncaught");
  if (err?.code === "P2002") return res.status(409).json({ error: "duplicate", target: err.meta?.target });
  if (err?.code === "P2025") return res.status(404).json({ error: "not_found" });
  if (err?.name === "ZodError") return res.status(422).json({ error: "validation", issues: err.issues });
  // Multer (upload) errors · expor codigo pro cliente saber o que aconteceu
  if (err?.name === "MulterError"){
    const map = { LIMIT_FILE_SIZE: 413, LIMIT_FILE_COUNT: 413, LIMIT_UNEXPECTED_FILE: 422 };
    return res.status(map[err.code] || 400).json({ error: "upload_error", code: err.code, field: err.field });
  }
  // fileFilter rejeitou (Error(invalid_mime)) · multer encaminha como erro genérico
  if (err?.message === "invalid_mime") return res.status(415).json({ error: "invalid_mime" });
  res.status(500).json({ error: "internal_error", message: process.env.NODE_ENV === "production" ? undefined : err.message });
});

// ----- Jobs em background ----------------------------------------------------
if (process.env.NODE_ENV !== "test"){
  // startLeadQueueWorker(); // 2026-06-11 DESATIVADO · regra unica = cron _distribuir_500_diario
  // 2026-06-09 · Redistribuição automática por inatividade DESATIVADA a pedido do admin.
  // Leads não são mais removidos de corretores automaticamente.
  // startInactivityWorker();
  startDashboardWorker();
  startReactivationWorker();
  startCampaignRoletaWorker(); // 2026-07-02 · roleta de campanha (Fase 2)
}

// ----- Boot ------------------------------------------------------------------
// Inicializa banco de chat (cria tabelas se não existirem)
initChatDb().catch(e => logger.warn({ err: e.message }, "chat DB init error"));

app.listen(PORT, () => {
  logger.info(`🚀 API Calebe Associados rodando em :${PORT}  (env=${process.env.NODE_ENV || "dev"})`);
});

// Graceful shutdown
for (const sig of ["SIGTERM", "SIGINT"]){
  process.on(sig, async () => {
    logger.info({ sig }, "shutting down");
    await db.$disconnect();
    if (chatPool) await chatPool.end().catch(()=>{});
    process.exit(0);
  });
}
