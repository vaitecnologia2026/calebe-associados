// =============================================================================
// /api/webhooks · inbound leads (HMAC) + VAI (HMAC + roteamento de eventos)
// ATENÇÃO: monta com express.raw para conseguir validar HMAC com body bruto.
// =============================================================================
import { Router, raw } from "express";
import { db } from "../db.js";
import { encrypt, sha256Hex, normalizePhone, maskPhone, verifyHmac } from "../crypto.js";
import { enqueueLead } from "../services/distributionEngine.js";
import { audit } from "../utils/audit.js";
import { logger } from "../utils/logger.js";
import { chatUpsertConversation, chatInsertMessage } from "../chatDb.js";
import { sseToMany } from "../services/sseHub.js";
import { vaiFetchMessageContentSafe, getVaiFlowSecret, vaiSendSafe, isVaiActivity } from "../services/vaiClient.js";
import { sendPushToUser, sendPushToRole } from "../services/push.js";

// Despacha mensagem de boas-vindas enfileirada quando corretor aprovado finalmente
// manda 1ª msg pro canal (agora o chat tem binding WhatsApp).
// REGRA DE OURO: só envia se Associate.status === "APPROVED" no momento do despacho.
async function tryDispatchPendingWelcome({ phone, vaiConvId, vaiContactId }){
  if (!phone || !vaiConvId) return;
  try {
    const digits = String(phone).replace(/\D/g, "");
    const norm = digits.startsWith("55") ? digits : (digits.length >= 10 ? "55"+digits : digits);
    const stripped = (norm.length === 13 && parseInt(norm.slice(2,4),10) > 31 && norm[4] === "9")
      ? norm.slice(0,4) + norm.slice(5) : null;
    const added = (norm.length === 12 && parseInt(norm.slice(2,4),10) > 31)
      ? norm.slice(0,4) + "9" + norm.slice(4) : null;
    const { sha256Hex } = await import("../crypto.js");
    const hashes = [sha256Hex(norm), stripped && sha256Hex(stripped), added && sha256Hex(added)].filter(Boolean);

    const assoc = await db.associate.findFirst({
      where: {
        welcomePhoneHash: { in: hashes },
        welcomePending:   { not: null },
        welcomeSentAt:    null,
        status:           "APPROVED"   // SEGURANÇA: nunca envia se denied/inactive
      },
      select: { id:true, welcomePending:true, user: { select: { email: true, active: true } } }
    });
    if (!assoc) return;
    // Segurança adicional: user precisa estar ativo
    if (!assoc.user?.active){
      logger.warn({ associateId: assoc.id }, "welcome_pending · user inativo · não envia");
      return;
    }
    const r = await vaiSendSafe({ text: assoc.welcomePending, chatId: vaiConvId, contactId: vaiContactId });
    if (r.ok){
      await db.associate.update({
        where: { id: assoc.id },
        data: { welcomeSentAt: new Date(), welcomePending: null, welcomePhoneHash: null }
      });
      logger.info({ associateId: assoc.id, chatId: r.chatId, messageId: r.data?.id }, "✅ welcome_pending · despachado no inbound");
    } else {
      logger.warn({ associateId: assoc.id, err: r.error, status: r.status }, "welcome_pending · VAI recusou · mantém na fila");
    }
  } catch (e){
    logger.warn({ err: e.message }, "welcome_pending · erro ao tentar despachar");
  }
}

// Checa se um phoneNorm (ja normalizado por normalizePhone) pertence a algum
// Associate ativo. Retorna o Associate (subset) se bate, senao null. Usado pelo
// webhook vai-flow pra IMPEDIR a criacao de Lead/Conversation a partir de
// inbound de corretor aprovado (resposta ao WhatsApp de boas-vindas etc).
//
// Compara com phone E whatsapp do Associate, normalizando ambos antes (Associate
// guarda string crua). Trata variantes BR com/sem 9-prefix do celular.
async function findAssociateByPhone(phoneNorm){
  if (!phoneNorm) return null;
  const candidates = new Set([phoneNorm]);
  if (phoneNorm.length === 13 && parseInt(phoneNorm.slice(2,4),10) > 31 && phoneNorm[4] === "9"){
    candidates.add(phoneNorm.slice(0,4) + phoneNorm.slice(5));
  } else if (phoneNorm.length === 12 && parseInt(phoneNorm.slice(2,4),10) > 31){
    candidates.add(phoneNorm.slice(0,4) + "9" + phoneNorm.slice(4));
  }
  // findMany porque Associate.phone/whatsapp guardam string bruta · comparar
  // exige normalizar client-side. Filtra por user.active pra ignorar desativados.
  const associates = await db.associate.findMany({
    where: { user: { active: true } },
    select: { id: true, userId: true, phone: true, whatsapp: true, user: { select: { email: true, name: true } } }
  });
  for (const a of associates){
    const p = a.phone    ? normalizePhone(String(a.phone))    : null;
    const w = a.whatsapp ? normalizePhone(String(a.whatsapp)) : null;
    if (p && candidates.has(p)) return a;
    if (w && candidates.has(w)) return a;
  }
  return null;
}

const r = Router();

// Raw body parser — 1 MB limite
r.use(raw({ type: "*/*", limit: "1mb" }));

