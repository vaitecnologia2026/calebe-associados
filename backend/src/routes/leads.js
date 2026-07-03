// =============================================================================
// /api/leads · listagem, consulta, lead manual, liberar phone, assign, status
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { phoneAllowed, canViewPhone } from "../services/leadPhoneAccess.js";
import { encrypt, decrypt, sha256Hex, normalizePhone, maskPhone, phoneHashVariants } from "../crypto.js";
import { enqueueLead } from "../services/distributionEngine.js";
import { vaiOnboardLeadSafe, vaiCloseChat } from "../services/vaiClient.js";
import { logger } from "../utils/logger.js";
import { chatUpsertConversation } from "../chatDb.js";
import { sseToUser, sseToAdmins } from "../services/sseHub.js";
import { bootstrapConversationHistory } from "../services/chatHistoryBootstrap.js";
import { audit } from "../utils/audit.js";
import { sendPushToUser } from "../services/push.js";
import { notifyAssociateLeadAssigned } from "../services/associateNotifier.js";

const r = Router();

// GET /api/leads (admin) · paginado, filtrável
r.get("/", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const take = Math.min(Number(req.query.limit) || 50, 50000);
    const skip = Number(req.query.offset) || 0;
    const where = {
      discardedAt: null,
      ...(req.query.status  ? { status: req.query.status } : {}),
      ...(req.query.origin  ? { origin: req.query.origin } : {}),
      ...(req.query.segment ? { segment: req.query.segment } : {}),
      ...(req.query.assignedToId ? { assignedToId: req.query.assignedToId } : {}),
      ...(req.query.q ? { OR: [
        { name: { contains: String(req.query.q), mode: "insensitive" } },
        { phoneMasked: { contains: String(req.query.q) } }
      ] } : {})
    };
    const [data, total] = await Promise.all([
      db.lead.findMany({
        where, take, skip, orderBy: { createdAt: "desc" },
        select: {
          id:true, name:true, phoneMasked:true, phoneEncrypted:true, source:true, origin:true, segment:true, city:true,
          status:true, assignedToId:true, assignedAt:true, firstContactAt:true, redistributionCount:true,
          createdAt:true,
          assignedTo: { select: { id:true, user: { select: { name:true } } } }
        }
      }),
      db.lead.count({ where })
    ]);
    // Admin vê telefone real (descriptografado). phoneEncrypted é removido do payload.
    const out = data.map(l => {
      const { phoneEncrypted, ...rest } = l;
      try { return { ...rest, phone: decrypt(phoneEncrypted) }; }
      catch { return rest; }
    });
    res.json({ data: out, total, limit: take, offset: skip });
  } catch (e){ next(e); }
});

// GET /api/leads/my · associado vê só os seus · NUNCA telefone real
r.get("/my", requireAuth, requireRole("ASSOCIATE"), async (req, res, next) => {
  try {
    const associate = await db.associate.findUnique({ where: { userId: req.user.id } });
    if (!associate) return res.status(404).json({ error: "not_an_associate" });
    // ?status=LOST ou ?status=CLOSED para ver leads nessa situação
    const statusFilter = req.query.status;
    const allowedStatus = ["NEW","QUALIFYING","NEGOTIATING","CLOSING","CLOSED","LOST"];
    const whereStatus = (statusFilter && allowedStatus.includes(statusFilter.toUpperCase()))
      ? { status: statusFilter.toUpperCase() }
      : { status: { notIn: ["CLOSED","LOST"] } };
    const data = await db.lead.findMany({
      where: { assignedToId: associate.id, ...whereStatus },
      orderBy: { assignedAt: "desc" },
      select: {
        id:true, name:true, phoneMasked:true, source:true, origin:true, segment:true, city:true,
        status:true, firstContactAt:true, assignedAt:true, linkedPropertyId:true
      }
    });
    // Regra 2026-06-29: corretor nunca vê telefone completo (só canViewPhone=true libera)
    let final = data;
    if (canViewPhone(req.user)) {
      const allEnc = await db.lead.findMany({ where: { id: { in: data.map(l => l.id) } }, select: { id: true, phoneEncrypted: true } });
      const phoneMap = Object.fromEntries(allEnc.map(l => { try { return [l.id, decrypt(l.phoneEncrypted)]; } catch { return [l.id, null]; } }));
      final = data.map(l => phoneMap[l.id] ? { ...l, phone: phoneMap[l.id] } : l);
    }
    // Inclui contagem de LOST apenas quando mostrando ativos (para o botão "Ver perdidos")
    let lostCount = 0;
    if (!statusFilter || statusFilter.toUpperCase() !== "LOST") {
      lostCount = await db.lead.count({ where: { assignedToId: associate.id, status: "LOST" } });
    }
    res.json({ data: final, total: final.length, lostCount });
  } catch (e){ next(e); }
});

