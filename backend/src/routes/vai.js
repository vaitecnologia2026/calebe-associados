// =============================================================================
// /api/vai · Integração VAI (WhatsApp) — auth JWT · channels · contacts · chats
// =============================================================================
import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware.js";
import {
  vaiHealthCheck,
  vaiListChannels,
  vaiGetChannelId,
  vaiListContacts,
  vaiFindOrCreateContact,
  vaiListChats,
  vaiGetChat,
  vaiListChatMessages,
  vaiSendChatMessage,
  vaiCreateChat,
  vaiEnsureChatForContact,
  vaiStartService,
  vaiCloseChat
} from "../services/vaiClient.js";

const r = Router();
const h = (e, res) => res.status(e.status || 500).json({ error: "vai_error", message: e.message, body: e.body });

// ----- Health / Channels -----------------------------------------------------
r.get("/health", requireAuth, async (_req, res) => {
  const rep = await vaiHealthCheck();
  res.status(rep.ok ? 200 : 502).json(rep);
});

// ----- Teste fim-a-fim: segue EXATAMENTE o fluxo documentado da VAI CRM ------
// Passo 1 · login (interno via vaiFetch)
// Passo 2 · POST /contacts { name, channel:"whatsapp", identifier, phone:"", email:"" }
//          → se 409, busca pelo identifier e reusa
// Passo 3 · POST /chats    { contactId, channelId, category:"pendente" }
// Passo 4 · POST /chats/{id}/messages { content, type:"text" }
// Regras: identifier sem "+", DDD>31 remove o 9 (toE164 já faz isso)
r.post("/test-message", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const started = Date.now();
  const {
    vaiFindOrCreateContact,
    vaiEnsureChatForContact,
    vaiSendChatMessage,
    vaiGetChannelId,
    vaiStartService,
    toE164
  } = await import("../services/vaiClient.js");
  const { logger } = await import("../utils/logger.js");
  const steps = [];
  const step = (name, data) => { steps.push({ name, ...data }); logger.info({ step: name, ...data }, `▶ vai_test · ${name}`); };

  try {
    const { phone, message, name } = req.body || {};
    if (!phone || !String(phone).trim())     return res.status(400).json({ ok:false, error:"phone_required" });
    if (!message || !String(message).trim()) return res.status(400).json({ ok:false, error:"message_required" });

    const e164 = toE164(String(phone));
    const identifier = e164.replace(/^\+/, "");
    if (!identifier || identifier.length < 12) return res.status(400).json({ ok:false, error:"phone_invalid", identifier });

    const contactName = (name && String(name).trim()) || "Contato Calebe";
    step("start", { phoneIn: phone, identifier, contactName });

    // Passo 2 · vaiFindOrCreateContact lida com 409 internamente: tenta POST /contacts
    //          · se já existe, busca por identifier/phone/search e reusa o id
    let contactId;
    try {
      const contact = await vaiFindOrCreateContact({ name: contactName, phone: String(phone) });
      contactId = contact?.id;
      if (!contactId) throw new Error("contact_without_id");
      step("contact_ready", { contactId, source: contact._reusedFromSearch ? "reused_existing" : "created" });
    } catch (e){
      step("contact_failed", { err: e.message, status: e.status, body: e.body });
      return res.status(e.status || 502).json({ ok:false, error:"contact_failed", message: e.message, status: e.status, body: e.body, steps });
    }

    // Passo 3 · abre chat (reusa open existente ou cria novo com category "pendente")
    const channelId = await vaiGetChannelId();
    step("channel_resolved", { channelId });
    let chat;
    try {
      chat = await vaiEnsureChatForContact(contactId);
    } catch (e){
      step("chat_failed", { err: e.message, status: e.status, body: e.body });
      return res.status(e.status || 502).json({ ok:false, error:"chat_failed", message: e.message, status: e.status, body: e.body, contactId, steps });
    }
    const chatId = chat?.id;
    if (!chatId) return res.status(502).json({ ok:false, error:"chat_without_id", contactId, chat, steps });
    step("chat_ready", { chatId, protocol: chat.protocol, status: chat.status });

    // Passo 3b · start-service idempotente (garante entrega no WhatsApp em chats recém-criados)
    try {
      await vaiStartService(chatId);
      step("start_service_ok", { chatId });
    } catch (e){
      step("start_service_ignored", { chatId, reason: e.message, status: e.status });
    }

    // Passo 4 · enviar mensagem
    let sent;
    try {
      sent = await vaiSendChatMessage(chatId, { content: String(message), type: "text" });
    } catch (e){
      step("message_send_failed", { err: e.message, status: e.status, body: e.body });
      return res.status(e.status || 502).json({ ok:false, error:"message_send_failed", message: e.message, status: e.status, body: e.body, contactId, chatId, steps });
    }
    step("message_sent", { messageId: sent?.id, status: sent?.status });

    const ms = Date.now() - started;
    res.json({
      ok: true,
      latencyMs: ms,
      identifier,
      contactId,
      channelId,
      chatId,
      protocol: chat.protocol || null,
      messageId: sent?.id || null,
      messageStatus: sent?.status || null,
      preview: String(message).slice(0, 120),
      steps
    });
  } catch (e){
    step("exception", { err: e.message, status: e.status, body: e.body });
    logger.warn({ err: e.message, status: e.status, body: e.body }, "❌ vai_test · exceção não tratada");
    res.status(e.status || 500).json({ ok:false, error:"vai_error", message: e.message, status: e.status, latencyMs: Date.now() - started, body: e.body, steps });
  }
});