// ---------- POST /api/webhooks/leads -----------------------------------------
r.post("/leads", async (req, res) => {
  const secret = process.env.WEBHOOK_LEADS_SECRET;
  if (!secret) return res.status(503).json({ error: "webhook_disabled" });

  const raw = req.body.toString("utf8");
  const signature = req.headers["x-webhook-signature"] || req.headers["x-hub-signature-256"] || "";
  if (!verifyHmac(raw, signature, secret)){
    await db.webhookInboundLog.create({
      data: { source: "leads_external", endpoint: "/api/webhooks/leads", rawPayload: raw ? JSON.parse(raw || "{}") : {}, signature: String(signature), ipAddress: req.ip, status: "REJECTED", errorMessage: "invalid_hmac" }
    });
    return res.status(401).json({ error: "invalid_signature" });
  }

  let payload;
  try { payload = JSON.parse(raw); } catch { return res.status(400).json({ error: "invalid_json" }); }

  const idempotencyKey = sha256Hex(`${payload.source || "unknown"}::${payload.external_id || payload.phone || ""}`);
  // Dedup
  const dup = await db.webhookInboundLog.findUnique({ where: { idempotencyKey } });
  if (dup){
    return res.status(200).json({ accepted: true, deduplicated: true, leadId: dup.resultingLeadId });
  }

  const log = await db.webhookInboundLog.create({
    data: {
      source: payload.source || "unknown",
      endpoint: "/api/webhooks/leads",
      rawPayload: payload,
      signature: String(signature),
      ipAddress: req.ip,
      idempotencyKey,
      status: "PROCESSING"
    }
  });

  try {
    const phoneNorm = normalizePhone(payload.phone);
    if (!payload.name || phoneNorm.length < 10) throw new Error("missing name/phone");
    const phoneHash = sha256Hex(phoneNorm);
    const existing = await db.lead.findUnique({ where: { phoneHash }, select: { id: true } });
    if (existing){
      await db.webhookInboundLog.update({ where: { id: log.id }, data: { status: "DEDUPLICATED", resultingLeadId: existing.id } });
      return res.status(200).json({ accepted: true, deduplicated: true, leadId: existing.id });
    }

    // 2026-05-12 · campaignName ajuda admin rastrear qual ad/lista trouxe o lead.
    // Aceita: campaignName, campaign, utm_campaign · fallback null (admin preenche depois).
    const campaignName = (payload.campaignName || payload.campaign || payload.utm_campaign || "").toString().trim() || null;
    // Import de planilha (slash /add-leads) usa source="planilha" OU origin="IMPORT" · marca "Cliente Calebe"
    const isPlanilha = (payload.source === "planilha") || (payload.origin === "IMPORT") || (payload.is_import === true);

    const lead = await db.lead.create({
      data: {
        name: payload.name,
        phoneEncrypted: encrypt(phoneNorm),
        phoneHash,
        phoneMasked: maskPhone(phoneNorm),
        source: payload.source || "webhook",
        origin: isPlanilha ? "IMPORT" : "WEBHOOK",
        segment: payload.segment || "Regional",
        city: payload.city || null,
        notes: payload.notes || null,
        campaignName: isPlanilha ? (campaignName || "Cliente Calebe (lista antiga)") : campaignName
      }
    });
    await enqueueLead(lead.id);
    await db.webhookInboundLog.update({ where: { id: log.id }, data: { status: "PROCESSED", resultingLeadId: lead.id } });
    await audit({ action: "WEBHOOK_LEAD_RECEIVED", entity: `Lead:${lead.id}`, metadata: { source: lead.source } });
    // Push pra admins: lead novo entrou no funil (ainda sem dono).
    sendPushToRole("ADMIN", {
      eventKey: "lead.captured",
      kind: "lead_captured",
      title: "🆕 Lead novo no funil",
      body: `${lead.name || "Lead"} · ${lead.segment || "—"} · ${lead.source || "webhook"}`,
      url: `/?screen=adm-leads&lead=${lead.id}`,
      tag: `lead-${lead.id}`,
    }).catch(()=>{});
    res.status(201).json({ accepted: true, leadId: lead.id });
  } catch (e){
    await db.webhookInboundLog.update({ where: { id: log.id }, data: { status: "REJECTED", errorMessage: e.message } });
    res.status(422).json({ error: "processing_failed", message: e.message });
  }
});

