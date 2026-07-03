// Financeiro corretor — backend GET /api/commissions filtra pelo associate automaticamente.
// Response serializado: { id, status, grossAmount, netAmount, dueDate, paidAt, paymentMethod,
//   receiptUrl?, notes?, sale: { code }, associate: { user: { name } }, createdAt }
// Status enum: "pending" | "approved" | "paid"  (lowercase no backend, commissions.js)
import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { StatusPill } from "@/components/ui/StatusPill";
import { fmtBRLCompact } from "@/lib/format";

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
function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }); }
  catch { return "—"; }
}

export function CorretorFinanceiro() {
  const [list, setList] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(false);
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const r = await api.get<{ data: Commission[] }>("/api/commissions");
        setList(r.data ?? []);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(`Erro: ${msg}`);
      } finally { setLoading(false); }
    })();
  }, [showToast]);

  const yr = new Date().getFullYear();
  const stats = useMemo(() => {
    // A receber = pending + approved (aprovada mas não paga)
    const aReceber = list
      .filter((c) => c.status === "pending" || c.status === "approved")
      .reduce((a, c) => a + toNumber(c.netAmount ?? c.grossAmount), 0);
    // Recebido no ano = paid e paidAt no ano corrente
    const recebidoAno = list
      .filter((c) => c.status === "paid" && c.paidAt && new Date(c.paidAt).getFullYear() === yr)
      .reduce((a, c) => a + toNumber(c.netAmount ?? c.grossAmount), 0);
    // Ticket médio das pagas
    const pagas = list.filter((c) => c.status === "paid");
    const ticketMedio = pagas.length
      ? pagas.reduce((a, c) => a + toNumber(c.netAmount ?? c.grossAmount), 0) / pagas.length
      : 0;
    return { aReceber, recebidoAno, ticketMedio, totalPagas: pagas.length };
  }, [list, yr]);

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <header className="mb-6">
        <p className="meta-gold">Comissões</p>
        <h1 className="text-2xl md:text-3xl font-bold tracking-display-tight mt-1">Financeiro</h1>
        <p className="text-sm text-sand-100/65 mt-1">
          Acompanhe suas comissões: pendentes (aguardando aprovação), aprovadas (aguardando pagamento) e pagas (com comprovante).
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 lg:gap-4 mb-5">
        <Kpi label="A receber" value={fmtBRLCompact(stats.aReceber)} />
        <Kpi label={`Recebido em ${yr}`} value={fmtBRLCompact(stats.recebidoAno)} />
        <Kpi label="Ticket médio" value={fmtBRLCompact(stats.ticketMedio)} hint={stats.totalPagas > 0 ? `${stats.totalPagas} venda${stats.totalPagas === 1 ? "" : "s"} paga${stats.totalPagas === 1 ? "" : "s"}` : ""} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
            <tr>
              <th className="text-left p-3">Venda</th>
              <th className="text-right p-3">Bruto</th>
              <th className="text-right p-3">Líquido</th>
              <th className="text-left p-3">Vencimento</th>
              <th className="text-left p-3">Pago em</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3">Comprovante</th>
            </tr>
          </thead>
          <tbody>
            {loading && list.length === 0 ? (
              <tr><td colSpan={7} className="p-10 text-center text-sand-100/55">Carregando…</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={7} className="p-10 text-center text-sand-100/55">Nenhuma comissão registrada.</td></tr>
            ) : list.map((c) => (
              <tr key={c.id} className="border-t hairline">
                <td className="p-3 font-mono text-xs">{c.sale?.code ?? c.id.slice(0, 8)}</td>
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
                  {c.receiptUrl ? (
                    <a
                      href={c.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-gold-300 hover:text-gold-200"
                    >
                      <Download size={12} /> Ver
                    </a>
                  ) : <span className="text-sand-100/40 text-xs">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-[0.62rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">{label}</p>
      <p className="text-2xl md:text-[2rem] font-display font-light tracking-[-0.03em] mt-1 leading-tight">{value}</p>
      {hint && <p className="text-xs text-sand-100/55 mt-1">{hint}</p>}
    </div>
  );
}
