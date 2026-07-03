// Liberação de Telefone (admin) — corretor solicita libertar o tel do lead pra
// fechar a venda. Backend: GET /api/phone-release · POST /:id/approve|deny.
// Quando aprovada: Conversation.phoneReleased = true + SSE pro corretor.
import { useEffect, useMemo, useState } from "react";
import { Check, X as XIcon, RefreshCw, Phone, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { KpiCard } from "../components/KpiCard";

type Status = "PENDING" | "APPROVED" | "DENIED";

interface Request {
  id: string;
  conversationId: string;
  leadId: string;
  requestedById: string;
  justification: string;
  status: Status;
  decidedById?: string | null;
  decisionNote?: string | null;
  decidedAt?: string | null;
  createdAt: string;
  // Enriquecidos pelo backend
  lead?:    { id: string; name: string; phoneMasked?: string; phone?: string };
  requester?: { id: string; name: string; email: string };
}
interface Resp { data: Request[] }

function fmtPhone(phone?: string | null): string {
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

function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return "—"; }
}

const STATUS_LABEL: Record<Status, string> = {
  PENDING: "Pendente", APPROVED: "Aprovada", DENIED: "Negada",
};
const STATUS_TONE: Record<Status, "warning" | "success" | "danger"> = {
  PENDING: "warning", APPROVED: "success", DENIED: "danger",
};

export function LiberacaoTelefone() {
  const [list, setList] = useState<Request[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"" | Status>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<Resp>("/api/phone-release");
      setList(r.data ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function approve(id: string) {
    setBusyId(id);
    try {
      await api.post(`/api/phone-release/${id}/approve`, {});
      showToast("Liberação aprovada · corretor notificado");
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setBusyId(null); }
  }
  async function deny(id: string) {
    const note = prompt("Motivo da negação (opcional, fica no histórico):");
    if (note === null) return; // cancelou
    setBusyId(id);
    try {
      await api.post(`/api/phone-release/${id}/deny`, note ? { note: note.trim() } : {});
      showToast("Liberação negada");
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setBusyId(null); }
  }

  const counts = useMemo(() => ({
    total:    list.length,
    pending:  list.filter((r) => r.status === "PENDING").length,
    approved: list.filter((r) => r.status === "APPROVED").length,
    denied:   list.filter((r) => r.status === "DENIED").length,
  }), [list]);

  const filtered = useMemo(() => {
    if (!filter) return list;
    return list.filter((r) => r.status === filter);
  }, [list, filter]);

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Liberação de telefone"
        description={`Corretores solicitam liberar o telefone real do lead pra fechar venda · ${counts.pending} pendente${counts.pending === 1 ? "" : "s"}`}
        actions={<Button variant="outline" onClick={load} loading={loading}><RefreshCw size={14} /> Atualizar</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KpiCard label="Total" value={counts.total} />
        <KpiCard label="Pendentes" value={counts.pending} accent={counts.pending > 0 ? "warning" : "default"} />
        <KpiCard label="Aprovadas" value={counts.approved} accent="success" />
        <KpiCard label="Negadas" value={counts.denied} accent="danger" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(["", "PENDING", "APPROVED", "DENIED"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s as "" | Status)}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              filter === s
                ? "bg-gold-400/15 text-gold-300 border-gold-400/40"
                : "border-sand-100/15 text-sand-100/65 hover:border-sand-100/35"
            }`}
          >
            {s === "" ? `Todas (${counts.total})` : `${STATUS_LABEL[s as Status]} (${(counts as Record<string, number>)[s.toLowerCase()]})`}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {loading && list.length === 0 ? (
          <div className="card p-10 text-center text-sand-100/55">Carregando…</div>
        ) : filtered.length === 0 ? (
          <div className="card p-10 text-center text-sand-100/55">Nenhuma solicitação.</div>
        ) : filtered.map((r) => (
          <article key={r.id} className="card p-4">
            <div className="flex flex-wrap justify-between items-start gap-3 mb-3">
              <div className="min-w-0">
                <p className="font-semibold text-sand-50 inline-flex items-center gap-2 flex-wrap">
                  <Phone size={14} className="text-gold-400" />
                  Lead <span className="text-gold-300">{r.lead?.name ?? "—"}</span>
                  {(r.lead?.phone || r.lead?.phoneMasked) && (
                    <span className="text-xs text-sand-100/55 font-mono">
                      {fmtPhone(r.lead.phone) || r.lead.phoneMasked}
                    </span>
                  )}
                </p>
                <p className="text-xs text-sand-100/60 mt-1">
                  Solicitado por <strong className="text-sand-100/85">{r.requester?.name ?? "—"}</strong>
                  {" · "}
                  {fmtDateTime(r.createdAt)}
                </p>
              </div>
              <StatusPill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill>
            </div>

            <div className="bg-app-subtle/40 border hairline rounded p-3 mb-3">
              <p className="text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-gold-400/80 mb-1 inline-flex items-center gap-1.5">
                <MessageSquare size={11} /> Justificativa do corretor
              </p>
              <p className="text-sm text-sand-100/85 whitespace-pre-wrap leading-snug">{r.justification}</p>
            </div>

            {r.status !== "PENDING" && (
              <div className="text-xs text-sand-100/60 mb-3">
                Decidido em {fmtDateTime(r.decidedAt)}
                {r.decisionNote && (
                  <span className="block mt-1 text-red-300/85">
                    <strong>Nota:</strong> {r.decisionNote}
                  </span>
                )}
              </div>
            )}

            {r.status === "PENDING" && (
              <div className="flex gap-2 justify-end">
                <Button
                  variant="danger"
                  onClick={() => void deny(r.id)}
                  disabled={busyId === r.id}
                  style={{ padding: ".4rem .8rem", fontSize: ".75rem" }}
                >
                  <XIcon size={13} /> Negar
                </Button>
                <Button
                  variant="gold"
                  onClick={() => void approve(r.id)}
                  loading={busyId === r.id}
                  style={{ padding: ".4rem .8rem", fontSize: ".75rem" }}
                >
                  <Check size={13} /> Aprovar e liberar
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