// 2026-05-12 · GET /api/leads/my/chat-report
// Relatorio com KPIs do chat por lead pro corretor logado:
//   - inboundCount  · qtd mensagens recebidas (lead -> corretor)
//   - outboundCount · qtd mensagens enviadas (corretor -> lead)
//   - lastInboundAt / lastOutboundAt · timestamps das ultimas msgs
//   - responded · boolean (true se inboundCount > 0)
//   - status · "Respondeu" | "Em conversa" | "Aguardando resposta" | "Sem contato"
r.get("/my/chat-report", requireAuth, requireRole("ASSOCIATE"), async (req, res, next) => {
  try {
    const associate = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
    if (!associate) return res.status(404).json({ error: "not_an_associate" });

    const leads = await db.lead.findMany({
      where: { assignedToId: associate.id },
      orderBy: { assignedAt: "desc" },
      select: {
        id: true, name: true, phoneMasked: true, source: true, segment: true, city: true,
        status: true, assignedAt: true, firstContactAt: true, campaignName: true,
        conversation: {
          select: {
            id: true,
            lastMessageAt: true,
            messages: {
              select: { direction: true, createdAt: true },
              orderBy: { createdAt: "desc" }
            }
          }
        }
      }
    });

    const rows = leads.map(l => {
      const msgs = l.conversation?.messages || [];
      let inboundCount = 0, outboundCount = 0;
      let lastInboundAt = null, lastOutboundAt = null;
      for (const m of msgs){
        if (m.direction === "inbound"){
          inboundCount++;
          if (!lastInboundAt || m.createdAt > lastInboundAt) lastInboundAt = m.createdAt;
        } else if (m.direction === "outbound"){
          outboundCount++;
          if (!lastOutboundAt || m.createdAt > lastOutboundAt) lastOutboundAt = m.createdAt;
        }
      }
      const responded = inboundCount > 0;
      let chatStatus;
      if (outboundCount === 0 && inboundCount === 0)        chatStatus = "Sem contato";
      else if (outboundCount > 0 && inboundCount === 0)     chatStatus = "Aguardando resposta";
      else if (inboundCount > 0 && outboundCount === 0)     chatStatus = "Lead iniciou";
      else                                                   chatStatus = "Em conversa";
      return {
        leadId: l.id,
        name: l.name,
        phoneMasked: l.phoneMasked,
        source: l.source,
        segment: l.segment,
        city: l.city,
        campaignName: l.campaignName,
        status: l.status,
        assignedAt: l.assignedAt,
        firstContactAt: l.firstContactAt,
        lastMessageAt: l.conversation?.lastMessageAt || null,
        inboundCount,
        outboundCount,
        lastInboundAt,
        lastOutboundAt,
        responded,
        chatStatus
      };
    });

    const summary = {
      total: rows.length,
      responded: rows.filter(r => r.responded).length,
      contacted: rows.filter(r => r.outboundCount > 0).length,
      semContato: rows.filter(r => r.chatStatus === "Sem contato").length,
      aguardandoResposta: rows.filter(r => r.chatStatus === "Aguardando resposta").length,
      emConversa: rows.filter(r => r.chatStatus === "Em conversa").length
    };

    res.json({ summary, data: rows });
  } catch (e){ next(e); }
});

// 2026-05-12 · GET /api/leads/my-disputes · corretor lista disputas pendentes onde foi convidado
// IMPORTANTE: declarado ANTES de /:id pra Express não capturar "my-disputes" como id
r.get("/my-disputes", requireAuth, requireRole("ASSOCIATE"), async (req, res, next) => {
  try {
    const associate = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
    if (!associate) return res.json({ data: [] });
    const now = new Date();
    const disputes = await db.lead.findMany({
      where: {
        disputeMode: true,
        disputeExpiresAt: { gt: now }
      },
      select: { id: true, name: true, segment: true, city: true, disputeStartedAt: true, disputeExpiresAt: true, disputeCandidates: true, campaignName: true, source: true }
    });
    const filtered = disputes.filter(l => Array.isArray(l.disputeCandidates) && l.disputeCandidates.includes(associate.id));
    res.json({ data: filtered });
  } catch (e){ next(e); }
});

