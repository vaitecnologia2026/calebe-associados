// Suporte interno · F1 Éder
// 2 abas:
//   - Recebidos: pedidos onde o user logado é o suporte (assistantUserId)
//   - Enviados:  pedidos feitos pelo user logado (requestedById)
// Backend: GET /api/assists?status=&as= · PATCH /:id/resolve · PATCH /:id/cancel
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, MessageCircle, Check, X, CircleAlert, Inbox, Send } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";

type AssistStatus = "PENDING" | "RESOLVED" | "CANCELLED";
type Tab = "received" | "sent";

interface Assist {
  id: string;
  status: AssistStatus;
  type: string;
  justification?: string | null;
  conversationId: string;
  createdAt?: string;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  conversation?: {
    id: string;
    lead?: { id: string; name?: string; phoneMasked?: string; segment?: string };
    associate?: { user?: { id: string; name?: string } };
  };
  requestedBy?: { id: string; name?: string; email?: string };
  assistant?: { id: string; name?: string; email?: string };
}

const STATUS_LABEL: Record<AssistStatus, string> = {
  PENDING:   "Em aberto",
  RESOLVED:  "Resolvido",
  CANCELLED: "Cancelado",
};
const STATUS_TONE: Record<AssistStatus, string> = {
  PENDING:   "text-amber-300 bg-amber-500/10 border-amber-500/30",
  RESOLVED:  "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  CANCELLED: "text-sand-100/55 bg-app-subtle/40 border-app-subtle",
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return iso.slice(0, 19); }
}

export function CorretorSuporte() {
  const [tab, setTab] = useState<Tab>("received");
  const [statusFilter, setStatusFilter] = useState<"PENDING" | "ALL">("PENDING");
  const [list, setList] = useState<Assist[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const showToast = useUi((s) => s.showToast);
  const nav = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const asQ = tab === "received" ? "mine_to_handle" : "mine_requested";
      const r = await api.get<{ data: Assist[]; total: number }>(`/api/assists?status=${statusFilter}&as=${asQ}`);
      setList(r.data ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, statusFilter]);

  async function resolve(a: Assist) {
    const note = window.prompt("Nota de resolução (opcional):") ?? "";
    setActing(a.id);
    try {
      await api.patch(`/api/assists/${a.id}/resolve`, note.trim() ? { note: note.trim() } : {});
      showToast("Pedido resolvido");
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setActing(null); }
  }

  async function cancel(a: Assist) {
    if (!confirm("Cancelar este pedido?")) return;
    setActing(a.id);
    try {
      await api.patch(`/api/assists/${a.id}/cancel`, {});
      showToast("Pedido cancelado");
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setActing(null); }
  }

  function openConv(convId: string) {
    nav(`/corretor/chat/conv/${convId}`);
  }

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Suporte interno"
        description="Pedidos de ajuda em conversas · suporte (Éder) recebe · corretor pode enviar"
        actions={<Button variant="outline" onClick={load} loading={loading}><RefreshCw size={14} /> Atualizar</Button>}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex gap-1 border-b hairline">
          <TabBtn active={tab === "received"} onClick={() => setTab("received")}>
            <Inbox size={13} className="inline -mt-0.5 mr-1" /> Recebidos
          </TabBtn>
          <TabBtn active={tab === "sent"} onClick={() => setTab("sent")}>
            <Send size={13} className="inline -mt-0.5 mr-1" /> Enviados
          </TabBtn>
        </div>
        <select className="field-input text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "PENDING" | "ALL")}>
          <option value="PENDING">Em aberto</option>
          <option value="ALL">Todos status</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {loading && list.length === 0 ? (
          <p className="p-10 text-center text-sand-100/55 text-sm">Carregando…</p>
        ) : list.length === 0 ? (
          <p className="p-10 text-center text-sand-100/55 text-sm">
            {tab === "received"
              ? "Nenhum pedido pendente pra você. (Se você não é suporte interno, esta aba fica vazia.)"
              : "Você não enviou pedidos no período selecionado."}
          </p>
        ) : (
          <ul className="divide-y hairline">
            {list.map((a) => (
              <li key={a.id} className="p-4 hover:bg-app-subtle/30 transition-colors">
                <div className="flex items-start gap-3 flex-wrap">
                  <CircleAlert size={18} className="text-amber-300 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-[10px] uppercase tracking-mono-wide font-bold px-1.5 py-0.5 rounded border ${STATUS_TONE[a.status]}`}>
                        {STATUS_LABEL[a.status] ?? a.status}
                      </span>
                      <span className="text-[10px] uppercase tracking-mono-wide font-semibold text-gold-300 bg-gold-400/15 border border-gold-400/30 px-1.5 py-0.5 rounded">
                        {a.type}
                      </span>
                      <span className="text-[10px] text-sand-100/55">{fmtDate(a.createdAt)}</span>
                    </div>
                    <p className="font-semibold">
                      Lead: {a.conversation?.lead?.name ?? "—"}
                      {a.conversation?.lead?.phoneMasked && (
                        <span className="ml-2 text-xs text-sand-100/55 font-mono">{a.conversation.lead.phoneMasked}</span>
                      )}
                    </p>
                    <p className="text-xs text-sand-100/65 mt-0.5">
                      {tab === "received" ? (
                        <>Solicitante: <strong>{a.requestedBy?.name ?? "—"}</strong></>
                      ) : (
                        <>Suporte: <strong>{a.assistant?.name ?? "—"}</strong></>
                      )}
                    </p>
                    {a.justification && (
                      <p className="text-sm text-sand-100/85 mt-2 bg-app-subtle/40 rounded p-2 border hairline">{a.justification}</p>
                    )}
                    {a.resolutionNote && (
                      <p className="text-xs text-emerald-200 mt-2 bg-emerald-500/10 rounded p-2 border border-emerald-500/30">
                        Resolução: {a.resolutionNote}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openConv(a.conversationId)}
                      className="text-[0.7rem] uppercase tracking-mono-wide font-semibold text-sand-50 hover:text-gold-300 inline-flex items-center gap-1"
                      title="Abrir conversa"
                    >
                      <MessageCircle size={12} /> Abrir chat
                    </button>
                    {a.status === "PENDING" && tab === "received" && (
                      <button
                        type="button"
                        onClick={() => void resolve(a)}
                        disabled={acting === a.id}
                        className="text-[0.7rem] uppercase tracking-mono-wide font-semibold text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Check size={12} /> Resolver
                      </button>
                    )}
                    {a.status === "PENDING" && tab === "sent" && (
                      <button
                        type="button"
                        onClick={() => void cancel(a)}
                        disabled={acting === a.id}
                        className="text-[0.7rem] uppercase tracking-mono-wide font-semibold text-red-300 hover:text-red-200 inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <X size={12} /> Cancelar
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-xs uppercase tracking-mono-xwide font-semibold border-b-2 transition-colors ${
        active ? "text-sand-50 border-gold-400" : "text-sand-100/55 hover:text-sand-50 border-transparent"
      }`}
    >
      {children}
    </button>
  );
}
