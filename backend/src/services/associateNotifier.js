// =============================================================================
// services/associateNotifier.js · notifica corretor via WhatsApp Cloud
//
// Templates UTILITY usados:
//   - calebe_novo_lead       · {{1}} = nome corretor, {{2}} = nome lead
//   - calebe_lead_respondeu  · {{1}} = nome corretor, {{2}} = nome lead
//
// Debounce simples em memória pra não inundar o corretor quando o lead manda
// 10 mensagens seguidas — segura uma notificação por (associateId, leadId,
// kind) dentro do TTL.
// =============================================================================
import { db } from "../db.js";
import { logger } from "../utils/logger.js";
import { sendTemplate, isEnabled as waCloudEnabled } from "./whatsappCloud.js";

const DEBOUNCE_MS = 5 * 60 * 1000;             // 5 minutos
const _last = new Map();                        // key -> ts

// 2026-06-02 · Janela horária de notificações ao corretor (BRT = UTC-3).
// Fora desse intervalo, templates de status de lead (novo_lead, lead_respondeu)
// NÃO são enviados — corretor não recebe notificações no meio da madrugada.
// Conversas normais (mensagens livres do broker) continuam liberadas.
const NOTIFY_START_H = 7;                       // 07:xx
const NOTIFY_START_M = 30;                      // :30
const NOTIFY_END_H   = 19;                      // 19:xx (encerra às 19:00)

function _dentroJanelaHoraria(){
  // Servidor roda em BRT (America/Sao_Paulo, UTC-3)
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const minutos = h * 60 + m;
  const inicio  = NOTIFY_START_H * 60 + NOTIFY_START_M; // 450 = 07:30
  const fim     = NOTIFY_END_H   * 60;                   // 1140 = 19:00
  return true; // 2026-06-07 · janela de horario REMOVIDA a pedido do admin (avisos 24/7)
}

function _debounceKey(kind, associateId, leadId){
  return `${kind}:${associateId}:${leadId}`;
}

function _allowed(key){
  const now = Date.now();
  const prev = _last.get(key) || 0;
  if (now - prev < DEBOUNCE_MS) return false;
  _last.set(key, now);
  // limpa entradas antigas pra não vazar
  if (_last.size > 500){
    for (const [k, ts] of _last){ if (now - ts > DEBOUNCE_MS * 2) _last.delete(k); }
  }
  return true;
}

function _normPhone(raw){
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 10) return null;
  // Garante prefixo BR · 55
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  return digits;
}

async function _resolveAssociateContact(associateId){
  if (!associateId) return null;
  const a = await db.associate.findUnique({
    where: { id: associateId },
    select: {
      phone: true,
      whatsapp: true,
      user: { select: { name: true } }
    }
  });
  if (!a) return null;
  const phone = _normPhone(a.whatsapp) || _normPhone(a.phone);
  if (!phone) return null;
  const firstName = (a.user?.name || "corretor").split(/\s+/)[0];
  return { phone, name: firstName };
}

/**
 * Notifica o corretor que um novo lead foi atribuído a ele.
 * Best-effort · loga falhas mas nunca lança.
 */