// ---------- POST /api/webhooks/vai -------------------------------------------
r.post("/vai", async (req, res) => {
  const secret = process.env.VAI_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "vai_webhook_disabled" });

  const raw = req.body.toString("utf8");
  logger.info({
    flow: "vai_hmac_entry",
    ip: req.ip,
    bodyLen: raw.length,
    bodyPreview: raw.slice(0, 300),
    hasSig: Boolean(req.headers["x-vai-signature"] || req.headers["x-webhook-signature"])
  }, "📨 vai · ENTRY · webhook invocado (HMAC)");
  const signature = req.headers["x-vai-signature"] || req.headers["x-webhook-signature"] || "";
  if (!verifyHmac(raw, signature, secret)){
    await db.webhookInboundLog.create({
      data: { source: "vai", endpoint: "/api/webhooks/vai", rawPayload: {}, signature: String(signature), ipAddress: req.ip, status: "REJECTED", errorMessage: "invalid_hmac" }
    });
    return res.status(401).json({ error: "invalid_signature" });
  }

  let event; try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: "invalid_json" }); }
  const log = await db.webhookInboundLog.create({
    data: { source: "vai", endpoint: "/api/webhooks/vai", rawPayload: event, signature: String(signature), ipAddress: req.ip, status: "PROCESSING" }
  });

  try {
    // Roteamento por tipo de evento
    const eventType = event.event || event.type || "unknown";
    if (eventType === "message.received"){
      // Resolve conversa por MÚLTIPLOS identificadores (anti-colisão phone ↔ LID).
      // Ordem: chatId → contactId → LID → phone. O WhatsApp entrega mensagens
      // ora pelo número (@s.whatsapp.net) ora pelo LID (@lid) — ambos apontam
      // para o mesmo contato, precisamos reconhecer os dois.
      const chatId    = event.conversation_id || event.chat_id || event.chatId || null;
      const contactId = event.contact_id || event.contactId || event.contact?.id || null;
      const lidRaw    = event.contact?.channelData?.whatsapp?.lid
                     || event.contact?.channelData?.lid
                     || event.lid
                     || null;
      const phoneRaw  = event.contact?.identifier || event.contact?.phone || event.phone || null;

      logger.info({
        flow: "chat_inbound", chatId, contactId, lid: lidRaw, phone: phoneRaw,
        preview: String(event.text || event.message?.content || "").slice(0,60)
      }, "📥 INBOUND · mensagem recebida da VAI");

      let conv = null; let matchedBy = null;
      if (chatId)    { conv = await db.conversation.findFirst({ where: { vaiConvId:    chatId    } }); if (conv) matchedBy = "chatId"; }
      if (!conv && contactId) { conv = await db.conversation.findFirst({ where: { vaiContactId: contactId } }); if (conv) matchedBy = "contactId"; }
      if (!conv && lidRaw){
        const lidCore = String(lidRaw).split("@")[0]; // "34283049750568:80" de "...@lid"
        conv = await db.conversation.findFirst({ where: { vaiLid: { contains: lidCore } } });
        if (conv) matchedBy = "lid";
      }
      if (!conv && phoneRaw){
        // Tenta múltiplos formatos pra cobrir inconsistências (com/sem "+",
        // com/sem 9º dígito quando DDD>31). VAI ora guarda "+", ora não.
        const digits = String(phoneRaw).replace(/\D/g, "");
        const candidates = new Set(["+" + digits, digits]);
        if (digits.length === 13 && digits.startsWith("55")){
          const ddd = parseInt(digits.slice(2, 4), 10);
          if (ddd > 31 && digits[4] === "9"){
            const w = digits.slice(0, 4) + digits.slice(5);
            candidates.add("+" + w); candidates.add(w);
          }
        } else if (digits.length === 12 && digits.startsWith("55")){
          const ddd = parseInt(digits.slice(2, 4), 10);
          if (ddd <= 31){
            const w = digits.slice(0, 4) + "9" + digits.slice(4);
            candidates.add("+" + w); candidates.add(w);
          }
        }
        conv = await db.conversation.findFirst({ where: { vaiPhone: { in: Array.from(candidates) } } });
        if (conv) matchedBy = "phone";
      }
      if (conv) logger.info({ convId: conv.id, matchedBy }, "  ↳ conversa casada");

      if (conv){
        // Backfill identifiers se o evento trouxe novidades (ex: LID vinculado pela 1ª vez)
        const patch = {};
        if (chatId    && chatId    !== conv.vaiConvId)    patch.vaiConvId    = chatId;
        if (contactId && contactId !== conv.vaiContactId) patch.vaiContactId = contactId;
        if (lidRaw    && lidRaw    !== conv.vaiLid)       patch.vaiLid       = lidRaw;
        if (phoneRaw  && phoneRaw  !== conv.vaiPhone)     patch.vaiPhone     = phoneRaw;
        patch.lastMessageAt = new Date();
        // 2026-06-03 · inbound da VAI (legado) também abre a janela de 24h.
        // (patch só é aplicado se NÃO for activity — o early-return abaixo cobre isso)
        patch.lastInboundAt = new Date();

        const msgText = String(event.text || event.message?.content || "");
        const msgVaiId = event.message_id || event.message?.id;
        // Skip VAI activity (start/close de atendimento) · nao gravar como mensagem
        if (isVaiActivity({ type: event.message?.type, content: msgText })){
          logger.info({ convId: conv.id, msgVaiId, preview: msgText.slice(0,80) }, "  ↳ vai-webhook · activity · ignorada (nao persistida)");
          return res.status(200).json({ received: true, matched: true, skipped: "activity" });
        }
        await db.message.create({
          data: {
            conversationId: conv.id,
            direction: "inbound",
            fromRole: "lead",
            text: msgText,
            vaiMessageId: msgVaiId,
            deliveredAt: new Date()
          }
        });
        await db.conversation.update({ where: { id: conv.id }, data: patch });

        // Resolve dono da conversa para popular chat DB
        const associate = await db.associate.findUnique({
          where: { id: conv.associateId },
          select: { userId: true, user: { select: { email: true, name: true, role: true } } }
        });

        // Persiste no banco de CHAT (histórico)
        chatUpsertConversation({
          id: conv.id,
          crmUserId:    associate?.userId || null,
          crmUserEmail: associate?.user?.email || null,
          crmUserName:  associate?.user?.name || null,
          crmUserRole:  associate?.user?.role || null,
          leadId: conv.leadId,
          vaiChatId: patch.vaiConvId || conv.vaiConvId,
          vaiContactId: patch.vaiContactId || conv.vaiContactId,
          vaiLid: patch.vaiLid || conv.vaiLid,
          vaiPhone: patch.vaiPhone || conv.vaiPhone
        });
        chatInsertMessage({
          conversationId: conv.id,
          direction: "inbound",
          fromRole: "lead",
          content: msgText,
          contentType: event.message?.type || "text",
          fileUrl: event.message?.fileUrl || null,
          vaiMessageId: msgVaiId,
          metadata: event,
          deliveredAt: new Date()
        });

        // PUSH real-time · notifica dono da conversa + admins
        const ownerIds = associate?.userId ? [associate.userId] : [];
        const delivered = sseToMany(ownerIds, "message.inbound", {
          conversationId: conv.id,
          leadId: conv.leadId,
          text: msgText,
          contentType: event.message?.type || "text",
          fileUrl: event.message?.fileUrl || null,
          vaiMessageId: msgVaiId,
          at: new Date().toISOString()
        });
        logger.info({ convId: conv.id, ownerId: ownerIds[0], delivered, preview: msgText.slice(0,60) },
          "  ↳ SSE inbound entregue aos clientes conectados");
        // Web Push · lead respondeu · isolado, não bloqueia
        if (associate?.userId){
          const previewText = (msgText || "").slice(0, 80);
          sendPushToUser(associate.userId, {
            eventKey: "lead.replied",
            kind: "lead_replied",
            title: "🟢 Lead respondeu",
            body: previewText || "Nova mensagem na conversa",
            url: `/?screen=cors-leads&lead=${conv.leadId}`,
            tag: `conv-${conv.id}`,
            requireInteraction: false
          }).catch((e) => logger.warn({ err: e.message, userId: associate.userId, convId: conv.id }, "push lead_replied (vai) · falha não-fatal"));
        }
      } else {
        logger.info({ chatId, contactId, lidRaw, phoneRaw }, "vai event · nenhuma conversa casou · log preservado");
      }
    }
    await db.webhookInboundLog.update({ where: { id: log.id }, data: { status: "PROCESSED" } });
    res.status(200).json({ ok: true });
  } catch (e){
    await db.webhookInboundLog.update({ where: { id: log.id }, data: { status: "REJECTED", errorMessage: e.message } });
    res.status(422).json({ error: "processing_failed" });
  }
});

