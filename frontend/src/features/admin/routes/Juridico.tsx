// Jurídico (admin/legal) — Kanban de contratos por status do funil jurídico
// Backend: GET /api/legal (requireRole LEGAL|ADMIN) · PATCH /api/legal/:id/status
// SaleStatus enum no funil: SUBMITTED | IN_ANALYSIS | DRAFTING | SIGNING | APPROVED | DENIED
// PATCH aceita: IN_ANALYSIS | DRAFTING | SIGNING | APPROVED | DENIED (+ reason opcional)
// APPROVED dispara criação automática de comissão (backend ensureCommissionForSale).
import { useEffect, useMemo, useState } from "react";
import { Check, X as XIcon, RefreshCw, FileText, Calendar } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/Button";

type SaleStatus = "SUBMITTED" | "IN_ANALYSIS" | "DRAFTING" | "SIGNING" | "APPROVED" | "DENIED";
type LegalStatus = "IN_ANALYSIS" | "DRAFTING" | "SIGNING" | "APPROVED" | "DENIED";

interface SaleDoc {
  id: string;
  docType: string;
  fileKey: string;
  uploadedAt: string;
}

interface LegalCase {
  id: string;
  code?: string;
  clientName?: string;
  finalValue?: number | string;
  status: SaleStatus;
  submittedAt?: string;
  approvedAt?: string;
  denialReason?: string;
  paymentConditions?: string;
  documents?: SaleDoc[];
  property?: { code?: string; title?: string };
  associate?: { user?: { name?: string } };
}

// 4 colunas do Kanban
const COLUMNS: { id: SaleStatus; label: string; color: string; nextActions: { label: string; status: LegalStatus; tone: "info" | "warning" | "success" | "danger" }[] }[] = [
  {
    id: "SUBMITTED",
    label: "Recebido",
    color: "border-blue-400/30",
    nextActions: [
      { label: "Iniciar análise", status: "IN_ANALYSIS", tone: "warning" },
      { label: "Negar",             status: "DENIED",      tone: "danger" },
    ],
  },
  {
    id: "IN_ANALYSIS",
    label: "Em análise",
    color: "border-orange-400/30",
    nextActions: [
      { label: "Elaborar contrato", status: "DRAFTING", tone: "warning" },
      { label: "Negar",             status: "DENIED",   tone: "danger" },
    ],
  },
  {
    id: "DRAFTING",
    label: "Em elaboração",
    color: "border-gold-400/30",
    nextActions: [
      { label: "Enviar pra assinatura", status: "SIGNING", tone: "warning" },
      { label: "Negar",                 status: "DENIED",  tone: "danger" },
    ],
  },
  {
    id: "SIGNING",
    label: "Em assinatura",
    color: "border-emerald-400/30",
    nextActions: [
      { label: "Aprovar (cria comissão)", status: "APPROVED", tone: "success" },
      { label: "Negar",                   status: "DENIED",   tone: "danger" },
    ],
  },
];

function toNumber(v: number | string | undefined | null): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function fmtBRL(v: number | string | undefined | null): string {
  const n = toNumber(v);
  if (n === 0) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }); }
  catch { return "—"; }
}

