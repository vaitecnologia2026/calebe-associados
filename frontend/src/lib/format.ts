// Helpers de formatação · portados do index.html monolítico
//   - maskPhoneText (linha 7494)
//   - formatLeadTelForCorretor (7504)
//   - getSlaMinutos (7514) + getSlaColor (7538)
//   - getInatividadeInfo (8052)

/**
 * Formata número de telefone para exibição.
 * Brasileiro (55+DDD+número): "+55 (41) 99222-4466"
 * Estrangeiro: espaçado a cada 3 dígitos
 */
export function fmtPhone(phone?: string | null): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  if (!d) return phone;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const num = d.slice(4);
    const part = num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`;
    return `+55 (${ddd}) ${part}`;
  }
  return d.replace(/(\d{2,3})(?=\d)/g, "$1 ").trim();
}

/** URL do WhatsApp para um número (E.164 ou raw digits) */
export function waUrl(phone?: string | null): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  return d ? `https://wa.me/${d}` : "";
}
//   - audioWithIOSFallback (7474) — gera array de sources, componente Audio aplica

import type { Conversation, Message } from "@/types/conversation";
import type { InactivityInfo } from "@/types/lead";

/**
 * Mascara telefones BR em qualquer texto · mantém 2 dígitos finais
 *
 *   "Liga (47) 99887-7766" → "Liga (47) 9****-**66"
 */
export function maskPhoneText(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(
    /(\+?\d{2}\s?)?\(?\d{2}\)?\s?9?\s?\d{3,4}-?\d{4}/g,
    (m) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length < 8) return m;
      const ddd = digits.slice(0, digits.length >= 11 ? 2 : 2);
      const last = digits.slice(-2);
      return `(${ddd}) 9****-**${last}`;
    },
  );
}

/**
 * Privacy rule do telefone do lead pro corretor:
 *   - Admin aprovou (telLiberado) OU lead origin=MANUAL → telefone real
 *   - Resto → mascarado
 *
 * Equivalente a formatLeadTelForCorretor (linha 7504)
 */
export function formatLeadTelForCorretor(conv: {
  phoneReleased?: boolean;
  manualFree?: boolean;
  lead?: { phone?: string; phoneMasked?: string; origin?: string };
}): string {
  if (!conv) return "";
  const liberado = conv.phoneReleased || conv.manualFree || conv.lead?.origin === "MANUAL";
  if (conv.lead?.phone) return fmtPhone(conv.lead.phone); // admin/allowlist vê número formatado
  const real = conv.lead?.phoneMasked ?? conv.lead?.phone ?? "";
  const digits = real.replace(/\D/g, "");
  if (digits.length < 4) return "—";
  const ddd = digits.slice(0, 2);
  const last = digits.slice(-2);
  return `(${ddd}) 9****-**${last}`;
}

function minutosDesde(iso: string | Date | undefined | null): number {
  if (!iso) return 0;
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.floor((Date.now() - t) / 60000);
}

/**
 * SLA pipeline (precedência):
 *   1. Conversa encerrada → 0
 *   2. Última msg foi inbound → minutos desde ela
 *   3. Nunca teve 1º contato + atribuído → minutos desde atribuição
 *   4. Array local de msgs com última do lead → desde ela
 *   5. Corretor já respondeu → 0
 *
 * Portado de getSlaMinutos (linha 7514)
 */
export function getSlaMinutos(conv: Conversation | (Conversation & { status?: string; primeiroContatoEm?: string; atribuidoEm?: string; mensagens?: Message[] }) | null | undefined): number {
  if (!conv) return 0;
  const s = (conv as any).status;
  if (s === "perdido" || s === "fechado" || s === "descartado") return 0;

  const last = conv.lastMessage;
  if (last && last.direction === "inbound" && last.at) {
    return minutosDesde(last.at);
  }

  const primeiroContato = (conv as any).primeiroContatoEm;
  const atribuido = (conv as any).atribuidoEm;
  if (!primeiroContato && atribuido) return minutosDesde(atribuido);

  const mensagens = (conv as any).mensagens as Message[] | undefined;
  if (Array.isArray(mensagens) && mensagens.length) {
    const ult = mensagens[mensagens.length - 1];
    if (ult && ult.from === "lead" && ult.at) {
      return minutosDesde(ult.at);
    }
  }
  return 0;
}