// ---------- POST /api/webhooks/vai-flow (+ aliases curtos) -------------------
// Endpoint para o nó "Requisição API" do Flow da VAI CRM.
// Diferente de /vai (HMAC), usa secret simples em header X-Flow-Secret ou ?secret=.
// Payload esperado (campos comuns que o Flow envia — tudo opcional):
//   { chatId, contactId, channelId, message, from, fromName, lid, messageId, type }
// Extrai identificadores, casa conversa (mesma lógica phone↔LID), grava e faz push.
//
// 2026-05-06 · ALIASES CURTOS (limite de 50 chars no campo de URL do painel VAI):
//   path /x      = alias de /vai-flow (combina com mount /api/wf em server.js → /api/wf/x)
//   query ?s=    = alias de ?secret= (3 chars vs 9)
//   env VAI_FLOW_SECRET_SHORT  = secret curto (~12-14 chars) p/ caber na URL
// Backwards compat: rota /vai-flow + query ?secret= + env VAI_FLOW_SECRET continuam OK.
r.post(["/vai-flow", "/x"], async (req, res) => {
  const tStart = Date.now();
  const raw = req.body.toString("utf8");
  // ENTRY LOG · prova que webhook foi invocado (mesmo que rejeite por secret/json)
  // Sem isso, fica impossível distinguir "Flow não chamou" de "Flow chamou e rejeitamos".
  logger.info({
    flow: "vai_flow_entry",
    ip: req.ip,
    path: req.originalUrl?.split("?")[0] || req.path,
    contentType: req.headers["content-type"],
    bodyLen: raw.length,
    bodyPreview: raw.slice(0, 300),
    hasSecret: Boolean(req.headers["x-flow-secret"] || req.query.secret || req.query.s),
    ua: req.headers["user-agent"]
  }, "📨 vai-flow · ENTRY · webhook invocado");

  const dbSecret       = getVaiFlowSecret() || "";
  const envSecret      = process.env.VAI_FLOW_SECRET || "";
  const envSecretShort = process.env.VAI_FLOW_SECRET_SHORT || "";
  // Aceita header X-Flow-Secret · query ?secret= (longo) · query ?s= (curto)
  const receivedSecret = req.headers["x-flow-secret"] || req.query.secret || req.query.s || "";
  const mask = (s) => !s ? "(vazio)" : `${String(s).slice(0,6)}…${String(s).slice(-4)} (len=${String(s).length})`;

  const anyConfigured  = Boolean(dbSecret || envSecret || envSecretShort);
  const matchDb        = dbSecret       && receivedSecret === dbSecret;
  const matchEnv       = envSecret      && receivedSecret === envSecret;
  const matchEnvShort  = envSecretShort && receivedSecret === envSecretShort;

  if (anyConfigured && !matchDb && !matchEnv && !matchEnvShort){
    await db.webhookInboundLog.create({
      data: { source: "vai_flow", endpoint: "/api/webhooks/vai-flow", rawPayload: raw ? (()=>{try{return JSON.parse(raw);}catch{return{_raw:raw.slice(0,500)};}})() : {}, signature: String(receivedSecret).slice(0,40), ipAddress: req.ip, status: "REJECTED", errorMessage: "invalid_secret" }
    });
    logger.warn({ ip: req.ip, received: mask(receivedSecret), db: mask(dbSecret), env: mask(envSecret) }, "📥 vai-flow REJECTED · secret inválido");
    return res.status(401).json({ error: "invalid_secret" });
  }

  let payload;
  try { payload = JSON.parse(raw); }
  catch { return res.status(400).json({ error: "invalid_json" }); }

  // === Guard defensivo: ignora mensagens OUTBOUND (que NÓS enviamos pra VAI) ===
  // Sem isso, Trigger catch-all configurado no painel da VAI poderia disparar em
  // qualquer msg do chat — inclusive nas que o corretor enviou — e gravar como
  // inbound, corrompendo o histórico. fromMe é o sinal canônico em
  // implementações WhatsApp Business; checamos várias grafias por tolerância.
  const isOutboundMsg = Boolean(
    payload.fromMe === true ||
    payload.message?.fromMe === true ||
    payload.direction === "outbound" ||
    payload.direction === "sent" ||
    payload.message?.direction === "outbound" ||
    payload.message?.direction === "sent" ||
    payload.outbound === true
  );
  if (isOutboundMsg){
    logger.info({
      chatId: payload.chatId || payload.chat_id || payload.conversationId || null,
      msgId: payload.messageId || payload.message_id || payload.message?.id || null
    }, "  ↳ vai-flow · OUTBOUND (fromMe) · ignorado · não persistido como inbound");
    try {
      await db.webhookInboundLog.create({
        data: { source: "vai_flow", endpoint: "/api/webhooks/vai-flow", rawPayload: payload, signature: "-", ipAddress: req.ip, status: "PROCESSED", errorMessage: "outbound_skipped" }
      });
    } catch {}
    return res.status(200).json({ received: true, skipped: "outbound" });
  }

  // Extração tolerante · aceita variações de nomenclatura
  // 2026-05-06 · novo shape "Webhook de Saida" da VAI: nested em chat/contact/message,
  // com LID em message.sender e metadata em message.metadata.{mimetype,filename}
  const chatId    = payload.chatId || payload.chat_id || payload.conversationId || payload.conversation_id || payload.chat?.id || null;
  const contactId = payload.contactId || payload.contact_id || payload.contact?.id || null;
  const channelId = payload.channelId || payload.channel_id || null;
  // Texto: tenta vários nomes diferentes (varia entre Flows da VAI)
  // 2026-05-06 · BUG fix: no novo shape "Webhook de Saida", payload.message é OBJETO
  // ({id,text,type,fromMe,...}) — antes do fix, String(objeto) gravava "[object Object]"
  // como texto da mensagem. A nova ordem checa os campos nested PRIMEIRO, e só
  // aceita payload.message direto se for STRING (preservando o shape Flow legado).
  let msgText = String(
    payload.message?.text ||
    payload.message?.content ||
    payload.message?.body ||
    payload.text ||
    payload.content ||
    payload.body ||
    (typeof payload.message === "string" ? payload.message : "") ||
    ""
  );
  const from      = payload.from || payload.fromNumber || payload.phone || payload.contact?.phone || payload.contact?.identifier || null;
  const fromName  = payload.fromName || payload.name || payload.contact?.name || payload.chat?.name || null;
  // LID: novo shape coloca em message.sender (formato "...@lid"); preserva os antigos
  const lidRaw    = payload.lid || payload.contact?.lid || payload.contact?.channelData?.whatsapp?.lid
                 || (typeof payload.message?.sender === "string" && payload.message.sender.includes("@lid") ? payload.message.sender : null)
                 || null;
  const msgVaiId  = payload.messageId || payload.message_id || payload.message?.id || null;
  const msgType   = payload.type || payload.message?.type || "text";
  const fileUrl   = payload.fileUrl || payload.file_url || payload.message?.fileUrl || null;
  // Mimetype/filename: novo shape em message.metadata.{mimetype,filename} (lowercase)
  const mimeType  = payload.mimeType || payload.mime_type || payload.message?.mimeType || payload.message?.metadata?.mimetype || null;
  const fileName  = payload.fileName || payload.file_name || payload.message?.fileName || payload.message?.metadata?.filename || null;

  const log = await db.webhookInboundLog.create({
    data: { source: "vai_flow", endpoint: "/api/webhooks/vai-flow", rawPayload: payload, signature: "-", ipAddress: req.ip, status: "PROCESSING" }
  });

  logger.info({
    flow: "vai_flow_inbound", event: payload.event || null, chatId, contactId, channelId, from, fromName, lid: lidRaw,
    preview: String(msgText).slice(0,60),
    textFromPayload: !!msgText,
    msgType, hasFileUrl: !!fileUrl, hasMimeType: !!mimeType, hasFileName: !!fileName
  }, "📥 FLOW · mensagem recebida do Flow da VAI");

  // Fallback: busca msg real na VAI quando campos vieram incompletos do Flow
  // (bug conhecido: Flow não resolve {{message.content}} nem {{message.fileUrl}} em mídias)
  let fileUrlFinal = fileUrl;
  let mimeTypeFinal = mimeType;
  let typeFinal = msgType;
  if ((!msgText.trim() || (msgType !== "text" && !fileUrlFinal)) && chatId && msgVaiId){
    const real = await vaiFetchMessageContentSafe({ chatId, messageId: msgVaiId });
    if (real){
      if (real.content && !msgText.trim()) msgText = String(real.content);
      if (real.fileUrl  && !fileUrlFinal)   fileUrlFinal  = real.fileUrl;
      if (real.mimeType && !mimeTypeFinal)  mimeTypeFinal = real.mimeType;
      if (real.type)                        typeFinal     = real.type;
      logger.info({ chatId, messageId: msgVaiId, type: typeFinal, hasFile: !!fileUrlFinal, preview: msgText.slice(0,60) },
        "  ↳ 🔄 mensagem completa recuperada via fallback API VAI");
    }
  }

  try {
    // Dedup por vaiMessageId se fornecido
    if (msgVaiId){
      const existing = await db.message.findFirst({ where: { vaiMessageId: String(msgVaiId) } });
      if (existing){
        await db.webhookInboundLog.update({ where: { id: log.id }, data: { status: "DEDUPLICATED" } });
        return res.status(200).json({ received: true, deduplicated: true, conversationId: existing.conversationId });
      }
    }

    // === Dedup secundário · só ativa quando msgVaiId NÃO veio no payload ===
    // Alguns disparos (ex: Trigger catch-all do painel da VAI) podem chegar sem
    // {{message.id}}. Nesse caso, identificamos duplicata por janela curta:
    // mesmo chatId + mesmo texto nos últimos 5s = quase certamente o mesmo evento
    // chegando duas vezes (Trigger + Flow chat_pending coexistindo, retry da VAI, etc).
    if (!msgVaiId && chatId && msgText && msgText.trim().length > 0){
      const recent = await db.message.findFirst({
        where: {
          conversation: { vaiConvId: chatId },
          direction: "inbound",
          text: msgText.trim(),
          createdAt: { gte: new Date(Date.now() - 5000) }
        },
        select: { id: true, conversationId: true }
      });
      if (recent){
        await db.webhookInboundLog.update({ where: { id: log.id }, data: { status: "DEDUPLICATED", errorMessage: "secondary_dedup_chat_content_window" } });
        logger.info({ convId: recent.conversationId, chatId, preview: msgText.slice(0,40) },
          "  ↳ vai-flow · dedup secundário (chatId+texto+5s) · sem msgVaiId");
        return res.status(200).json({ received: true, deduplicated: true, conversationId: recent.conversationId, dedupBy: "chat_content_window" });
      }
    }

    // Casamento phone↔LID em cascata · loga cada tentativa pra facilitar diagnose
    let conv = null; let matchedBy = null;
    const matchTrace = [];
    if (chatId){
      conv = await db.conversation.findFirst({ where: { vaiConvId: chatId } });
      matchTrace.push({ step: "chatId", val: chatId, hit: !!conv });
      if (conv) matchedBy = "chatId";
    }
    if (!conv && contactId){
      conv = await db.conversation.findFirst({ where: { vaiContactId: contactId } });
      matchTrace.push({ step: "contactId", val: contactId, hit: !!conv });
      if (conv) matchedBy = "contactId";
    }
    if (!conv && lidRaw){
      const lidCore = String(lidRaw).split("@")[0];
      conv = await db.conversation.findFirst({ where: { vaiLid: { contains: lidCore } } });
      matchTrace.push({ step: "lid", val: lidCore, hit: !!conv });
      if (conv) matchedBy = "lid";
    }
    if (!conv && from){
      // Cobre variações com/sem "+" e com/sem 9º dígito (DDD>31)
      const digits = String(from).replace(/\D/g, "");
      const candidates = new Set(["+" + digits, digits]);
      if (digits.length === 13 && digits.startsWith("55")){
        const ddd = parseInt(digits.slice(2, 4), 10);
        if (ddd > 31 && digits[4] === "9"){
          const w = digits.slice(0, 4) + digits.slice(5);
          candidates.add("+" + w); candidates.add(w);
        }
      } else if (digits.length === 12 && digits.startsWith("55")){
        const ddd = parseInt(digits.slice(2, 4), 10);
        if (ddd <= 31){
          const w = digits.slice(0, 4) + "9" + digits.slice(4);
          candidates.add("+" + w); candidates.add(w);
        }
      }
      const candArr = Array.from(candidates);
      conv = await db.conversation.findFirst({ where: { vaiPhone: { in: candArr } } });
      matchTrace.push({ step: "phone", val: candArr, hit: !!conv });
      if (conv) matchedBy = "phone";
    }
    logger.info({ matchTrace, matchedBy }, "  ↳ match cascade");

    if (!conv){
      // Tenta auto-criar Lead para inbound orgânico (1º contato via WhatsApp)
      if (from){
        const phoneNorm = normalizePhone(from);
        if (phoneNorm && phoneNorm.length >= 10){
          // GUARD: ignora inbound de CORRETOR APROVADO (telefone bate com algum
          // Associate ativo). Evita que respostas ao WhatsApp de boas-vindas /
          // suporte direto criem Leads e Conversations indevidas no chat.
          // Apenas leads de importacao/webhook/orgânicos não-corretor seguem fluxo.
          const matchedAssoc = await findAssociateByPhone(phoneNorm);
          if (matchedAssoc){
            logger.info({
              associateId: matchedAssoc.id,
              email: matchedAssoc.user?.email,
              name: matchedAssoc.user?.name,
              phone: phoneNorm,
              chatId,
              contactId
            }, "  ↳ vai-flow · inbound de CORRETOR APROVADO · ignorado · NAO cria Lead/Conv");
            // Ainda pode haver welcome pendente · tenta despachar
            tryDispatchPendingWelcome({ phone: from, vaiConvId: chatId, vaiContactId: contactId }).catch(()=>{});
            await db.webhookInboundLog.update({
              where: { id: log.id },
              data: { status: "PROCESSED", errorMessage: "ignored_associate_phone" }
            });
            return res.status(200).json({ received: true, matched: false, ignored: "associate_phone", associateId: matchedAssoc.id });
          }
          const phoneHash = sha256Hex(phoneNorm);
          const lead = await db.lead.findUnique({ where: { phoneHash }, select: { id: true, assignedToId: true, name: true } });
          const vaiPhoneE164 = String(from).startsWith("+") ? from : "+" + phoneNorm;
          const vaiIdsPatch = {
            vaiContactId:  contactId || undefined,
            vaiLastChatId: chatId    || undefined,
            vaiLid:        lidRaw    || undefined,
            vaiPhone:      vaiPhoneE164
          };
          if (!lead){
            // GUARD: phone DESCONHECIDO · NAO casa com nenhum Lead pre-cadastrado.
            // Lead só pode entrar no sistema via /api/imports (CSV) ou via
            // /api/webhooks/leads (formulario de trafego pago). WhatsApp organico
            // (1º contato sem lead previo) NAO cria mais Lead+Conv automaticamente.
            // Anteriormente esse path criava lead com source="whatsapp_inbound" ·
            // gerava conversas indesejadas no chat.
            logger.info({
              phone: phoneNorm, chatId, contactId, fromName: fromName || from
            }, "  ↳ vai-flow · inbound de phone DESCONHECIDO · ignorado · sem Lead pré-cadastrado");
            await db.webhookInboundLog.update({
              where: { id: log.id },
              data: { status: "PROCESSED", errorMessage: "ignored_unknown_phone" }
            });
            return res.status(200).json({ received: true, matched: false, ignored: "unknown_phone" });
          }
          // Lead existe (criado por importacao, /api/webhooks/leads OU /api/leads/manual)
          // · atualiza VAI IDs no Lead
          await db.lead.update({ where: { id: lead.id }, data: vaiIdsPatch });

          // === Recuperação de Conv para LEAD COM CONV PRÉ-EXISTENTE ===
          // Cobre o caso do corretor que cria lead manualmente via /api/leads/manual:
          // a Conversation eh criada imediatamente (manualFree:true), mas o
          // vaiOnboardLeadSafe roda async · se o lead responde antes do onboard
          // completar OU se o onboard falhou, a Conv fica sem vaiConvId/vaiContactId
          // e o cascade de match acima falha. Aqui recuperamos a Conv por
          // Lead.phoneHash → Conversation.leadId, fazemos backfill dos IDs VAI e
          // caimos no fluxo normal de gravar inbound (linha abaixo). Sem isso,
          // a primeira resposta do lead manual ficava travada em "pending-" e
          // nao aparecia no chat do corretor.
          const existingConv = await db.conversation.findUnique({ where: { leadId: lead.id } });
          if (existingConv){
            const convPatch = {};
            if (chatId    && chatId    !== existingConv.vaiConvId)    convPatch.vaiConvId    = chatId;
            if (contactId && contactId !== existingConv.vaiContactId) convPatch.vaiContactId = contactId;
            if (lidRaw    && lidRaw    !== existingConv.vaiLid)       convPatch.vaiLid       = lidRaw;
            if (vaiPhoneE164 !== existingConv.vaiPhone)               convPatch.vaiPhone     = vaiPhoneE164;
            if (Object.keys(convPatch).length){
              await db.conversation.update({ where: { id: existingConv.id }, data: convPatch });
              Object.assign(existingConv, convPatch);
            }
            conv      = existingConv;
            matchedBy = "leadPhoneHash";
            logger.info({
              convId: conv.id, leadId: lead.id,
              manualFree: existingConv.manualFree,
              backfilled: Object.keys(convPatch),
              origin: "lead_phone_hash_lookup"
            }, "  ↳ vai-flow · conv recuperada via Lead.phoneHash · backfill IDs VAI · cai no fluxo normal");
            // NAO retorna · sai do bloco "if (!conv)" caindo no fluxo de gravar inbound
          }
          else {
            logger.info({ leadId: lead.id, vaiContactId: contactId, vaiChatId: chatId }, "  ↳ lead existente · VAI IDs atualizados · sem conv ainda");

            // Log da mensagem inbound no chat DB mesmo sem Conversation formal
            // (será "reconciliada" quando a distribuição criar a conv)
            chatUpsertConversation({
              id: "pending-" + lead.id,  // prefixo indicando aguardando atribuição
              leadId: lead.id,
              leadName: lead.name,
              leadPhone: phoneNorm,
              leadPhoneMask: maskPhone(phoneNorm),
              vaiChatId: chatId,
              vaiContactId: contactId,
              vaiLid: lidRaw,
              vaiPhone: vaiPhoneE164
            });
            chatInsertMessage({
              conversationId: "pending-" + lead.id,
              direction: "inbound",
              fromRole: "lead",
              content: msgText || "(sem texto)",
              contentType: msgType,
              vaiMessageId: msgVaiId ? String(msgVaiId) : null,
              metadata: payload,
              deliveredAt: new Date()
            });
            // Notifica admins em tempo real (ainda sem dono atribuído)
            sseToMany([], "lead.new_inbound", {
              leadId: lead.id,
              leadName: lead.name,
              phoneMasked: maskPhone(phoneNorm),
              firstMessage: msgText || "(mídia sem texto)",
              from: fromName || from,
              at: new Date().toISOString(),
              wasCreated: false
            });
            // Tenta despachar mensagem de boas-vindas pendente (corretor aprovado sem binding)
            tryDispatchPendingWelcome({ phone: from, vaiConvId: chatId, vaiContactId: contactId }).catch(()=>{});
            await db.webhookInboundLog.update({
              where: { id: log.id },
              data: { status: "PROCESSED", resultingLeadId: lead.id, errorMessage: "lead_exists_awaiting_distribution" }
            });
            return res.status(200).json({ received: true, matched: false, leadId: lead.id, leadCreated: false });
          }
        }
      }
      // Se chegou aqui sem conv setada (phone invalido OU sem from), retorna no_match
      if (!conv){
        logger.warn({ chatId, contactId, lid: lidRaw, from, payloadKeys: Object.keys(payload || {}) }, "  ↳ vai-flow · nenhuma conversa casou · sem phone válido");
        await db.webhookInboundLog.update({ where: { id: log.id }, data: { status: "PROCESSED", errorMessage: "no_match_no_phone" } });
        return res.status(200).json({ received: true, matched: false });
      }
    }
    logger.info({ convId: conv.id, matchedBy, latencyMs: Date.now() - tStart }, "  ↳ conversa casada · gravando inbound");

    // Skip VAI activity (start/close de atendimento) · nao gravar como mensagem
    if (isVaiActivity({ type: typeFinal, content: msgText })){
      logger.info({ convId: conv.id, msgVaiId, preview: String(msgText).slice(0,80) }, "  ↳ vai-flow · activity · ignorada (nao persistida)");
      return res.status(200).json({ received: true, matched: true, skipped: "activity" });
    }

    // Backfill de identificadores
    const patch = {};
    if (chatId    && chatId    !== conv.vaiConvId)    patch.vaiConvId    = chatId;
    if (contactId && contactId !== conv.vaiContactId) patch.vaiContactId = contactId;
    if (lidRaw    && lidRaw    !== conv.vaiLid)       patch.vaiLid       = lidRaw;
    if (from){
      const p = String(from).startsWith("+") ? from : "+" + String(from).replace(/\D/g, "");
      if (p !== conv.vaiPhone) patch.vaiPhone = p;
    }
    patch.lastMessageAt = new Date();
    // 2026-06-03 · inbound da VAI (vai-flow) também abre a janela de 24h.
    patch.lastInboundAt = new Date();

    // Persiste mensagem (db principal) · inclui mídia se for o caso
    await db.message.create({
      data: {
        conversationId: conv.id,
        direction: "inbound",
        fromRole: "lead",
        text: String(msgText),
        contentType: typeFinal,
        ...(fileUrlFinal  ? { fileUrl: fileUrlFinal }   : {}),
        ...(mimeTypeFinal ? { mimeType: mimeTypeFinal } : {}),
        ...(fileName      ? { fileName }                : {}),
        vaiMessageId: msgVaiId ? String(msgVaiId) : null,
        deliveredAt: new Date()
      }
    });
    await db.conversation.update({ where: { id: conv.id }, data: patch });

    // Resolve dono da conversa
    const associate = await db.associate.findUnique({
      where: { id: conv.associateId },
      select: { userId: true, user: { select: { email: true, name: true, role: true } } }
    });

    // Persiste no banco de chat (histórico)
    chatUpsertConversation({
      id: conv.id,
      crmUserId:    associate?.userId || null,
      crmUserEmail: associate?.user?.email || null,
      crmUserName:  associate?.user?.name || null,
      crmUserRole:  associate?.user?.role || null,
      leadId: conv.leadId,
      vaiChatId: patch.vaiConvId || conv.vaiConvId,
      vaiContactId: patch.vaiContactId || conv.vaiContactId,
      vaiLid: patch.vaiLid || conv.vaiLid,
      vaiPhone: patch.vaiPhone || conv.vaiPhone
    });
    chatInsertMessage({
      conversationId: conv.id,
      direction: "inbound",
      fromRole: "lead",
      content: String(msgText),
      contentType: typeFinal,
      fileUrl: fileUrlFinal || null,
      vaiMessageId: msgVaiId ? String(msgVaiId) : null,
      metadata: payload,
      deliveredAt: new Date()
    });

    // PUSH real-time
    const ownerIds = associate?.userId ? [associate.userId] : [];
    const delivered = sseToMany(ownerIds, "message.inbound", {
      conversationId: conv.id,
      leadId: conv.leadId,
      text: String(msgText),
      contentType: typeFinal,
      fileUrl: fileUrlFinal || null,
      mimeType: mimeTypeFinal || null,
      vaiMessageId: msgVaiId,
      from: fromName || from,
      at: new Date().toISOString(),
      source: "vai_flow"
    });
    logger.info({ convId: conv.id, ownerId: ownerIds[0], delivered, preview: String(msgText).slice(0,60) },
      "  ↳ SSE inbound (flow) entregue");
    // Web Push · lead respondeu (vai-flow) · isolado, não bloqueia
    if (associate?.userId){
      const previewText = String(msgText || "").slice(0, 80);
      sendPushToUser(associate.userId, {
        eventKey: "lead.replied",
        kind: "lead_replied",
        title: "🟢 Lead respondeu",
        body: previewText || "Nova mensagem na conversa",
        url: `/?screen=cors-leads&lead=${conv.leadId}`,
        tag: `conv-${conv.id}`,
        requireInteraction: false
      }).catch((e) => logger.warn({ err: e.message, userId: associate.userId, convId: conv.id }, "push lead_replied (vai-flow) · falha não-fatal"));
    }

    // Tenta despachar mensagem de boas-vindas pendente (caso inbound seja de um corretor aprovado)
    tryDispatchPendingWelcome({
      phone: from || conv.vaiPhone,
      vaiConvId: patch.vaiConvId || conv.vaiConvId,
      vaiContactId: patch.vaiContactId || conv.vaiContactId
    }).catch(()=>{});

    await db.webhookInboundLog.update({ where: { id: log.id }, data: { status: "PROCESSED" } });
    res.status(200).json({
      received: true,
      matched: true,
      conversationId: conv.id,
      matchedBy,
      delivered
    });
  } catch (e){
    logger.error({ err: e.message }, "vai-flow processing failed");
    await db.webhookInboundLog.update({ where: { id: log.id }, data: { status: "REJECTED", errorMessage: e.message } });
    res.status(200).json({ received: true, error: e.message }); // 200 pra VAI não ficar retentando em erro nosso
  }
});

export default r;
