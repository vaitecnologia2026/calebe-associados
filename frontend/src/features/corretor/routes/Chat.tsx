// Chat Lead (corretor) · porte FIEL ao monólito cors-leads (linhas 2918-2936 + renderCorLeads 17694)
// Mostra TABELA "Meus leads" · click em "Abrir conversa →" cria/abre conversa e
// navega para /corretor/chat/conv/:convId (split view em Conversa.tsx)

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, ChevronRight, MessageCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { useConversations } from "@/store/conversations";
import type { Lead, LeadStatus } from "@/types/lead";

const STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: "Novo", QUALIFYING: "Qualificando", NEGOTIATING: "Negociando",
  CLOSING: "Em fechamento", CLOSED: "Fechado", LOST: "Perdido",
};
const STATUS_TONE: Record<LeadStatus, { bg: string; fg: string }> = {
  NEW:         { bg: "bg-blue-500/15",    fg: "text-blue-300" },
  QUALIFYING:  { bg: "bg-gold-400/15",    fg: "text-gold-300" },
  NEGOTIATING: { bg: "bg-emerald-500/15", fg: "text-emerald-300" },
  CLOSING:     { bg: "bg-orange-500/15",  fg: "text-orange-300" },
  CLOSED:      { bg: "bg-emerald-500/20", fg: "text-emerald-300" },
  LOST:        { bg: "bg-red-500/15",     fg: "text-red-300" },
};

type ChatStatusLabel = "Sem contato" | "Aguardando resposta" | "Lead iniciou" | "Em conversa";
const CHAT_CHIP: Record<ChatStatusLabel, { bg: string; fg: string; dot: string }> = {
  "Sem contato":         { bg: "bg-sand-100/10",    fg: "text-sand-100/70", dot: "#A0907C" },
  "Aguardando resposta": { bg: "bg-amber-500/20",   fg: "text-amber-300",   dot: "#FCD34D" },
  "Lead iniciou":        { bg: "bg-blue-500/20",    fg: "text-blue-300",    dot: "#93C5FD" },
  "Em conversa":         { bg: "bg-emerald-500/20", fg: "text-emerald-300", dot: "#6EE7B7" },
};

function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "agora";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(iso); d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) {
      const hh = new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      return `hoje ${hh}`;
    }
    return `${h}h`;
  }
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function chatStatusFromCounts(inbound: number, outbound: number): ChatStatusLabel {
  if (inbound === 0 && outbound === 0) return "Sem contato";
  if (outbound > 0 && inbound === 0) return "Aguardando resposta";
  if (inbound > 0 && outbound === 0) return "Lead iniciou";
  return "Em conversa";
}

interface MyLead extends Lead {
  inboundCount?: number;
  outboundCount?: number;
  conversationId?: string | null;
  createdAt?: string;
}

