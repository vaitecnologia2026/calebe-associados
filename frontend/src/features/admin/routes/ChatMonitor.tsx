// Monitoramento de conversas (admin) · porte com chunked render do W11
// Substitui renderAdmChatMonitor (linha 15308 do monólito)

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, RefreshCcw, Loader2, Eye, X as XIcon } from "lucide-react";
import { useConversations } from "@/store/conversations";
import { useUi } from "@/store/ui";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { KpiCard } from "../components/KpiCard";
import { getSlaMinutos, getSlaColor, formatTime } from "@/lib/format";
import { CHAT_STATUS, LEAD_TO_CHAT_STATUS, type ChatStatus } from "@/types/conversation";
import type { Conversation } from "@/types/conversation";
import { api } from "@/lib/api";
import { ChatStream } from "@/components/chat/ChatStream";

// Conversation não tem campo status próprio no backend — derivamos do lead.status.
// Se a conversa já vier com status setado (ex: adapter futuro), usa o que veio.
function convStatus(c: Conversation): ChatStatus | undefined {
  if (c.status) return c.status;
  const ls = c.lead?.status;
  return ls ? LEAD_TO_CHAT_STATUS[ls] : undefined;
}

export function ChatMonitor() {
  const list = useConversations((s) => s.list);
  const fetchList = useConversations((s) => s.fetchList);
  const registerSse = useConversations((s) => s.registerSse);

  const tab = useUi((s) => s.admChatTab);
  const filters = useUi((s) => s.admChatFilters);
  const setFilters = useUi((s) => s.setAdmChatFilters);
  const reset = useUi((s) => s.resetAdmChatFilters);
  const setTab = useUi((s) => s.setAdmChatTab);
  const rendered = useUi((s) => s.admChatRenderedCount);
  const loadMore = useUi((s) => s.admChatLoadMore);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void fetchList();
    const unsub = registerSse();
    return unsub;
  }, [fetchList, registerSse]);

  usePolling(() => fetchList(), { intervalMs: 30000, immediate: false });

  // Online dos corretores (lastSeen < 5min) · cruzado com /active-brokers
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await api.get<{ ranking: { userId: string; online: boolean }[] }>("/api/dashboards/active-brokers");
        if (!alive) return;
        setOnlineIds(new Set((r.ranking || []).filter((b) => b.online).map((b) => b.userId)));
      } catch { /* ignore */ }
    };
    void load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const filtered = useMemo(() => {
    const f = filters;
    return list.filter((c) => {
      const s = convStatus(c);
      const isClosed = s === "perdido" || s === "fechado" || s === "descartado";
      if (tab === "ativas" && isClosed) return false;
      if (tab === "fechadas" && !isClosed) return false;
      if (f.cliente && !(c.lead?.name ?? "").toLowerCase().includes(f.cliente)) return false;
      if (f.corretor && c.associate?.user?.name !== f.corretor) return false;
      if (f.status && s !== f.status) return false;
      if (f.periodo && f.periodo !== "todos") {
        const at = c.lastMessageAt ?? c.createdAt;
        const t = at ? new Date(at).getTime() : 0;
        const now = Date.now();
        const D = 86_400_000;
        const limite = f.periodo === "hoje" ? now - D : f.periodo === "7d" ? now - 7 * D : f.periodo === "30d" ? now - 30 * D : 0;
        if (t < limite) return false;
      }
      return true;
    });
  }, [list, tab, filters]);

  const sorted = useMemo(() => {
    return filtered.slice().sort((a, b) => {
      const aInb = a.lastMessage?.direction === "inbound" ? 1 : 0;
      const bInb = b.lastMessage?.direction === "inbound" ? 1 : 0;
      if (aInb !== bInb) return bInb - aInb;
      const aT = new Date(a.lastMessageAt ?? a.createdAt ?? 0).getTime();
      const bT = new Date(b.lastMessageAt ?? b.createdAt ?? 0).getTime();
      return bT - aT;
    });
  }, [filtered]);

  const visible = sorted.slice(0, rendered);
  const remaining = sorted.length - visible.length;

  const ativas = list.filter((c) => {
    const s = convStatus(c);
    return s !== "perdido" && s !== "fechado" && s !== "descartado";
  });
  const sla5 = ativas.filter((c) => getSlaMinutos(c) >= 5).length;
  const sla10 = ativas.filter((c) => getSlaMinutos(c) >= 10).length;
  const corretores = [...new Set(list.map((c) => c.associate?.user?.name).filter(Boolean) as string[])].sort();
  const showToast = useUi((s) => s.showToast);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Conversation | null>(null);
  const loadMessages = useConversations((s) => s.loadMessages);

  async function openConversation(c: Conversation) {
    setViewing(c);
    try { await loadMessages(c.id); }
    catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro ao carregar mensagens: ${msg}`);
    }
  }

  async function syncVai(convId: string) {
    setSyncing(convId);
    try {
      await api.post(`/api/conversations/${convId}/sync-vai`, {});
      showToast("Resync com VAI disparado");
      await fetchList();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setSyncing(null); }
  }

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6">
        <p className="meta-gold">Administração</p>
        <h1 className="text-3xl font-bold tracking-display-tight mt-1">Monitoramento de conversas</h1>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="🟢 Corretores online" value={onlineIds.size} accent="info" />
        <KpiCard label="Conversas ativas" value={ativas.length} accent="info" />
        <KpiCard label="Alerta SLA (5+min)" value={sla5} accent="warning" />
        <KpiCard label="Crítico (10+min)" value={sla10} accent="danger" />
        <KpiCard label="Total carregadas" value={list.length} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b hairline mb-4">
        <TabButton active={tab === "ativas"} onClick={() => setTab("ativas")}>Ativas</TabButton>
        <TabButton active={tab === "fechadas"} onClick={() => setTab("fechadas")}>Fechadas</TabButton>
      </div>

      {/* Filtros · 1col → 2col → 5col conforme tela cresce */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <input
          type="text"
          placeholder="Nome do lead"
          className="field-input text-sm"
          value={filters.cliente}
          onChange={(e) => setFilters({ cliente: e.target.value.trim().toLowerCase() })}
        />
        <select
          className="field-input text-sm"
          value={filters.corretor}
          onChange={(e) => setFilters({ corretor: e.target.value })}
        >
          <option value="">Todos os corretores</option>
          {corretores.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="field-input text-sm"
          value={filters.status}
          onChange={(e) => setFilters({ status: e.target.value })}
        >
          <option value="">Todos os status</option>
          {Object.entries(CHAT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select
          className="field-input text-sm"
          value={filters.periodo}
          onChange={(e) => setFilters({ periodo: e.target.value })}
        >
          <option value="todos">Todo período</option>
          <option value="hoje">Últimas 24h</option>
          <option value="7d">7 dias</option>
          <option value="30d">30 dias</option>
        </select>
        <button onClick={reset} className="btn-base btn-outline text-xs" style={{ padding: ".55rem 1rem" }}>
          Limpar
        </button>
      </div>

      <p className="text-xs text-sand-100/55 mb-2">
        {remaining > 0
          ? `${visible.length} de ${sorted.length} carregados · ${list.length} total`
          : `${sorted.length} de ${list.length} conversas`}
      </p>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
            <tr>
              <th className="text-left p-3">Lead</th>
              <th className="text-left p-3">Corretor</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">SLA</th>
              <th className="text-left p-3">Última msg</th>
              <th className="text-right p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => {
              const sla = getSlaMinutos(c);
              const slaCfg = getSlaColor(sla);
              const s = convStatus(c);
              const status = s ? CHAT_STATUS[s] : null;
              return (
                <tr key={c.id} className="border-t hairline hover:bg-app-subtle/30 cursor-pointer"
                    onClick={() => void openConversation(c)}>
                  <td className="p-3">
                    <p className="font-semibold">{c.lead?.name ?? "—"}</p>
                    <p className="text-[0.7rem] text-sand-100/55">{c.lead?.origin ?? ""}</p>
                  </td>
                  <td className="p-3">
                    {c.associate?.user?.id && onlineIds.has(c.associate.user.id) && (
                      <span title="Online agora" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#5FD1A8", marginRight: 6, boxShadow: "0 0 6px #5FD1A8" }} />
                    )}
                    {c.associate?.user?.name ?? "—"}
                  </td>
                  <td className="p-3">
                    {status && (
                      <span
                        className="text-[0.65rem] uppercase tracking-mono-wide font-bold px-2 py-1 rounded"
                        style={{ background: status.bg, color: status.color }}
                      >
                        {status.label}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className="inline-flex items-center text-xs font-semibold" style={{ color: slaCfg.color }}>
                      {sla}min
                    </span>
                  </td>
                  <td className="p-3 text-xs text-sand-100/55">{formatTime(c.lastMessageAt)}</td>
                  <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void openConversation(c)}
                        className="text-[0.7rem] uppercase tracking-mono-wide font-semibold text-gold-300 hover:text-gold-200 inline-flex items-center gap-1"
                        title="Abrir conversa e ver mensagens"
                      >
                        <Eye size={11} /> Abrir
                      </button>
                      <button
                        type="button"
                        onClick={() => void syncVai(c.id)}
                        disabled={syncing === c.id}
                        className="text-[0.7rem] uppercase tracking-mono-wide font-semibold text-sand-100/55 hover:text-gold-300 inline-flex items-center gap-1 disabled:opacity-50"
                        title="Forçar resync VAI · usar quando suspeitar dessincronia"
                      >
                        {syncing === c.id ? <Loader2 size={11} className="animate-spin" /> : <RefreshCcw size={11} />}
                        VAI
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {remaining > 0 && (
          <div className="p-3 text-center bg-app-subtle/20 border-t hairline">
            <button onClick={loadMore} className="btn-base btn-outline text-xs" style={{ padding: ".55rem 1.25rem" }}>
              <ChevronDown size={14} /> Carregar mais 200 ({remaining} restantes)
            </button>
          </div>
        )}
      </div>

      {/* Drawer · Visualizar conversa */}
      {viewing && (
        <ConversationDrawer
          conversation={viewing}
          onClose={() => setViewing(null)}
          onSyncVai={() => void syncVai(viewing.id)}
          syncing={syncing === viewing.id}
        />
      )}
    </div>
  );
}

function ConversationDrawer({ conversation, onClose, onSyncVai, syncing }: {
  conversation: Conversation;
  onClose: () => void;
  onSyncVai: () => void;
  syncing: boolean;
}) {
  // Pega a versão mais fresca do store · refresh quando SSE chega
  const fresh = useConversations((s) => s.list.find((c) => c.id === conversation.id)) ?? conversation;
  const messages = fresh.messages ?? [];
  const status = convStatus(fresh);
  const sla = getSlaMinutos(fresh);
  const slaCfg = getSlaColor(sla);
  return (
    <div className="fixed inset-0 z-[100] calebe-overlay flex items-stretch justify-end" onClick={onClose}>
      <div
        className="w-full md:max-w-2xl card overflow-hidden h-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b hairline flex items-start justify-between gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-mono-wide font-semibold text-sand-100/55">Conversa · {fresh.associate?.user?.name ?? "—"}</p>
            <h2 className="font-bold text-lg truncate">{fresh.lead?.name ?? "—"}</h2>
            <p className="text-xs text-sand-100/65 mt-0.5 inline-flex items-center gap-2 flex-wrap">
              {status && (
                <span
                  className="text-[0.6rem] uppercase tracking-mono-wide font-bold px-1.5 py-0.5 rounded"
                  style={{ background: CHAT_STATUS[status].bg, color: CHAT_STATUS[status].color }}
                >
                  {CHAT_STATUS[status].label}
                </span>
              )}
              <span style={{ color: slaCfg.color }} className="font-semibold">SLA {sla}min</span>
              <span className="text-sand-100/50">·</span>
              <span>{messages.length} mensagens</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onSyncVai}
              disabled={syncing}
              className="text-[0.7rem] uppercase tracking-mono-wide font-semibold text-sand-100/65 hover:text-gold-300 inline-flex items-center gap-1 disabled:opacity-50"
              title="Forçar resync VAI"
            >
              {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCcw size={11} />}
              VAI
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-sand-100/55 hover:text-sand-50"
              aria-label="Fechar"
              title="Fechar (Esc)"
            >
              <XIcon size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-hidden">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sand-100/55 text-sm">
              <Loader2 size={14} className="animate-spin mr-2" /> Carregando mensagens…
            </div>
          ) : (
            <ChatStream messages={messages} />
          )}
        </div>

        <footer className="px-5 py-3 border-t hairline shrink-0 bg-app-subtle/20">
          <p className="text-[11px] text-sand-100/55">
            Modo visualização (admin) · responder ao lead deve ser feito pelo corretor responsável.
          </p>
        </footer>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-xs uppercase tracking-mono-xwide font-semibold border-b-2 transition-colors ${
        active
          ? "text-sand-50 border-gold-400"
          : "text-sand-100/55 hover:text-sand-50 border-transparent"
      }`}
    >
      {children}
    </button>
  );
}