// GET /api/leads/:id — admin OU associado dono (ainda mascarado)
r.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const lead = await db.lead.findUnique({
      where: { id: req.params.id },
      include: { assignedTo: { select: { id:true, user: { select: { name:true } } } } }
    });
    if (!lead) return res.status(404).json({ error: "not_found" });
    // Permissão
    if (req.user.role !== "ADMIN"){
      const mine = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      if (lead.assignedToId !== mine?.id) return res.status(403).json({ error: "forbidden" });
    }
    // Nunca retorna phoneEncrypted, só phoneMasked
    const { phoneEncrypted, ...safe } = lead;
    // Libera tel se admin OU se origin manual (associado dono)
    let phone;
    // Regra 2026-06-29: apenas CORRETOR tem restricao; ADMIN e demais veem completo
    if (canViewPhone(req.user)){
      try { phone = decrypt(phoneEncrypted); } catch {}
    }
    res.json({ ...safe, phone });
  } catch (e){ next(e); }
});

// GET /api/leads/:id/phone · SOMENTE admin · auditado
r.get("/:id/phone", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const lead = await db.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) return res.status(404).json({ error: "not_found" });
    const phone = decrypt(lead.phoneEncrypted);
    await audit({ req, action: "LEAD_PHONE_DECRYPTED", entity: `Lead:${lead.id}`, metadata: { by: req.user.email } });
    res.json({ id: lead.id, phone, maskedPhone: lead.phoneMasked });
  } catch (e){ next(e); }
});

