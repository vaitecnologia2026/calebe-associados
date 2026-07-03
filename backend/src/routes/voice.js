// =============================================================================
// /api/voice · 2026-05-12
// Click-to-call mascarado (Twilio bridge) + gravação + transcrição Whisper + detector de palavras
// =============================================================================
import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { audit } from "../utils/audit.js";
import { logger } from "../utils/logger.js";
import { db } from "../db.js";
import { decrypt } from "../crypto.js";
import { isEnabled, placeBridgeCall, consumeToken, buildBridgeTwiml } from "../services/voiceBridge.js";
import { sseToUser, sseToAdmins } from "../services/sseHub.js";
import crypto from "node:crypto";

const r = Router();

// ---------- Detector simples de palavras-chave (corretor pedindo contato direto) ---
// Tudo lowercase · busca substring. Lista pode crescer no .env DETECT_KEYWORDS=...
const DEFAULT_KEYWORDS = [
  "me passa seu whats", "me passa seu zap", "qual seu zap", "qual seu whats", "me chama no zap",
  "me chama no whats", "me chama por whats", "me adiciona", "me liga depois", "passa seu numero",
  "passa seu telefone", "qual seu numero", "qual seu telefone", "numero direto", "telefone direto",
  "fora do app calebe", "fora da calebe", "fora do sistema", "te ligo do meu", "te chamo no meu",
  "vou te ligar do meu", "me chama no meu", "salva meu numero", "anota meu numero"
];
function envKeywords(){
  const s = process.env.DETECT_KEYWORDS;
  if (!s) return DEFAULT_KEYWORDS;
  return s.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}
function detectKeywords(transcript){
  if (!transcript || typeof transcript !== "string") return [];
  const t = transcript.toLowerCase();
  return envKeywords().filter(k => t.includes(k));
}

// ---------- POST /api/leads/:id/voice-call --------------------------------------
r.post("/leads/:id/voice-call", requireAuth, async (req, res, next) => {
  try {
    if (!isEnabled()) return res.status(503).json({ error: "twilio_not_configured", message: "Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_FROM_NUMBER no .env" });

    const lead = await db.lead.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, phoneEncrypted: true, phoneMasked: true, assignedToId: true, assignedTo: { select: { id: true, phone: true, whatsapp: true, userId: true, user: { select: { name: true } } } } }
    });
    if (!lead) return res.status(404).json({ error: "not_found" });

    const isAdmin = req.user.role === "ADMIN";
    let corretorPhone = null;
    let corretorName = null;
    let associateId = lead.assignedToId;
    if (isAdmin){
      corretorPhone = req.body?.from || lead.assignedTo?.whatsapp || lead.assignedTo?.phone;
      corretorName = lead.assignedTo?.user?.name || "consultor Calebe";
    } else {
      const me = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true, phone: true, whatsapp: true, user: { select: { name: true } } } });
      if (!me) return res.status(403).json({ error: "not_lead_owner" });
      // Aceita ownership via lead.assignedToId OU conv.associateId quando lead está na fila
      // (mesma lógica de whatsappCloud.js — cobre gap entre redistribuição e nova atribuição)
      const isLeadOwner = lead.assignedToId && me.id === lead.assignedToId;
      const conv = !lead.assignedToId
        ? await db.conversation.findFirst({ where: { leadId: lead.id }, select: { associateId: true } })
        : null;
      const isConvOwner = !lead.assignedToId && conv?.associateId === me.id;
      if (!isLeadOwner && !isConvOwner) return res.status(403).json({ error: "not_lead_owner" });
      corretorPhone = me.whatsapp || me.phone;
      corretorName = me.user?.name || "consultor Calebe";
      associateId = me.id;
    }
    if (!corretorPhone) return res.status(422).json({ error: "no_corretor_phone", message: "Corretor sem telefone cadastrado" });

    let leadPhone;
    try { leadPhone = decrypt(lead.phoneEncrypted); }
    catch { return res.status(500).json({ error: "phone_decrypt_failed" }); }

    // 2026-06-22 · NOVO FLUXO: template primeiro → cliente confirma → corretor liga
    // confirm=false (padrão): envia template e retorna pending_confirm
    // confirm=true: coloca a chamada Twilio (cliente já confirmou ou corretor força)
    const confirm = req.body?.confirm === true;

    let preNotice = { ok: false, skipped: true };
    try {
      const { isEnabled: isWaCloudEnabled, sendTemplate } = await import("../services/whatsappCloud.js");
      if (isWaCloudEnabled()){
        const firstName = (lead.name || "").split(" ")[0] || "cliente";
        const r0 = await sendTemplate({
          to: leadPhone, templateName: "calebe_ligacao_iniciada", languageCode: "pt_BR",
          bodyParams: [firstName, corretorName]
        });
        preNotice = { ok: !!r0.ok, messageId: r0.messageId, error: r0.error, skipped: false };
      }
    } catch (e){
      preNotice = { ok: false, error: e.message, skipped: false };
      logger.warn({ err: e.message }, "template ligação falhou");
    }

    // Sem confirm: aguarda cliente responder antes de ligar
    if (!confirm){
      await audit({ req, action: "VOICE_TEMPLATE_SENT", entity: `Lead:${lead.id}`, metadata: { preNotice } });
      logger.info({ leadId: lead.id, by: req.user.id }, "📨 template ligação enviado · aguardando cliente");
      return res.json({ status: "pending_confirm", sentAt: new Date().toISOString(), preNotice });
    }

    // Com confirm: aguarda 2s pós-template (se enviou) e coloca a chamada
    if (preNotice.ok) await new Promise(r => setTimeout(r, 2000));

    const r1 = await placeBridgeCall({
      corretorPhone, leadPhone,
      meta: { leadId: lead.id, associateId }
    });

    try {
      await db.callRecording.create({
        data: {
          id: crypto.randomUUID(),
          callSid: r1.callSid,
          leadId: lead.id,
          associateId,
          associateName: corretorName,
          leadName: lead.name,
          fromNumber: process.env.TWILIO_FROM_NUMBER,
          toNumber: lead.phoneMasked || null
        }
      });
    } catch (e){
      logger.warn({ err: e.message, callSid: r1.callSid }, "CallRecording row create falhou (segue)");
    }

    await audit({ req, action: "VOICE_BRIDGE_PLACED", entity: `Lead:${lead.id}`, metadata: { callSid: r1.callSid, to: r1.to, preNotice: preNotice.ok } });
    logger.info({ leadId: lead.id, callSid: r1.callSid, by: req.user.id }, "📞 voice bridge placed");
    res.json({ ...r1, status: "placed", preNotice });
  } catch (e){
    res.status(e.status || 500).json({ error: e.message || "voice_call_failed", body: e.body });
  }
});