export function Juridico() {
  const [items, setItems] = useState<LegalCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ data: LegalCase[] }>("/api/legal?limit=200");
      setItems(r.data ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function changeStatus(id: string, status: LegalStatus) {
    let reason: string | undefined;
    if (status === "DENIED") {
      const r = prompt("Motivo da negação:");
      if (!r?.trim()) return;
      reason = r.trim();
    }
    try {
      await api.patch(`/api/legal/${id}/status`, { status, reason });
      const label = status === "APPROVED" ? "Aprovado · comissão criada"
                   : status === "DENIED"   ? "Negado"
                   : `Status alterado pra ${status}`;
      showToast(label);
      void load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }

  const grouped = useMemo(() => {
    const acc: Record<SaleStatus, LegalCase[]> = {
      SUBMITTED: [], IN_ANALYSIS: [], DRAFTING: [], SIGNING: [], APPROVED: [], DENIED: [],
    };
    for (const c of items) {
      if (c.status in acc) acc[c.status].push(c);
    }
    return acc;
  }, [items]);

  const counts = useMemo(() => ({
    total:    items.length,
    inFlight: items.filter((c) => c.status !== "APPROVED" && c.status !== "DENIED").length,
    approved: grouped.APPROVED.length,
    denied:   grouped.DENIED.length,
  }), [items, grouped]);

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Jurídico"
        description={`Kanban de contratos · ${counts.inFlight} em tramitação · ${counts.approved} aprovados · ${counts.denied} negados`}
        actions={
          <>
            <Button variant={view === "kanban" ? "gold" : "outline"} onClick={() => setView("kanban")}>Kanban</Button>
            <Button variant={view === "lista" ? "gold" : "outline"} onClick={() => setView("lista")}>Lista</Button>
            <Button variant="outline" onClick={load} loading={loading}><RefreshCw size={14} /> Atualizar</Button>
          </>
        }
      />

      {loading && items.length === 0 ? (
        <div className="card p-10 text-center text-sand-100/55">Carregando…</div>
      ) : view === "kanban" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {COLUMNS.map((col) => (
            <div key={col.id} className={`card p-3 ${col.color}`}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[0.7rem] uppercase tracking-mono-xwide font-bold text-sand-100/75">{col.label}</p>
                <span className="text-[0.7rem] font-mono text-sand-100/55 px-2 py-0.5 rounded bg-app-subtle/50">{grouped[col.id].length}</span>
              </div>
              <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
                {grouped[col.id].length === 0 ? (
                  <p className="text-xs text-sand-100/40 italic text-center py-4">Vazio</p>
                ) : grouped[col.id].map((c) => <LegalCaseCard key={c.id} c={c} actions={col.nextActions} onAction={changeStatus} />)}
              </div>
            </div>
          ))}

          {(grouped.APPROVED.length > 0 || grouped.DENIED.length > 0) && (
            <div className="md:col-span-2 xl:col-span-4 grid sm:grid-cols-2 gap-3 mt-2">
              <div className="card p-3 border-emerald-400/30">
                <p className="text-[0.7rem] uppercase tracking-mono-xwide font-bold text-emerald-300 mb-3 inline-flex items-center gap-1.5"><Check size={11} /> Aprovados ({grouped.APPROVED.length})</p>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {grouped.APPROVED.length === 0 ? (
                    <p className="text-xs text-sand-100/40 italic text-center py-4">Nenhum aprovado ainda</p>
                  ) : grouped.APPROVED.map((c) => <LegalCaseCard key={c.id} c={c} actions={[]} onAction={changeStatus} terminal />)}
                </div>
              </div>
              <div className="card p-3 border-red-400/30">
                <p className="text-[0.7rem] uppercase tracking-mono-xwide font-bold text-red-300 mb-3 inline-flex items-center gap-1.5"><XIcon size={11} /> Negados ({grouped.DENIED.length})</p>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {grouped.DENIED.length === 0 ? (
                    <p className="text-xs text-sand-100/40 italic text-center py-4">Nenhum negado</p>
                  ) : grouped.DENIED.map((c) => <LegalCaseCard key={c.id} c={c} actions={[]} onAction={changeStatus} terminal />)}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        // Lista
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
              <tr>
                <th className="text-left p-3">Venda</th>
                <th className="text-left p-3">Cliente</th>
                <th className="text-left p-3">Imóvel</th>
                <th className="text-left p-3">Corretor</th>
                <th className="text-right p-3">Valor</th>
                <th className="text-left p-3">Enviada</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={7} className="p-10 text-center text-sand-100/55">Nenhum contrato em tramitação.</td></tr>
              ) : items.map((c) => (
                <tr key={c.id} className="border-t hairline">
                  <td className="p-3 font-mono text-xs">{c.code ?? c.id.slice(0, 8)}</td>
                  <td className="p-3 font-semibold">{c.clientName ?? "—"}</td>
                  <td className="p-3">
                    {c.property?.code ? (
                      <div className="leading-tight">
                        <p className="font-mono text-xs">{c.property.code}</p>
                        {c.property.title && <p className="text-xs text-sand-100/55">{c.property.title}</p>}
                      </div>
                    ) : "—"}
                  </td>
                  <td className="p-3">{c.associate?.user?.name ?? "—"}</td>
                  <td className="p-3 text-right tabular-nums text-gold-300 font-semibold">{fmtBRL(c.finalValue)}</td>
                  <td className="p-3 text-xs">{fmtDate(c.submittedAt)}</td>
                  <td className="p-3">
                    <StatusPill tone={c.status === "APPROVED" ? "success" : c.status === "DENIED" ? "danger" : "gold"}>
                      {COLUMNS.find((cc) => cc.id === c.status)?.label
                        ?? (c.status === "APPROVED" ? "Aprovado" : c.status === "DENIED" ? "Negado" : c.status)}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Card de contrato no Kanban
// =========================================================================
function LegalCaseCard({ c, actions, onAction, terminal }: {
  c: LegalCase;
  actions: { label: string; status: LegalStatus; tone: "info" | "warning" | "success" | "danger" }[];
  onAction: (id: string, status: LegalStatus) => void | Promise<void>;
  terminal?: boolean;
}) {
  const docsCount = c.documents?.length ?? 0;
  return (
    <div className="bg-app-subtle/30 border hairline rounded p-2.5 hover:border-gold-400/40 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="font-mono text-[0.65rem] text-gold-300 truncate">{c.code ?? c.id.slice(0, 8)}</p>
        {docsCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[0.6rem] text-sand-100/55" title={`${docsCount} documento(s) anexado(s)`}>
            <FileText size={10} /> {docsCount}
          </span>
        )}
      </div>
      <p className="text-xs font-semibold text-sand-50 truncate">{c.clientName ?? "—"}</p>
      <p className="text-[0.65rem] text-sand-100/60 truncate">
        {c.property?.code && <span className="font-mono">{c.property.code} · </span>}
        {c.associate?.user?.name ?? "—"}
      </p>
      <p className="text-xs font-semibold text-gold-300 tabular-nums mt-1">{fmtBRL(c.finalValue)}</p>

      {c.submittedAt && (
        <p className="text-[0.6rem] text-sand-100/45 mt-1 inline-flex items-center gap-1">
          <Calendar size={9} /> {fmtDate(c.submittedAt)}
        </p>
      )}

      {terminal && c.status === "DENIED" && c.denialReason && (
        <p className="text-[0.6rem] text-red-300/80 mt-1.5 line-clamp-2" title={c.denialReason}>
          <span className="font-semibold">Motivo:</span> {c.denialReason}
        </p>
      )}

      {!terminal && actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-white/5">
          {actions.map((a) => (
            <button
              key={a.status}
              type="button"
              onClick={() => void onAction(c.id, a.status)}
              className={`text-[0.6rem] uppercase tracking-mono-wide font-semibold inline-flex items-center gap-0.5 ${
                a.tone === "success" ? "text-emerald-300 hover:text-emerald-200"
                : a.tone === "danger" ? "text-red-300 hover:text-red-200"
                : "text-gold-300 hover:text-gold-200"
              }`}
              title={a.label}
            >
              {a.tone === "success" ? <Check size={10} /> : a.tone === "danger" ? <XIcon size={10} /> : null}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