// POST /api/leads/manual · associado autenticado cria lead próprio (tel LIBERADO)
const manualSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(10),
  segment: z.enum(["Alto padrão","Investidor","Lançamentos","Regional"]).default("Regional"),
  source: z.string().default("Indicação direta"),
  city: z.string().optional(),
  notes: z.string().optional()
});
r.post("/manual", requireAuth, requireRole("ASSOCIATE"), async (req, res, next) => {
  // 2026-06-23 · Logger de entrada: rastreia TODA tentativa (sucesso, dedup, validação, erro).
  // Resolve casos tipo "salvei lead e sumiu" — bisseção em segundos via grep.
  const traceTag = "lead_manual_create";
  const trace = {
    userId: req.user?.id,
    email: req.user?.email,
    namePreview: typeof req.body?.name === "string" ? String(req.body.name).slice(0, 60) : null,
    phoneLast4: typeof req.body?.phone === "string" ? String(req.body.phone).slice(-4) : null,
    segment: req.body?.segment,
    at: new Date().toISOString(),
  };
  try {
    const parsed = manualSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn({ ...trace, issues: parsed.error.issues.map(i => i.path.join(".") + ":" + i.code) }, `${traceTag} · validation_failed`);
      return res.status(422).json({ error: "invalid_payload", issues: parsed.error.issues });
    }
    const data = parsed.data;
    const associate = await db.associate.findUnique({ where: { userId: req.user.id } });
    if (!associate) {
      logger.warn(trace, `${traceTag} · not_an_associate`);
      return res.status(404).json({ error: "not_an_associate" });
    }
    const phoneNorm = normalizePhone(data.phone);
    const phoneHash = sha256Hex(phoneNorm);
    // Dedup considerando variantes do "9" do celular BR
    const variants = phoneHashVariants(phoneNorm);
    const existing = await db.lead.findFirst({
      where: { phoneHash: { in: variants } },
      include: { assignedTo: { select: { id: true, user: { select: { name: true } } } } }
    });
    if (existing) {
      logger.info({ ...trace, existingLeadId: existing.id, existingOwner: existing.assignedTo?.user?.name }, `${traceTag} · dedup_409`);
      return res.status(409).json({
        error: "phone_already_exists",
        leadId: existing.id,
        // Devolve dono pra UI mostrar "já está com X" em vez de só "duplicado".
        ownerName: existing.assignedTo?.user?.name || null,
        ownedByMe: existing.assignedToId === associate.id
      });
    }

    // 2026-06-23 · Transação: lead.create + conversation.create atômicos.
    // Se conversation.create falhar, lead criado é revertido — evita lead órfão.
    const { lead, conv } = await db.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          name: data.name,
          phoneEncrypted: encrypt(phoneNorm),
          phoneHash,
          phoneMasked: maskPhone(phoneNorm),
          source: data.source,
          origin: "MANUAL",
          segment: data.segment,
          city: data.city || null,
          notes: data.notes || null,
          status: "QUALIFYING",
          assignedToId: associate.id,
          assignedAt: new Date(),
          firstContactAt: new Date()  // já marca contato · não entra na fila de redistribuição
        }
      });
      const conv = await tx.conversation.create({
        data: { leadId: lead.id, associateId: associate.id, manualFree: true }
      });
      return { lead, conv };
    });
    // Audit fora da tx (best-effort) — se falhar não invalida o que foi criado.
    await audit({ req, action: "LEAD_MANUAL_CREATED", entity: `Lead:${lead.id}`, metadata: { segment: data.segment } }).catch((e) => {
      logger.warn({ ...trace, leadId: lead.id, err: e.message }, `${traceTag} · audit_failed_non_fatal`);
    });
    logger.info({ ...trace, leadId: lead.id, convId: conv.id }, `${traceTag} · ok`);

    // SSE · proprio criador refetcha conv_list (manual create nao emite lead.assigned)
    try {
      sseToUser(req.user.id, "conv.created", {
        conversationId: conv.id,
        leadId: lead.id,
        leadName: lead.name,
        source: "manual_create",
        at: new Date().toISOString()
      });
    } catch {}

    // Upsert inicial no banco de CHAT (histórico) · dono = corretor logado
    chatUpsertConversation({
      id: conv.id,
      crmUserId: req.user.id, crmUserEmail: req.user.email, crmUserName: req.user.name, crmUserRole: req.user.role,
      leadId: lead.id, leadName: lead.name, leadPhone: phoneNorm, leadPhoneMask: lead.phoneMasked
    });

    // VAI (best-effort): cria contato + abre chat WhatsApp · guarda contactId+chatId+LID+phone
    vaiOnboardLeadSafe({
      name: data.name,
      phone: phoneNorm,
      externalId: lead.id,
      customFields: { segmento: data.segment, fonte: data.source }
    }).then(r => {
      if (r.ok){
        db.conversation.update({
          where: { id: conv.id },
          data: {
            ...(r.chatId    ? { vaiConvId:    r.chatId }    : {}),
            ...(r.contactId ? { vaiContactId: r.contactId } : {}),
            ...(r.lid       ? { vaiLid:       r.lid }       : {}),
            ...(r.phone     ? { vaiPhone:     r.phone }     : {})
          }
        }).catch(()=>{});
        // Atualiza banco de CHAT com identificadores VAI
        chatUpsertConversation({
          id: conv.id,
          vaiChatId: r.chatId, vaiContactId: r.contactId, vaiLid: r.lid, vaiPhone: r.phone
        });
      }
    }).catch(()=>{});

    // 2026-05-07 · retorna conversationId pra frontend usar como c.id da conv local.
    // Sem isso, o frontend criava conv mock (CV-M*) e a chamada API de envio de
    // mensagem era pulada pelo regex !/^CV-M/.test(c.id), causando msg só visual
    // sem hit no backend nem despacho pra VAI.
    res.status(201).json({ id: lead.id, phoneMasked: lead.phoneMasked, conversationId: conv.id });
  } catch (e){
    // 2026-06-23 · Logger de saída em erro: garante rastro mesmo de 500 inesperado.
    logger.error({ ...trace, err: e?.message, stack: e?.stack?.split("\n")[0] }, `${traceTag} · unexpected_error_500`);
    next(e);
  }
});