export async function notifyAssociateLeadAssigned({ associateId, leadId, leadName }){
  // 2026-06-07 · SUSPENSO temporariamente (admin) ate notificacao bater 100% com os leads.
  // A DISTRIBUICAO de leads NAO e afetada — so o WhatsApp "novo lead" pro corretor para.
  // Reativar: remover NOTIFY_NEWLEAD_WA=0 do .env (ou setar 1) e reload.
  if (process.env.NOTIFY_NEWLEAD_WA === "0") return { ok: false, skipped: "suspended_by_admin" };
  if (!waCloudEnabled()) return { ok: false, skipped: "wa_disabled" };
  if (!associateId || !leadId) return { ok: false, skipped: "missing_args" };
  // 2026-06-02 · Bloqueia notificação fora da janela 07:30-19:00 BRT.
  // Leads continuam sendo DISTRIBUÍDOS normalmente, mas o WhatsApp ao corretor
  // aguarda o horário comercial — ele verá o lead ao logar de manhã.
  if (!_dentroJanelaHoraria()){
    logger.info({ associateId, leadId }, "📵 notifier · novo_lead bloqueado fora da janela 07:30-19:00");
    return { ok: false, skipped: "outside_hours" };
  }

  const key = _debounceKey("lead_assigned", associateId, leadId);
  if (!_allowed(key)) return { ok: false, skipped: "debounced" };

  try {
    const contact = await _resolveAssociateContact(associateId);
    if (!contact) return { ok: false, skipped: "no_phone" };

    const safeLeadName = String(leadName || "novo cliente").slice(0, 60);

    const res = await sendTemplate({
      to: contact.phone,
      templateName: "calebe_novo_lead",
      languageCode: "pt_BR",
      bodyParams: [contact.name, safeLeadName]
    });
    if (!res.ok){
      logger.warn({ associateId, leadId, status: res.status, err: res.error }, "associateNotifier · novo_lead falhou");
    } else {
      logger.info({ associateId, leadId, to: contact.phone }, "📲 associateNotifier · novo_lead enviado");
    }
    return res;
  } catch (e){
    logger.error({ err: e.message, associateId, leadId }, "associateNotifier · novo_lead exception");
    return { ok: false, error: e.message };
  }
}

/**
 * Notifica o corretor que o lead respondeu uma mensagem no WhatsApp.
 * Best-effort · debounce 5min por (corretor, lead).
 */
export async function notifyAssociateLeadReplied({ associateId, leadId, leadName }){
  if (!waCloudEnabled()) return { ok: false, skipped: "wa_disabled" };
  if (!associateId || !leadId) return { ok: false, skipped: "missing_args" };
  // 2026-06-02 · Bloqueia notificação "lead respondeu" fora da janela 07:30-19:00 BRT.
  // Se o lead responde de madrugada o corretor NÃO recebe WhatsApp — vê ao logar.
  // SSE/push web continuam funcionando pra quem está com o app aberto.
  if (!_dentroJanelaHoraria()){
    logger.info({ associateId, leadId }, "📵 notifier · lead_respondeu bloqueado fora da janela 07:30-19:00");
    return { ok: false, skipped: "outside_hours" };
  }

  const key = _debounceKey("lead_replied", associateId, leadId);
  if (!_allowed(key)) return { ok: false, skipped: "debounced" };

  try {
    const contact = await _resolveAssociateContact(associateId);
    if (!contact) return { ok: false, skipped: "no_phone" };

    const safeLeadName = String(leadName || "seu cliente").slice(0, 60);

    const res = await sendTemplate({
      to: contact.phone,
      templateName: "calebe_lead_respondeu",
      languageCode: "pt_BR",
      bodyParams: [contact.name, safeLeadName]
    });
    if (!res.ok){
      logger.warn({ associateId, leadId, status: res.status, err: res.error }, "associateNotifier · lead_respondeu falhou");
    } else {
      logger.info({ associateId, leadId, to: contact.phone }, "📲 associateNotifier · lead_respondeu enviado");
    }
    return res;
  } catch (e){
    logger.error({ err: e.message, associateId, leadId }, "associateNotifier · lead_respondeu exception");
    return { ok: false, error: e.message };
  }
}


// 2026-06-14 · Cobrança: avisa o corretor que tem leads sem atendimento (template c/ botões).
export async function notifyAssociateSemAtendimento(associateId){
  if (!waCloudEnabled()) return { ok:false, skipped:"wa_disabled" };
  if (!associateId) return { ok:false, skipped:"missing" };
  try {
    const contact = await _resolveAssociateContact(associateId);
    if (!contact || !contact.phone) return { ok:false, skipped:"no_phone" };
    const res = await sendTemplate({ to: contact.phone, templateName: "calebe_aviso_lead_sem_atendimento_v1", languageCode: "pt_BR", bodyParams: [] });
    if (res.ok) logger.info({ associateId, to: contact.phone }, "📲 cobranca sem_atendimento enviada");
    else logger.warn({ associateId, status: res.status, err: res.error }, "cobranca sem_atendimento falhou");
    return res;
  } catch (e){ logger.error({ err:e.message, associateId }, "cobranca sem_atendimento exception"); return { ok:false, error:e.message }; }
}