export function CorretorChat() {
  const [list, setList] = useState<MyLead[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const showToast = useUi((s) => s.showToast);
  const setActive = useConversations((s) => s.setActive);
  const nav = useNavigate();

  async function load() {
    setLoading(true);
    try {
      // chat-report vem com inboundCount/outboundCount/responded calculados,
      // mas usa shape custom: leadId (não id), source (não origin), assignedAt (não createdAt),
      // sem conversationId. Adapta pra MyLead pra preservar o resto do componente.
      type ChatReportRow = {
        leadId: string; name: string; phoneMasked?: string; source?: string; segment?: string;
        city?: string; campaignName?: string; status?: string; assignedAt?: string;
        firstContactAt?: string | null; lastMessageAt?: string | null;
        inboundCount: number; outboundCount: number; responded: boolean; chatStatus: string;
      };
      const r = await api.get<{ data: ChatReportRow[] }>("/api/leads/my/chat-report");
      const adapted: MyLead[] = (r.data ?? []).map((row) => ({
        id: row.leadId,
        name: row.name,
        phoneMasked: row.phoneMasked,
        origin: row.source as MyLead["origin"],
        segment: row.segment,
        status: row.status as MyLead["status"],
        firstContactAt: row.firstContactAt ?? undefined,
        inboundCount: row.inboundCount,
        outboundCount: row.outboundCount,
        createdAt: row.assignedAt,
      }));
      setList(adapted);
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return list;
    return list.filter((l) =>
      (l.name ?? "").toLowerCase().includes(q) ||
      (l.origin ?? "").toLowerCase().includes(q)
    );
  }, [list, search]);

  async function abrirConversa(lead: MyLead) {
    setOpening(lead.id);
    try {
      let convId = lead.conversationId;
      if (!convId) {
        const r = await api.post<{ conversation?: { id: string } }>(
          "/api/conversations/ensure-by-lead",
          { leadId: lead.id }
        );
        convId = r.conversation?.id ?? null;
      }
      if (!convId) {
        showToast("Falha ao abrir conversa");
        return;
      }
      setActive(convId);
      nav(`/corretor/chat/conv/${convId}`);
    } catch (e: any) {
      showToast(`Erro: ${e?.message ?? e}`);
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      {/* Header · monólito 2919 */}
      <header className="mb-4 flex flex-wrap justify-between items-end gap-3">
        <div>
          <p className="meta-gold mb-1">Meus leads</p>
          <h1 className="text-2xl md:text-3xl font-bold tracking-display-tight">
            {list.length} {list.length === 1 ? "lead" : "leads"}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="field-input py-2 text-sm w-full md:w-60"
            placeholder="Buscar por nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </header>

      {/* Mobile · cards (monólito 2926) */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <p className="text-center text-sand-100/55 text-sm py-8">Carregando…</p>
        ) : !filtered.length ? (
          <p className="text-center text-sand-100/55 text-sm py-8">
            {search ? "Nenhum lead com esse nome." : "Nenhum lead atribuído a você ainda."}
          </p>
        ) : (
          filtered.slice(0, 200).map((l) => {
            const inbound = l.inboundCount ?? 0;
            const outbound = l.outboundCount ?? 0;
            const chip = CHAT_CHIP[chatStatusFromCounts(inbound, outbound)];
            return (
              <button
                key={l.id}
                onClick={() => abrirConversa(l)}
                disabled={opening === l.id}
                className="card w-full text-left p-3 flex items-center gap-3 hover:border-gold-400/40 active:bg-app-subtle/50 transition-colors disabled:opacity-60"
              >
                <div className="h-10 w-10 rounded-full bg-gold-400/15 flex items-center justify-center text-gold-400 font-bold text-sm shrink-0">
                  {(l.name?.[0] ?? "?").toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className="font-semibold text-sand-50 truncate flex-1 text-sm">{l.name}</p>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.62rem] font-semibold whitespace-nowrap ${chip.bg} ${chip.fg}`}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: chip.dot }} />
                      {chatStatusFromCounts(inbound, outbound)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[0.7rem] text-sand-100/60">
                    <div className="flex items-center gap-2 min-w-0">
                      {(inbound > 0 || outbound > 0) && (
                        <span className="whitespace-nowrap">↓ {inbound} · ↑ {outbound}</span>
                      )}
                      <span className="truncate">{timeAgo(l.createdAt)}</span>
                    </div>
                  </div>
                </div>
                <ChevronRight size={14} className="text-sand-100/35 shrink-0" />
              </button>
            );
          })
        )}
      </div>

      {/* Desktop · tabela (monólito 2928) */}
      <div className="hidden md:block card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
              <tr>
                <th className="text-left p-4">Lead</th>
                <th className="text-left p-4">Origem</th>
                <th className="text-left p-4">Status</th>
                <th className="text-left p-4">Entrada</th>
                <th className="text-right p-4">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-sand-100/55">Carregando…</td></tr>
              ) : !filtered.length ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-sand-100/55 text-sm">
                    {search ? "Nenhum lead com esse nome." : "Nenhum lead atribuído a você ainda."}
                  </td>
                </tr>
              ) : filtered.slice(0, 200).map((l) => {
                const inbound = l.inboundCount ?? 0;
                const outbound = l.outboundCount ?? 0;
                const chip = CHAT_CHIP[chatStatusFromCounts(inbound, outbound)];
                const tone = l.status ? STATUS_TONE[l.status] : { bg: "bg-sand-100/10", fg: "text-sand-100/70" };
                return (
                  <tr
                    key={l.id}
                    onClick={() => abrirConversa(l)}
                    className="border-t hairline cursor-pointer hover:bg-app-subtle/30 transition-colors"
                  >
                    <td className="p-4">
                      <p className="font-semibold">{l.name}</p>
                      <p className="text-xs text-sand-100/60 mt-0.5 flex items-center gap-1">
                        <Lock size={11} /> {(l as any).phoneMasked ?? l.phone ?? "—"}
                      </p>
                      <span className={`mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.62rem] font-semibold whitespace-nowrap ${chip.bg} ${chip.fg}`}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: chip.dot }} />
                        {chatStatusFromCounts(inbound, outbound)}
                      </span>
                    </td>
                    <td className="p-4 text-sand-100/75">{l.origin ?? "—"}</td>
                    <td className="p-4">
                      {l.status && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.65rem] font-semibold ${tone.bg} ${tone.fg} uppercase tracking-mono-wide`}>
                          {STATUS_LABEL[l.status]}
                        </span>
                      )}
                      {(inbound > 0 || outbound > 0) && (
                        <p className="text-[0.65rem] text-sand-100/55 mt-1 whitespace-nowrap">
                          ↓ {inbound} · ↑ {outbound}
                        </p>
                      )}
                    </td>
                    <td className="p-4 text-sand-100/60 text-xs">{timeAgo(l.createdAt)}</td>
                    <td className="p-4 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); void abrirConversa(l); }}
                        disabled={opening === l.id}
                        className="text-gold-300 hover:text-gold-200 text-[0.72rem] uppercase tracking-mono-wide font-semibold disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <MessageCircle size={12} />
                        {opening === l.id ? "Abrindo…" : "Abrir conversa →"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
