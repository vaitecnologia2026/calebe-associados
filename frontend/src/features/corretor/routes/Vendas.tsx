// Vendas do corretor — GET /api/sales (backend já filtra pelo associate logado)
// Mesma SaleStatus enum + mapa do admin Vendas.
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { fmtBRLCompact } from "@/lib/format";
import { NovaVendaModal } from "../components/NovaVendaModal";

type SaleStatus = "DRAFT" | "SUBMITTED" | "IN_ANALYSIS" | "DRAFTING" | "SIGNING" | "APPROVED" | "DENIED";

interface Sale {
  id: string;
  code?: string;
  clientName?: string;
  finalValue?: number | string;
  status?: SaleStatus;
  createdAt?: string;
  submittedAt?: string;
  approvedAt?: string;
  denialReason?: string;
  property?: { code?: string; title?: string };
}

const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  DRAFT:       "Rascunho",
  SUBMITTED:   "Em jurídico",
  IN_ANALYSIS: "Em análise",
  DRAFTING:    "Em elaboração",
  SIGNING:     "Em assinatura",
  APPROVED:    "Concluída",
  DENIED:      "Negada",
};
const SALE_STATUS_TONE: Record<SaleStatus, "neutral" | "info" | "gold" | "warning" | "success" | "danger"> = {
  DRAFT:       "neutral",
  SUBMITTED:   "info",
  IN_ANALYSIS: "info",
  DRAFTING:    "gold",
  SIGNING:     "warning",
  APPROVED:    "success",
  DENIED:      "danger",
};

const JURIDICO_STATUSES: SaleStatus[] = ["SUBMITTED", "IN_ANALYSIS", "DRAFTING", "SIGNING"];

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

export function CorretorVendas() {
  const [list, setList] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ data: Sale[] }>("/api/sales?limit=200");
      setList(r.data ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const stats = useMemo(() => {
    const yr = new Date().getFullYear();
    const rascunho = list.filter((s) => s.status === "DRAFT").length;
    const juridico = list.filter((s) => s.status && JURIDICO_STATUSES.includes(s.status)).length;
    const conc     = list.filter((s) => s.status === "APPROVED").length;
    const totalAno = list.reduce((acc, s) => {
      if (s.status !== "APPROVED") return acc;
      if (s.createdAt && new Date(s.createdAt).getFullYear() !== yr) return acc;
      return acc + toNumber(s.finalValue);
    }, 0);
    return { rascunho, juridico, conc, totalAno };
  }, [list]);

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap justify-between items-end gap-3">
        <div>
          <p className="meta-gold">Pipeline</p>
          <h1 className="text-2xl md:text-3xl font-bold tracking-display-tight mt-1">Minhas vendas</h1>
        </div>
        <Button variant="gold" style={{ padding: ".55rem 1.25rem" }} onClick={() => setModalOpen(true)}>
          <Plus size={14} /> Registrar Venda
        </Button>
      </header>

      <NovaVendaModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); void load(); }}
      />


      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4 mb-5">
        <Kpi label="Em rascunho" value={stats.rascunho} />
        <Kpi label="Em jurídico" value={stats.juridico} />
        <Kpi label="Concluídas"  value={stats.conc} />
        <Kpi label={`Total ${new Date().getFullYear()}`} value={fmtBRLCompact(stats.totalAno)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
            <tr>
              <th className="text-left p-3">#</th>
              <th className="text-left p-3">Imóvel</th>
              <th className="text-left p-3">Cliente</th>
              <th className="text-left p-3">Valor</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3">Enviada</th>
            </tr>
          </thead>
          <tbody>
            {loading && list.length === 0 ? (
              <tr><td colSpan={6} className="p-10 text-center text-sand-100/55">Carregando…</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={6} className="p-10 text-center text-sand-100/55">Nenhuma venda registrada.</td></tr>
            ) : list.map((s, i) => {
              const st = s.status;
              return (
                <tr key={s.id} className="border-t hairline">
                  <td className="p-3 text-sand-100/55 font-mono text-xs">{s.code ?? String(i + 1).padStart(3, "0")}</td>
                  <td className="p-3">
                    {s.property?.code ? (
                      <div>
                        <p className="font-mono text-xs">{s.property.code}</p>
                        {s.property.title && <p className="text-xs text-sand-100/55">{s.property.title}</p>}
                      </div>
                    ) : "—"}
                  </td>
                  <td className="p-3 font-semibold">{s.clientName ?? "—"}</td>
                  <td className="p-3 font-medium tabular-nums">{fmtBRL(s.finalValue)}</td>
                  <td className="p-3">
                    {st ? (
                      <div className="leading-tight">
                        <StatusPill tone={SALE_STATUS_TONE[st]}>{SALE_STATUS_LABEL[st]}</StatusPill>
                        {st === "DENIED" && s.denialReason?.trim() && (
                          <p className="text-[10px] mt-1 text-red-300/90 max-w-[200px]" title={s.denialReason}>
                            {s.denialReason.length > 60 ? s.denialReason.slice(0, 60) + "…" : s.denialReason}
                          </p>
                        )}
                      </div>
                    ) : <StatusPill tone="neutral">—</StatusPill>}
                  </td>
                  <td className="p-3 text-right text-xs text-sand-100/55">
                    {s.createdAt
                      ? new Date(s.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card p-4">
      <p className="text-[0.62rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">{label}</p>
      <p className="text-2xl md:text-[2rem] font-display font-light tracking-[-0.03em] mt-1 leading-tight">{value}</p>
    </div>
  );
}