r.get("/channels", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  try { res.json(await vaiListChannels()); } catch (e){ h(e, res); }
});

r.get("/channel-id", requireAuth, async (_req, res) => {
  try { res.json({ channelId: await vaiGetChannelId() }); } catch (e){ h(e, res); }
});

// Endpoint PÚBLICO (sem auth) · usado pela tela de cadastro pra montar link wa.me.
// Retorna APENAS o número do WhatsApp do canal (não expõe token nem credenciais).
r.get("/channel-phone", async (_req, res) => {
  try {
    const channels = await vaiListChannels();
    const arr = Array.isArray(channels) ? channels : (channels?.data || []);
    const channel = arr.find(c => c.type === "whatsapp" && c.status === "connected") || arr[0];
    // device_id vem tipo "5521975369200:80@s.whatsapp.net" · extrai só os dígitos antes do ":"
    const deviceId = channel?.channel_meta?.whatsapp?.device_id || "";
    const digits = String(deviceId).split("@")[0].split(":")[0].replace(/\D/g, "");
    if (!digits) return res.status(404).json({ error: "no_whatsapp_device" });
    res.json({ channelPhone: digits, businessName: channel?.channel_meta?.whatsapp?.business_name || null });
  } catch (e){
    res.status(e.status || 500).json({ error: "vai_error", message: e.message });
  }
});

// ----- Contatos --------------------------------------------------------------
r.get("/contacts", requireAuth, async (req, res) => {
  try { res.json(await vaiListContacts(req.query)); } catch (e){ h(e, res); }
});

r.post("/contacts", requireAuth, async (req, res) => {
  try {
    const { name, phone, email, externalId, customFields } = req.body || {};
    if (!name || !phone) return res.status(400).json({ error: "name_phone_required" });
    const c = await vaiFindOrCreateContact({ name, phone, email, externalId, customFields });
    res.status(201).json(c);
  } catch (e){ h(e, res); }
});

// ----- Chats -----------------------------------------------------------------
r.get("/chats", requireAuth, requireRole("ADMIN","ASSOCIATE"), async (req, res) => {
  try { res.json(await vaiListChats(req.query)); } catch (e){ h(e, res); }
});

r.get("/chats/:chatId", requireAuth, async (req, res) => {
  try { res.json(await vaiGetChat(req.params.chatId)); } catch (e){ h(e, res); }
});

// Consulta status de uma mensagem específica (pra polling de delivery)
r.get("/chats/:chatId/messages/:messageId/status", requireAuth, async (req, res) => {
  try {
    const list = await vaiListChatMessages(req.params.chatId, { limit: "50" });
    const arr = Array.isArray(list) ? list : (list?.data || []);
    const msg = arr.find(m => m.id === req.params.messageId);
    if (!msg) return res.status(404).json({ ok:false, error:"message_not_found" });
    res.json({
      ok: true,
      id: msg.id,
      status: msg.status,
      deliveredAt: msg.deliveredAt || null,
      readAt: msg.readAt || null,
      timestamp: msg.timestamp || msg.createdAt
    });
  } catch (e){ res.status(e.status || 500).json({ ok:false, error: e.message }); }
});

r.get("/chats/:chatId/messages", requireAuth, async (req, res) => {
  try { res.json(await vaiListChatMessages(req.params.chatId, req.query)); } catch (e){ h(e, res); }
});

r.post("/chats/:chatId/messages", requireAuth, async (req, res) => {
  try {
    const { content, type = "text", fileUrl, isNote = false } = req.body || {};
    if (!content || !String(content).trim()) return res.status(400).json({ error: "content_required" });
    res.status(201).json(await vaiSendChatMessage(req.params.chatId, { content, type, fileUrl, isNote }));
  } catch (e){ h(e, res); }
});

r.post("/chats", requireAuth, async (req, res) => {
  try {
    const { contactId, category, departmentId } = req.body || {};
    if (!contactId) return res.status(400).json({ error: "contactId_required" });
    res.status(201).json(await vaiCreateChat({ contactId, category, departmentId }));
  } catch (e){ h(e, res); }
});

r.post("/chats/ensure", requireAuth, async (req, res) => {
  try {
    const { contactId } = req.body || {};
    if (!contactId) return res.status(400).json({ error: "contactId_required" });
    res.json(await vaiEnsureChatForContact(contactId));
  } catch (e){ h(e, res); }
});

r.post("/chats/:chatId/start-service", requireAuth, async (req, res) => {
  try { res.json(await vaiStartService(req.params.chatId)); } catch (e){ h(e, res); }
});

r.post("/chats/:chatId/close", requireAuth, async (req, res) => {
  try {
    const { closeReasonId, notes } = req.body || {};
    res.json(await vaiCloseChat(req.params.chatId, { closeReasonId, notes }));
  } catch (e){ h(e, res); }
});

export default r;