// POST /api/leads/:id/assign · admin atribui manualmente
// 2026-05-12 · 3 modos de atribuição:
//   - "specific": associateId obrigatório · atribui direto (comportamento legado)
//   - "queue":    coloca o lead na fila do distributionEngine
//   - "race":     notifica top N corretores online por score · 1º a "Pegar" leva
//                 cria disputeMode=true + disputeExpiresAt=NOW+raceMinutes
//                 se ninguém pegar até expirar, cron joga no rodízio normal
r.post("/:id/assign", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const schema = z.object({
      mode: z.enum(["specific","queue","race"]).default("specific"),
      associateId: z.string().cuid().optional(),
      raceMinutes: z.number().min(2).max(60).default(10),
      raceCandidates: z.number().min(2).max(20).default(5)
    });
    const body = schema.parse(req.body || {});
    const leadPre = await db.lead.findUnique({ where: { id: req.params.id } });
    if (!leadPre) return res.status(404).json({ error: "not_found" });

    // 2026-06-11 · Leads em atendimento não podem ser transferidos (nem com senha)
    const PROTECTED_STATUSES = ["QUALIFYING", "CLOSING"];
    if (leadPre.assignedToId && PROTECTED_STATUSES.includes(leadPre.status)) {
      return res.status(409).json({ error: "lead_in_negotiation", message: "Lead em atendimento não pode ser transferido" });
    }

    // 2026-06-11 · Senha obrigatória para remover lead de corretor já atribuído
    if (leadPre.assignedToId) {
      const PWD = Buffer.from("Calebe@2026%%%");
      const provided = Buffer.from(String(req.body?.transferPassword || ""));
      const passwordProvided = provided.length > 0;
      const valid = provided.length === PWD.length && timingSafeEqual(provided, PWD);
      await db.$executeRawUnsafe(
        `INSERT INTO "LeadTransferLog" (id, "requestedBy", "leadId", action, "passwordProvided", "passwordCorrect", "ipAddress", notes)
         VALUES (gen_random_uuid()::text, $1, $2, 'assign', $3, $4, $5, $6)`,
        req.user?.email || "unknown",
        leadPre.id,
        passwordProvided,
        valid,
        req.ip || null,
        valid ? "acesso autorizado" : "senha incorreta ou ausente"
      ).catch(() => {});
      if (!valid) return res.status(403).json({ error: "transfer_password_required", message: "Senha necessária para transferir lead de corretor" });
    }

    // ---------- Modo QUEUE: rodízio automático ------------------------------
    if (body.mode === "queue"){
      try {
        const mod = await import("../services/distributionEngine.js");
        await db.lead.update({
          where: { id: leadPre.id },
          data: { assignedToId: null, assignedAt: null, disputeMode: false, disputeStartedAt: null, disputeExpiresAt: null, disputeCandidates: null }
        });
        if (typeof mod.enqueueLead === "function") await mod.enqueueLead(leadPre.id);
        else if (typeof mod.distributeToday === "function") await mod.distributeToday();
      } catch (e){
        return res.status(500).json({ error: "queue_failed", message: e.message });
      }
      await audit({ req, action: "LEAD_ASSIGNED_QUEUE", entity: `Lead:${leadPre.id}`, metadata: {} });
      return res.json({ id: leadPre.id, mode: "queue", message: "Lead colocado na fila de distribuição automática" });
    }

    // ---------- Modo RACE: disputa entre top N online por score ------------
    if (body.mode === "race"){
      const fiveMinAgo = new Date(Date.now() - 5*60*1000);
      const thirty = new Date(Date.now() - 30*24*60*60*1000);
      const cutoff = process.env.RANKING_CUTOFF_AT ? new Date(process.env.RANKING_CUTOFF_AT) : null;
      const windowStart = cutoff && cutoff > thirty ? cutoff : thirty;

      const candidates = await db.associate.findMany({
        where: {
          status: "APPROVED",
          user: { is: { lastLoginAt: { not: null }, lastSeenAt: { gte: fiveMinAgo } } }
        },
        select: { id: true, userId: true, segment: true, user: { select: { name: true } } }
      });

      if (candidates.length === 0){
        // Sem online · fallback queue
        try {
          const { enqueueLead } = await import("../services/distributionEngine.js");
          if (enqueueLead) await enqueueLead(leadPre.id);
        } catch {}
        return res.json({ id: leadPre.id, mode: "queue_fallback", message: "Nenhum corretor online · indo pra fila automática" });
      }

      const segMatch = candidates.filter(c => c.segment === leadPre.segment);
      const pool = segMatch.length > 0 ? segMatch : candidates;
      const ids = pool.map(c => c.id);

      const [msgs, convs, sales] = await Promise.all([
        db.$queryRaw`SELECT c."associateId" AS id, COUNT(*)::int AS n FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId" WHERE m.direction='outbound' AND m."fromRole"='associate' AND m."createdAt" >= ${windowStart} AND c."associateId" = ANY(${ids}) GROUP BY c."associateId"`,
        db.$queryRaw`SELECT c."associateId" AS id, COUNT(DISTINCT c.id)::int AS n FROM "Conversation" c JOIN "Message" m ON m."conversationId"=c.id WHERE m.direction='outbound' AND m."fromRole"='associate' AND m."createdAt" >= ${windowStart} AND c."associateId" = ANY(${ids}) GROUP BY c."associateId"`,
        db.sale.groupBy({ by: ["associateId"], where: { status: "APPROVED", createdAt: { gte: windowStart }, associateId: { in: ids } }, _count: { _all: true } })
      ]);
      const mMap = new Map(msgs.map(r => [r.id, r.n]));
      const cMap = new Map(convs.map(r => [r.id, r.n]));
      const sMap = new Map(sales.map(r => [r.associateId, r._count._all]));
      const scored = pool.map(c => ({
        ...c,
        score: 50 + (mMap.get(c.id) || 0) * 0.5 + (cMap.get(c.id) || 0) * 5 + (sMap.get(c.id) || 0) * 30
      })).sort((a,b) => b.score - a.score);

      const topN = scored.slice(0, body.raceCandidates);
      const expiresAt = new Date(Date.now() + body.raceMinutes * 60 * 1000);

      await db.lead.update({
        where: { id: leadPre.id },
        data: {
          disputeMode: true, disputeStartedAt: new Date(), disputeExpiresAt: expiresAt,
          disputeCandidates: topN.map(c => c.id),
          assignedToId: null, assignedAt: null
        }
      });

      for (const c of topN){
        try {
          sseToUser(c.userId, "lead.dispute.invited", {
            leadId: leadPre.id, leadName: leadPre.name, leadSegment: leadPre.segment,
            expiresAt: expiresAt.toISOString(), candidatesCount: topN.length,
            at: new Date().toISOString()
          });
          sendPushToUser(c.userId, {
            eventKey: "lead.disputed",
            title: `⚡ Lead em disputa: ${leadPre.name}`,
            body: `${leadPre.segment} · seja rápido · expira em ${body.raceMinutes}min`,
            data: { leadId: leadPre.id, type: "dispute" }
          }).catch(()=>{});
        } catch {}
      }
      sseToAdmins("lead.dispute.started", { leadId: leadPre.id, candidates: topN.length, expiresAt: expiresAt.toISOString() });
      await audit({ req, action: "LEAD_ASSIGNED_RACE", entity: `Lead:${leadPre.id}`, metadata: { candidates: topN.map(c => ({ id: c.id, name: c.user.name, score: c.score })), expiresAt } });
      return res.json({
        id: leadPre.id, mode: "race", expiresAt,
        candidates: topN.map(c => ({ id: c.id, name: c.user.name, score: c.score }))
      });
    }

    // ---------- Modo SPECIFIC (legado) --------------------------------------
    const associateId = body.associateId;
    if (!associateId) return res.status(400).json({ error: "associateId_required_for_specific_mode" });
    // Copia IDs VAI do Lead para a Conversation (se existirem)
    const vaiPatch = {
      ...(leadPre.vaiContactId  ? { vaiContactId: leadPre.vaiContactId } : {}),
      ...(leadPre.vaiLastChatId ? { vaiConvId:    leadPre.vaiLastChatId } : {}),
      ...(leadPre.vaiLid        ? { vaiLid:       leadPre.vaiLid } : {}),
      ...(leadPre.vaiPhone      ? { vaiPhone:     leadPre.vaiPhone } : {})
    };
    const [lead, conv] = await db.$transaction([
      db.lead.update({
        where: { id: req.params.id },
        data: { assignedToId: associateId, assignedAt: new Date(), firstContactAt: null }
      }),
      db.conversation.upsert({
        where: { leadId: req.params.id },
        update: { associateId, ...vaiPatch },
        create: { leadId: req.params.id, associateId, manualFree: false, ...vaiPatch }
      })
    ]);
    await audit({ req, action: "LEAD_ASSIGNED", entity: `Lead:${lead.id}`, metadata: { associateId } });
    // 2026-06-07 · Transferencia manual entre corretores tambem registra no log de
    // redistribuicao (mesma fonte que oculta o historico do corretor novo no chat).
    // NAO incrementa redistributionCount (nao conta pro limite — e override do admin).
    if (leadPre.assignedToId && leadPre.assignedToId !== associateId){
      try {
        await db.redistributionLog.create({
          data: { leadId: lead.id, previousAssociateId: leadPre.assignedToId, newAssociateId: associateId, reason: "manual_admin", attempt: 0 }
        });
      } catch (e){ logger.warn?.({ err: e.message, leadId: lead.id }, "redistributionLog manual falhou (nao-fatal)"); }
    }
    // SSE · corretor recebe notificação + admins atualizam
    let assocFull = null;
    try {
      assocFull = await db.associate.findUnique({ where: { id: associateId }, select: { userId: true, user: { select: { id: true, name: true, email: true, role: true } } } });
      if (assocFull?.userId){
        sseToUser(assocFull.userId, "lead.assigned", { leadId: lead.id, segment: lead.segment, at: new Date().toISOString() });
        sseToUser(assocFull.userId, "conv.created", {
          conversationId: conv.id,
          leadId: lead.id,
          leadName: lead.name,
          source: "admin_assign",
          at: new Date().toISOString()
        });
      }
      sseToAdmins("lead.distributed", { leadId: lead.id, associateId, associateName: assocFull?.user?.name });
    } catch {}
    // WhatsApp template "calebe_novo_lead" + push · corretor é avisado mesmo offline
    if (assocFull?.userId){
      sendPushToUser(assocFull.userId, {
        eventKey: "lead.assigned",
        kind: "lead_new",
        title: "🟡 Novo lead atribuído",
        body: `${lead.name || "Lead"} · ${lead.segment || "—"}`,
        url: `/?screen=cors-leads&lead=${lead.id}`,
        tag: `lead-${lead.id}`,
        requireInteraction: true
      }).catch(()=>{});
    }
    notifyAssociateLeadAssigned({ associateId, leadId: lead.id, leadName: lead.name }).catch(()=>{});
    // Garante row correspondente no banco de chat (chatDb) · senão chatInsertMessage falha com FK violation
    try {
      chatUpsertConversation({
        id: conv.id,
        crmUserId:   assocFull?.user?.id   || null,
        crmUserName: assocFull?.user?.name || null,
        crmUserEmail: assocFull?.user?.email || null,
        crmUserRole: assocFull?.user?.role || "ASSOCIATE",
        leadId: lead.id, leadName: lead.name, leadPhoneMask: leadPre.phoneMasked || null,
        vaiChatId: leadPre.vaiLastChatId || null, vaiContactId: leadPre.vaiContactId || null,
        vaiLid: leadPre.vaiLid || null, vaiPhone: leadPre.vaiPhone || null
      });
    } catch {}
    // Bootstrap de histórico da VAI (traz msgs anteriores)
    if (leadPre.vaiLastChatId){
      bootstrapConversationHistory({
        conversationId: conv.id,
        leadId: lead.id,
        vaiChatId: leadPre.vaiLastChatId,
        crmUser: assocFull?.user
      }).catch(()=>{});
    }
    res.json({ id: lead.id, assignedToId: associateId, conversationId: conv.id });
  } catch (e){ next(e); }
});