export interface SlaColor {
  bg: string;
  color: string;
  label: string;
}

/**
 * Faixas de cor SLA · portado de getSlaColor (linha 7538)
 */
export function getSlaColor(min: number): SlaColor {
  if (min === 0)      return { bg: "rgba(95,209,168,.16)", color: "#5FD1A8", label: "Em dia" };
  if (min <= 4)       return { bg: "rgba(95,209,168,.12)", color: "#5FD1A8", label: "Em dia" };
  if (min <= 9)       return { bg: "rgba(245,165,36,.16)", color: "#F5A524", label: "Atenção" };
  if (min <= 19)      return { bg: "rgba(239,68,68,.14)",  color: "#EF4444", label: "Crítico" };
  return                     { bg: "rgba(239,68,68,.24)",  color: "#FF6B6B", label: "Estourado" };
}

/**
 * Classifica inatividade de uma conversa (lead sem resposta do corretor)
 * Portado de getInatividadeInfo (linha 8052) · default 20min
 */
export function getInatividadeInfo(
  conv: Conversation,
  toleranciaMin: number = 20,
): InactivityInfo {
  const sla = getSlaMinutos(conv);
  if (sla < toleranciaMin * 0.75) return { tipo: "ok", minutos: sla };
  if (sla < toleranciaMin)        return { tipo: "atencao", minutos: sla, proximoRedist: toleranciaMin - sla };
  const redistCount = (conv as any).redistribuicoesCount as number | undefined;
  if ((redistCount ?? 0) >= 3)    return { tipo: "limite_excedido", minutos: sla };
  return                            { tipo: "critico", minutos: sla };
}

/**
 * Gera array de sources p/ áudio com fallback Safari iOS (OGG → MP3 → M4A)
 * Portado de audioWithIOSFallback (linha 7474)
 */
export function buildAudioSources(url: string | null | undefined): { src: string; type: string }[] {
  if (!url) return [];
  const ogg = String(url);
  let m4a: string | null = null;
  let mp3: string | null = null;

  if (ogg.startsWith("/midias/")) {
    const tail = ogg.replace(/^\/midias\//, "");
    m4a = `/api/audio-mp4/${tail}`;
    mp3 = `/api/audio-mp3/${tail}`;
  } else {
    const mVai = ogg.match(/^https?:\/\/vaistorage\.s3[.-][a-z0-9-]+\.amazonaws\.com\/files\/([a-f0-9-]+\.[a-z0-9]+)(\?|$)/i);
    if (mVai) {
      m4a = `/api/audio-mp4/vai/${mVai[1]}`;
      mp3 = `/api/audio-mp3/vai/${mVai[1]}`;
    }
  }

  const sources = [{ src: ogg, type: "audio/ogg" }];
  if (mp3) sources.push({ src: mp3, type: "audio/mpeg" });
  if (m4a) sources.push({ src: m4a, type: "audio/mp4" });
  return sources;
}

/**
 * Format HH:MM pt-BR
 */
export function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Label de data WhatsApp-style: HOJE / ONTEM / 12 DE MAIO DE 2026
 */
export function formatChatDateLabel(iso: string | Date): string {
  const dt = typeof iso === "string" ? new Date(iso) : iso;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  const d0 = new Date(dt); d0.setHours(0, 0, 0, 0);
  if (d0.getTime() === today.getTime()) return "HOJE";
  if (d0.getTime() === yest.getTime()) return "ONTEM";
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).toUpperCase();
}

export function dayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/** Formata BRL completo · "R$ 12.345,67" */
export function fmtBRL(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "R$ 0";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}

/** Formata BRL compacto · "R$ 0", "R$ 1.2K", "R$ 1.5M" */
export function fmtBRLCompact(v: number | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n === 0) return "R$ 0";
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (Math.abs(n) >= 1_000) return `R$ ${(n / 1_000).toFixed(1).replace(".", ",")}K`;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

/** Data PT-BR curta · "17 abr 2026 · 10:42" */
export function fmtNowBR(): string {
  const d = new Date();
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `Hoje · ${date} · ${time}`;
}
