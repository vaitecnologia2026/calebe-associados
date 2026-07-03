// Vendas (admin) — porte do legacy /api/sales
// Backend: GET /api/sales?limit=200 retorna SaleStatus enum + clientName + finalValue
//          + property{code,title} + associate{user{name}}. Commission é endpoint à parte.
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusPill } from "@/components/ui/StatusPill";
import { KpiCard } from "../components/KpiCard";

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
  associate?: { user?: { name?: string } };
}

const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  DRAFT:       "Rascunho",
  SUBMITTED:   "Em jurídico",
  IN_ANALYSIS: "Em análise",
  DRAFTING:    "Em elaboração",
  SIGNING:     "Em assinatura",
  APPROVED:    "Concluído",
  DENIED:      "Negado",
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

const ANDAMENTO_STATUSES: SaleStatus[] = ["SUBMITTED", "IN_ANALYSIS", "DRAFTING", "SIGNING"];

function toNumber(v: number | string | undefined | null): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  // Prisma Decimal vem como string ("1234567.89") — pode ter vírgula em algumas serializações
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

export function Vendas() {
  const [list, setList] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"" | SaleStatus>("");
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await api.get<{ data: Sale[] }>("/api/sales?limit=200");
        setList(r.data ?? []);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(`Erro: ${msg}`);
      } finally { setLoading(false); }
    })();
  }, [showToast]);

  const filtered = useMemo(() => {
    if (!filter) return list;
    return list.filter((s) => s.status === filter);
  }, [list, filter]);

  const total = list.length;
  const concluidas = list.filter((s) => s.status === "APPROVED").length;
  const andamento = list.filter((s) => s.status && ANDAMENTO_STATUSES.includes(s.status)).length;
  const valorAprovado = list
    .filter((s) => s.status === "APPROVED")
    .reduce((acc, s) => acc + toNumber(s.finalValue), 0);

  const cols: Column<Sale>[] = [
    {
      key: "data", header: "Enviada",
      render: (s) => s.createdAt
        ? new Date(s.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
        : "—",
    },
    {
      key: "cliente", header: "Cliente",
      render: (s) => (
        <div>
          <p className="font-semibold">{s.clientName ?? "—"}</p>
          {s.code && <p className="text-[0.65rem] text-sand-100/55 font-mono">{s.code}</p>}
        </div>
      ),
    },
    {
      key: "imov", header: "Imóvel",
      render: (s) => s.property?.code ? (
        <div>
          <p className="font-mono text-xs">{s.property.code}</p>
          {s.property.title && <p className="text-xs text-sand-100/55">{s.property.title}</p>}
        </div>
      ) : "—",
    },
    { key: "cor", header: "Corretor", render: (s) => s.associate?.user?.name ?? "—" },
    { key: "valor", header: "Valor", render: (s) => fmtBRL(s.finalValue), align: "right" },
    {
      key: "st", header: "Status",
      render: (s) => {
        const st = s.status;
        if (!st) return <StatusPill tone="neutral">—</StatusPill>;
        const pill = (
          <StatusPill tone={SALE_STATUS_TONE[st]}>
            {SALE_STATUS_LABEL[st]}
          </StatusPill>
        );
        if (st === "DENIED" && s.denialReason?.trim()) {
          return (
            <div className="leading-tight">
              {pill}
              <p className="text-[11px] mt-1 text-red-300/90 max-w-[240px]" title={s.denialReason}>
                <span className="font-semibold">Motivo:</span> {s.denialReason.length > 80 ? s.denialReason.slice(0, 80) + "…" : s.denialReason}
              </p>
            </div>
          );
        }
        return pill;
      },
    },
  ];

  return (
    <div className="p-6 md:p-8">
      <PageHeader title="Vendas" description="Contratos e propostas · ciclo Rascunho → Jurídico → Aprovado" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Total vendas" value={total} />
        <KpiCard label="Concluídas" value={concluidas} accent="success" />
        <KpiCard label="Em andamento" value={andamento} accent="info" />
        <KpiCard label="Valor aprovado" value={fmtBRLCompact(valorAprovado)} accent="success" />
      </div>

      <div className="mb-4">
        <select
          className="field-input text-sm max-w-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value as "" | SaleStatus)}
        >
          <option value="">Todos status</option>
          <option value="DRAFT">Rascunho</option>
          <option value="SUBMITTED">Em jurídico</option>
          <option value="IN_ANALYSIS">Em análise</option>
          <option value="DRAFTING">Em elaboração</option>
          <option value="SIGNING">Em assinatura</option>
          <option value="APPROVED">Concluído</option>
          <option value="DENIED">Negado</option>
        </select>
      </div>

      {loading && list.length === 0 ? (
        <div className="card p-10 text-center text-sand-100/55">Carregando…</div>
      ) : (
        <DataTable rows={filtered} columns={cols} rowKey={(s) => s.id} empty="Nenhuma venda encontrada." />
      )}
    </div>
  );
}