// ---------- /api/voice/twiml/:token (público) --------------------------------------
const twimlHandler = (req, res) => {
  const payload = consumeToken(req.params.token);
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  if (!payload){
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="Polly.Camila" language="pt-BR">Esta chamada expirou. Tente novamente pelo aplicativo Calebe.</Say><Hangup/></Response>`);
  }
  res.send(buildBridgeTwiml(payload.leadPhoneNorm));
};
r.get("/voice/twiml/:token",  twimlHandler);
r.post("/voice/twiml/:token", twimlHandler);

// ---------- /api/voice/status · status callback de chamada -----------------------
r.post("/voice/status", express.urlencoded ? express.urlencoded({ extended: false }) : (req,_res,next)=>next(), (req, res) => {
  try { logger.info({ body: req.body }, "📞 voice status callback"); } catch {}
  res.status(204).end();
});

// ---------- /api/voice/recording-status · Twilio envia URL da gravação ----------
// Fluxo: recebe URL → baixa MP3 → transcreve (Whisper) → detecta palavras → salva no DB + cria Message
import express from "express";
r.post("/voice/recording-status", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const callSid = req.body?.CallSid || req.body?.ParentCallSid;
    const recUrl = req.body?.RecordingUrl;       // base · sem .mp3
    const recSid = req.body?.RecordingSid;
    const dur    = parseInt(req.body?.RecordingDuration || "0", 10);
    logger.info({ callSid, recSid, dur }, "📼 recording status received");
    if (!callSid || !recUrl){ return res.status(204).end(); }

    const rec = await db.callRecording.findUnique({ where: { callSid } });
    if (!rec){
      logger.warn({ callSid }, "CallRecording não encontrada · ignorando recording");
      return res.status(204).end();
    }

    // Atualiza row com URL + duração
    await db.callRecording.update({
      where: { id: rec.id },
      data: { recordingUrl: recUrl, recordingSid: recSid, durationSec: dur, updatedAt: new Date() }
    });

    // Em background: baixa MP3, transcreve, detecta palavras, cria Message
    processRecording(rec.id).catch(e => logger.warn({ err: e.message, recId: rec.id }, "processRecording falhou"));

    res.status(204).end();
  } catch (e){
    logger.error({ err: e.message }, "/voice/recording-status erro");
    res.status(500).json({ error: e.message });
  }
});

async function processRecording(recordingId){
  const rec = await db.callRecording.findUnique({ where: { id: recordingId } });
  if (!rec || !rec.recordingUrl) return;
  let transcript = null;
  // 1. Whisper transcription (se OPENAI_API_KEY configurado)
  if (process.env.OPENAI_API_KEY){
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const tok = process.env.TWILIO_AUTH_TOKEN;
      const auth = Buffer.from(`${sid}:${tok}`).toString("base64");
      const mp3Res = await fetch(`${rec.recordingUrl}.mp3`, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(60_000) });
      if (mp3Res.ok){
        const blob = await mp3Res.blob();
        const form = new FormData();
        form.append("file", blob, "call.mp3");
        form.append("model", "whisper-1");
        form.append("language", "pt");
        const wRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: form,
          signal: AbortSignal.timeout(120_000)
        });
        if (wRes.ok){
          const wJson = await wRes.json();
          transcript = wJson.text || null;
        } else {
          logger.warn({ status: wRes.status, body: await wRes.text().catch(()=>"") }, "Whisper falhou");
        }
      } else {
        logger.warn({ status: mp3Res.status }, "Twilio MP3 download falhou");
      }
    } catch (e){
      logger.warn({ err: e.message }, "Whisper pipeline exception");
    }
  } else {
    logger.info({ recId: rec.id }, "OPENAI_API_KEY não configurado · pulando transcrição");
  }

  // 2. Detect keywords (mesmo sem transcrição não roda detector)
  const flagged = transcript ? detectKeywords(transcript) : [];

  await db.callRecording.update({
    where: { id: rec.id },
    data: {
      transcript,
      flaggedWords: flagged,
      flaggedAt: flagged.length > 0 ? new Date() : null,
      transcribedAt: transcript ? new Date() : null,
      updatedAt: new Date()
    }
  });

  // 3. Cria Message na Conversation correspondente (player + transcript no chat)
  if (rec.leadId){
    const conv = await db.conversation.findFirst({ where: { leadId: rec.leadId } });
    if (conv){
      try {
        const previewText = transcript
          ? (transcript.length > 280 ? transcript.slice(0, 280) + "…" : transcript)
          : "(transcrição indisponível)";
        const flagBadge = flagged.length > 0
          ? `\n\n⚠ Palavras suspeitas detectadas: ${flagged.join(", ")}`
          : "";
        await db.message.create({
          data: {
            conversationId: conv.id,
            direction: "outbound",
            fromRole: "associate",
            text: `📞 Ligação Calebe Bridge · ${Math.round(rec.durationSec/60) || 0}min ${rec.durationSec%60}s\n\n${previewText}${flagBadge}`,
            contentType: "call_recording",
            provider: "twilio",
            fileUrl: `/api/voice/recording/${rec.id}/audio`,   // proxy interno · só admin abre
            mimeType: "audio/mpeg",
            whatsappMessageId: rec.callSid,
            deliveredAt: new Date()
          }
        });
        await db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
      } catch (e){
        logger.warn({ err: e.message, recId: rec.id }, "criar Message de call_recording falhou");
      }
    }
  }

  // 4. Notifica admin via SSE se houver flag
  if (flagged.length > 0){
    sseToAdmins("call.flagged", { recordingId: rec.id, callSid: rec.callSid, leadName: rec.leadName, associateName: rec.associateName, words: flagged });
    logger.warn({ recId: rec.id, words: flagged, associate: rec.associateName, lead: rec.leadName }, "🚨 CHAMADA FLAGGED · palavras suspeitas detectadas");
  }
}

// ---------- /api/voice/recording/:id/audio · admin baixa MP3 via proxy ------------
// Twilio MP3 requer auth · escondemos as creds atrás desse proxy
r.get("/voice/recording/:id/audio", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const rec = await db.callRecording.findUnique({ where: { id: req.params.id } });
    if (!rec || !rec.recordingUrl) return res.status(404).json({ error: "not_found" });
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const tok = process.env.TWILIO_AUTH_TOKEN;
    const auth = Buffer.from(`${sid}:${tok}`).toString("base64");
    const mp3 = await fetch(`${rec.recordingUrl}.mp3`, { headers: { Authorization: `Basic ${auth}` } });
    if (!mp3.ok) return res.status(mp3.status).end();
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    const buf = Buffer.from(await mp3.arrayBuffer());
    res.send(buf);
  } catch (e){
    res.status(500).json({ error: e.message });
  }
});

// ---------- /api/voice/recordings · lista pra admin (filtros leadId, flagged, search) ---
r.get("/voice/recordings", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.leadId)     where.leadId = String(req.query.leadId);
    if (req.query.associateId) where.associateId = String(req.query.associateId);
    if (req.query.flagged === "1") where.flaggedAt = { not: null };
    const data = await db.callRecording.findMany({
      where, orderBy: { createdAt: "desc" }, take: 200
    });
    res.json({ data });
  } catch (e){ next(e); }
});

export default r;