// 2026-05-12 · POST /api/leads/:id/claim · corretor pega lead em disputa
r.post("/:id/claim", requireAuth, requireRole("ASSOCIATE"), async (req, res, next) => {
  try {
    const associate = await db.associate.findUnique({
      where: { userId: req.user.id },
      select: { id: true, userId: true, status: true, user: { select: { name: true } } }
    });
    if (!associate || associate.status !== "APPROVED") return res.status(403).json({ error: "not_eligible" });

    // Transação atomic · evita 2 corretores pegando ao mesmo tempo
    const result = await db.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: req.params.id } });
      if (!lead) return { error: "not_found", status: 404 };
      if (!lead.disputeMode) return { error: "not_in_dispute", status: 409 };
      if (!lead.disputeExpiresAt || lead.disputeExpiresAt < new Date()) return { error: "dispute_expired", status: 410 };
      const candidates = Array.isArray(lead.disputeCandidates) ? lead.disputeCandidates : [];
      if (!candidates.includes(associate.id)) return { error: "not_invited", status: 403 };

      // Atomic claim
      const updated = await tx.lead.update({
        where: { id: lead.id },
        data: {
          assignedToId: associate.id,
          assignedAt: new Date(),
          claimedAt: new Date(),
          disputeMode: false,
          firstContactAt: null
        }
      });
      const conv = await tx.conversation.upsert({
        where: { leadId: lead.id },
        update: { associateId: associate.id },
        create: { leadId: lead.id, associateId: associate.id, manualFree: false }
      });
      return { lead: updated, conv, candidates };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });

    // Notifica os outros candidatos que perderam · SSE
    for (const otherId of result.candidates){
      if (otherId === associate.id) continue;
      try {
        const other = await db.associate.findUnique({ where: { id: otherId }, select: { userId: true } });
        if (other?.userId){
          sseToUser(other.userId, "lead.dispute.taken", {
            leadId: result.lead.id, takenBy: associate.user.name, at: new Date().toISOString()
          });
        }
      } catch {}
    }
    // Notifica admins
    sseToAdmins("lead.dispute.claimed", { leadId: result.lead.id, associateId: associate.id, associateName: associate.user.name });

    await audit({ req, action: "LEAD_DISPUTE_CLAIMED", entity: `Lead:${result.lead.id}`, metadata: { associateId: associate.id } });
    res.json({ ok: true, leadId: result.lead.id, conversationId: result.conv.id });
  } catch (e){ next(e); }
});

