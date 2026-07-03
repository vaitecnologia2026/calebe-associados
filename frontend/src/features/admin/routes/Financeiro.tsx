// Financeiro (admin) — todas as comissões, com aprovar/marcar como paga
// Backend: GET /api/commissions (admin vê tudo) · PATCH /api/commissions/:id/status (admin)
// Serializado: { id, status, grossAmount, netAmount, dueDate, paidAt, paymentMethod, receiptUrl,
//                notes, sale: {code}, associate: {user: {name}} }
// Status enum: "pending" | "approved" | "paid"
import { useEffect, useMemo, useState } from "react";
import { Check, DollarSign, Download, RefreshCw, X, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { resolveBackendUrl } from "@/lib/media";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { KpiCard } from "../components/KpiCard";

type CommissionStatus = "pending" | "approved" | "paid";

interface Commission {
  id: string;
  status: CommissionStatus;
  grossAmount?: number | string;
  netAmount?: number | string;
  dueDate?: string | null;
  paidAt?: string | null;
  paymentMethod?: string | null;
  receiptUrl?: string | null;
  notes?: string | null;
  sale?: { code?: string };
  associate?: { user?: { name?: string } };
  createdAt?: string;
}

const STATUS_LABEL: Record<CommissionStatus, string> = {
  pending:  "Pendente",
  approved: "Aprovada",
  paid:     "Paga",
};
const STATUS_TONE: Record<CommissionStatus, "warning" | "info" | "success"> = {
  pending:  "warning",
  approved: "info",
  paid:     "success",
};

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
function fmtBRLCompact(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (n >= 1_000)     return `R$ ${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }); }
  catch { return "—"; }
}

export function Financeiro() {
  const [list, setList] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"" | CommissionStatus>("");
  const [corretorFilter, setCorretorFilter] = useState("");
  const [payModalFor, setPayModalFor] = useState<Commission | null>(null);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ data: Commission[] }>("/api/commissions");
      setList(r.data ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function changeStatus(id: string, status: CommissionStatus) {
    try {
      await api.patch(`/api/commissions/${id}/status`, { status });
      showToast(`Comissão marcada como ${STATUS_LABEL[status].toLowerCase()}`);
      void load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }

  const corretores = useMemo(
    () => [...new Set(list.map((c) => c.associate?.user?.name).filter(Boolean) as string[])].sort(),
    [list],
  );

  const filtered = useMemo(() => {
    return list.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (corretorFilter && c.associate?.user?.name !== corretorFilter) return false;
      return true;
    });
  }, [list, statusFilter, corretorFilter]);

  const yr = new Date().getFullYear();
  const stats = useMemo(() => {
    const sumNet = (status: CommissionStatus) =>
      list.filter((c) => c.status === status).reduce((a, c) => a + toNumber(c.netAmount ?? c.grossAmount), 0);
    const totalPendente = sumNet("pending");
    const totalAprovado = sumNet("approved");
    const totalPago = list
      .filter((c) => c.status === "paid" && c.paidAt && new Date(c.paidAt).getFullYear() === yr)
      .reduce((a, c) => a + toNumber(c.netAmount ?? c.grossAmount), 0);
    return { totalPendente, totalAprovado, totalPago, totalGeral: totalPendente + totalAprovado + totalPago };
  }, [list, yr]);

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Financeiro"
        description={`${list.length} comissões registradas · aprove e marque como pagas após confirmação do pagamento`}
        actions={<Button variant="outline" onClick={load} loading={loading}><RefreshCw size={14} /> Atualizar</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KpiCard label="Pendentes" value={fmtBRLCompact(stats.totalPendente)} hint={`${list.filter(c => c.status === "pending").length} aguardando`} accent="warning" />
        <KpiCard label="Aprovadas" value={fmtBRLCompact(stats.totalAprovado)} hint={`${list.filter(c => c.status === "approved").length} a pagar`} accent="info" />
        <KpiCard label={`Pagas em ${yr}`} value={fmtBRLCompact(stats.totalPago)} hint={`${list.filter(c => c.status === "paid").length} comissões`} accent="success" />
        <KpiCard label="Movimento total" value={fmtBRLCompact(stats.totalGeral)} accent="default" />
      </div>

      <div className="grid sm:grid-cols-[auto_auto] gap-2 mb-4">
        <select className="field-input text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | CommissionStatus)}>
          <option value="">Todos status</option>
          {(Object.keys(STATUS_LABEL) as CommissionStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select className="field-input text-sm" value={corretorFilter} onChange={(e) => setCorretorFilter(e.target.value)}>
          <option value="">Todos corretores</option>
          {corretores.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {payModalFor && (
        <PayCommissionModal
          commission={payModalFor}
          onClose={() => setPayModalFor(null)}
          onPaid={() => { setPayModalFor(null); void load(); }}
        />
      )}

      <div className="card overflow-x-auto" id="commissions-table">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
            <tr>
              <th className="text-left p-3">Venda</th>
              <th className="text-left p-3">Corretor</th>
              <th className="text-right p-3">Bruto</th>
              <th className="text-right p-3">Líquido</th>
              <th className="text-left p-3">Vencimento</th>
              <th className="text-left p-3">Pago em</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && list.length === 0 ? (
              <tr><td colSpan={8} className="p-10 text-center text-sand-100/55">Carregando…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="p-10 text-center text-sand-100/55">Nenhuma comissão encontrada.</td></tr>
            ) : filtered.map((c) => (
              <tr key={c.id} className="border-t hairline">
                <td className="p-3 font-mono text-xs">{c.sale?.code ?? c.id.slice(0, 8)}</td>
                <td className="p-3">{c.associate?.user?.name ?? "—"}</td>
                <td className="p-3 text-right tabular-nums">{fmtBRL(c.grossAmount)}</td>
                <td className="p-3 text-right tabular-nums text-gold-300 font-semibold">{fmtBRL(c.netAmount)}</td>
                <td className="p-3 text-xs">{fmtDate(c.dueDate)}</td>
                <td className="p-3 text-xs">{fmtDate(c.paidAt)}</td>
                <td className="p-3">
                  <div className="leading-tight">
                    <StatusPill tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</StatusPill>
                    {c.paymentMethod && (
                      <p className="text-[10px] text-sand-100/55 mt-1">{c.paymentMethod}</p>
                    )}
                  </div>
                </td>
                <td className="p-3 text-right">
                  <div className="inline-flex items-center gap-2">
                    {c.receiptUrl && (
                      <a
                        href={resolveBackendUrl(c.receiptUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-gold-300 hover:text-gold-200 inline-flex items-center gap-1"
                        title="Ver comprovante"
                      >
                        <Download size={12} />
                      </a>
                    )}
                    {c.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => void changeStatus(c.id, "approved")}
                        className="text-[0.7rem] uppercase tracking-mono-wide font-semibold text-blue-300 hover:text-blue-200 inline-flex items-center gap-1"
                        title="Aprovar"
                      >
                        <Check size={12} /> Aprovar
                      </button>
                    )}
                    {c.status === "approved" && (
                      <button
                        type="button"
                        onClick={() => setPayModalFor(c)}
                        className="text-[0.7rem] uppercase tracking-mono-wide font-semibold text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1"
                        title="Confirmar pagamento (anexa comprovante)"
                      >
                        <DollarSign size={12} /> Confirmar pagamento
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Modal de pagamento · POST /api/commissions/:id/pay (multipart)
// Campos backend: comprovante (file), dataPag (YYYY-MM-DD), paymentMethod, notes
function PayCommissionModal({ commission, onClose, onPaid }: {
  commission: Commission;
  onClose: () => void;
  onPaid: () => void;
}) {
  const showToast = useUi((s) => s.showToast);
  const [file, setFile] = useState<File | null>(null);
  const [dataPag, setDataPag] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { showToast("Anexe o comprovante (PDF ou imagem)"); return; }
    if (file.size > 10 * 1024 * 1024) { showToast("Arquivo > 10MB"); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("comprovante", file);
      if (dataPag) fd.append("dataPag", dataPag);
      if (paymentMethod.trim()) fd.append("paymentMethod", paymentMethod.trim());
      if (notes.trim()) fd.append("notes", notes.trim());
      await api.post(`/api/commissions/${commission.id}/pay`, fd);
      showToast("Pagamento confirmado");
      onPaid();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] calebe-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-app-canvas border hairline rounded-lg w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b hairline">
          <div>
            <p className="text-xs uppercase tracking-mono-wide font-semibold text-sand-100/55">Confirmar pagamento</p>
            <h2 className="font-bold text-lg">
              Venda {commission.sale?.code ?? commission.id.slice(0, 8)}
            </h2>
            <p className="text-xs text-sand-100/65 mt-0.5">
              {commission.associate?.user?.name} · {fmtBRL(commission.netAmount ?? commission.grossAmount)} líquido
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sand-100/55 hover:text-sand-50" aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={submit} className="p-5 space-y-3">
          <div>
            <label className="field-label">Comprovante (PDF, JPG, PNG) *</label>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
              className="block w-full text-sm text-sand-100/85 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-gold-400/15 file:text-gold-200 hover:file:bg-gold-400/25"
            />
            {file && (
              <p className="text-[11px] text-sand-100/55 mt-1">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="Data do pagamento"
              type="date"
              value={dataPag}
              onChange={(e) => setDataPag(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
            />
            <Field
              label="Forma de pagamento"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              placeholder="ex: Pix · TED · Boleto"
              maxLength={40}
            />
          </div>

          <div>
            <label className="field-label">Observações (opcional)</label>
            <textarea
              className="field-input text-sm"
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ex: pago via transferência interna"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t hairline">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" variant="gold" disabled={saving || !file}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <DollarSign size={14} />}
              {saving ? "Confirmando…" : "Confirmar pagamento"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