// PATCH /api/leads/:id · atualização parcial (atualmente: linkedPropertyId, notes, city)
const patchSchema = z.object({
  linkedPropertyId: z.string().cuid().nullable().optional(),
  notes: z.string().max(4000).optional(),
  city:  z.string().max(120).optional()
}).strict();
r.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const data = patchSchema.parse(req.body);
    const lead = await db.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) return res.status(404).json({ error: "not_found" });
    // Corretor só pode editar se for dono · admin sempre
    if (req.user.role !== "ADMIN"){
      const mine = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      if (lead.assignedToId !== mine?.id) return res.status(403).json({ error: "forbidden" });
    }
    // Se mudou linkedProperty: avança pra NEGOTIATING se estava NEW/QUALIFYING
    const updates = { ...data };
    if (data.linkedPropertyId && (lead.status === "NEW" || lead.status === "QUALIFYING")){
      updates.status = "NEGOTIATING";
    }
    const updated = await db.lead.update({ where: { id: lead.id }, data: updates });
    await audit({ req, action: "LEAD_UPDATED", entity: `Lead:${lead.id}`, metadata: data });
    res.json({ id: updated.id, linkedPropertyId: updated.linkedPropertyId, status: updated.status });
  } catch (e){ next(e); }
});

// PATCH /api/leads/:id/status
r.patch("/:id/status", requireAuth, async (req, res, next) => {
  try {
    const { status, reason } = z.object({
      status: z.enum(["NEW","QUALIFYING","NEGOTIATING","CLOSING","CLOSED","LOST"]),
      reason: z.string().optional()
    }).parse(req.body);
    // Permissão
    const lead = await db.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) return res.status(404).json({ error: "not_found" });
    if (req.user.role !== "ADMIN"){
      const mine = await db.associate.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      if (lead.assignedToId !== mine?.id) {
        // 2026-06-09 · Fallback: leads VAI/importados podem ter assignedToId diferente
        // do corretor da conversa. Usa conversa como segundo critério de posse.
        const conv = await db.conversation.findUnique({ where: { leadId: lead.id }, select: { associateId: true } });
        if (!conv || conv.associateId !== mine?.id) return res.status(403).json({ error: "forbidden" });
      }
    }
    const data = { status };
    if (status === "LOST"){ data.discardReason = reason || null; data.discardedAt = new Date(); }
    const updated = await db.lead.update({ where: { id: lead.id }, data });
    await audit({ req, action: "LEAD_STATUS_CHANGED", entity: `Lead:${lead.id}`, metadata: { from: lead.status, to: status, reason } });

    // SSE pra admins · frontend admChatMonitor refresca sem F5
    try {
      const conv = await db.conversation.findUnique({ where: { leadId: lead.id }, select: { id: true } });
      sseToAdmins("lead.status_changed", {
        leadId: lead.id,
        leadName: lead.name,
        conversationId: conv?.id || null,
        from: lead.status,
        to: status,
        reason: reason || null
      });
    } catch {}

    // Se encerrou (CLOSED/LOST) · fecha chat na VAI e limpa vaiConvId preservando vaiContactId.
    // Assim, próxima mensagem pro mesmo lead reusa o contato e a VAI cria chat novo bound.
    if (status === "CLOSED" || status === "LOST"){
      (async () => {
        try {
          const conv = await db.conversation.findUnique({
            where: { leadId: lead.id },
            select: { id: true, vaiConvId: true, vaiContactId: true }
          });
          if (!conv) return;
          if (conv.vaiConvId){
            try {
              await vaiCloseChat(conv.vaiConvId, { notes: reason || `Encerrado no CRM · status=${status}` });
              logger.info({ convId: conv.id, vaiChatId: conv.vaiConvId, status }, "vai chat encerrado");
            } catch (e){
              logger.warn({ convId: conv.id, vaiChatId: conv.vaiConvId, err: e.message }, "vai close falhou · seguindo");
            }
            await db.conversation.update({
              where: { id: conv.id },
              data: { vaiConvId: null, vaiLid: null }
            });
          }
        } catch (e){
          logger.warn({ leadId: lead.id, err: e.message }, "close-on-status pipeline falhou");
        }
      })();
    }

    res.json({ id: updated.id, status: updated.status });
  } catch (e){ next(e); }
});

export default r;
