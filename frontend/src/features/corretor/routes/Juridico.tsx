// Jurídico (corretor) — backend NÃO tem /api/legal/my (rota /api/legal exige role LEGAL).
// Solução: usa /api/sales (auto-filtra pelo associate) e pega só status no funil jurídico.
// SaleStatus enum: DRAFT | SUBMITTED | IN_ANALYSIS | DRAFTING | SIGNING | APPROVED | DENIED
// Timeline visual: SUBMITTED→IN_ANALYSIS→DRAFTING→SIGNING→APPROVED (DENIED é fim alternativo).
import { useEffect, useMemo, useState } from "react";
import { FileText, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPill } from "@/components/ui/StatusPill";

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

const JURIDICO_STATUSES: SaleStatus[] = ["SUBMITTED", "IN_ANALYSIS", "DRAFTING", "SIGNING", "APPROVED", "DENIED"];

// 4 colunas da timeline (legado linha 15752-15760)
const STEPS = [
  { key: "received",  label: "Recebido",     statuses: ["SUBMITTED"] as SaleStatus[] },
  { key: "analysis",  label: "Em análise",   statuses: ["IN_ANALYSIS"] as SaleStatus[] },
  { key: "drafting",  label: "Elaboração",   statuses: ["DRAFTING"] as SaleStatus[] },
  { key: "signing",   label: "Assinatura",   statuses: ["SIGNING", "APPROVED"] as SaleStatus[] },
];

function stepIndex(status?: SaleStatus): number {
  if (!status) return 0;
  // DENIED renderiza como "Recebido" mas com badge específica (igual legado linha 15758)
  if (status === "DENIED") return 0;
  return STEPS.findIndex((s) => s.statuses.includes(status));
}

function statusLabel(status?: SaleStatus): string {
  if (!status) return "—";
  if (status === "DENIED") return "Negado";
  if (status === "APPROVED") return "Concluído";
  const i = stepIndex(status);
  return i >= 0 ? STEPS[i].label : status;
}

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

export function CorretorJuridico() {
  const [list, setList] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const r = await api.get<{ data: Sale[] }>("/api/sales?limit=200");
        const onlyJuridico = (r.data ?? []).filter((s) => s.status && JURIDICO_STATUSES.includes(s.status));
        setList(onlyJuridico);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(`Erro: ${msg}`);
      } finally { setLoading(false); }
    })();
  }, [showToast]);

  const counts = useMemo(() => {
    return {
      total:      list.length,
      received:   list.filter((s) => s.status === "SUBMITTED").length,
      analysis:   list.filter((s) => s.status === "IN_ANALYSIS").length,
      drafting:   list.filter((s) => s.status === "DRAFTING").length,
      signing:    list.filter((s) => s.status === "SIGNING").length,
      approved:   list.filter((s) => s.status === "APPROVED").length,
      denied:     list.filter((s) => s.status === "DENIED").length,
    };
  }, [list]);

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        eyebrow="Jurídico"
        title="Meus contratos"
        description="Acompanhe a tramitação dos seus contratos no setor jurídico — desde a submissão até a assinatura"
      />

      {/* Resumo rápido */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Kpi label="Em análise" value={counts.received + counts.analysis} accent="info" />
        <Kpi label="Em elaboração" value={counts.drafting} accent="gold" />
        <Kpi label="Em assinatura" value={counts.signing} accent="warning" />
        <Kpi label="Concluídos" value={counts.approved} accent="success" />
      </div>

      {/* Lista de contratos com timeline */}
      <div className="space-y-3">
        {loading && list.length === 0 ? (
          <div className="card p-10 text-center text-sand-100/55">Carregando…</div>
        ) : list.length === 0 ? (
          <div className="card p-10 text-center">
            <FileText className="mx-auto mb-2 text-sand-100/35" size={28} />
            <p className="text-sand-100/55 text-sm">Nenhum contrato em análise jurídica no momento.</p>
            <p className="text-xs text-sand-100/40 mt-2">Quando você enviar uma venda ao jurídico, ela aparece aqui.</p>
          </div>
        ) : list.map((s) => {
          const idx = stepIndex(s.status);
          const isApproved = s.status === "APPROVED";
          const isDenied = s.status === "DENIED";
          const imovel = [s.property?.code, s.property?.title].filter(Boolean).join(" · ");

          return (
            <article key={s.id} className="card p-5">
              <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
                <div className="min-w-0">
                  <p className="font-semibold truncate">
                    Venda <span className="font-mono text-gold-300">{s.code ?? s.id.slice(0, 8)}</span>
                    {s.clientName && <span className="text-sand-100/60 font-normal"> · {s.clientName}</span>}
                  </p>
                  <p className="text-xs text-sand-100/60 mt-1 truncate">
                    {imovel || "—"} · <span className="text-gold-400 font-semibold">{fmtBRL(s.finalValue)}</span>
                  </p>
                  <p className="text-[0.65rem] text-sand-100/45 mt-1">
                    Enviada em {fmtDate(s.submittedAt ?? s.createdAt)}
                    {s.approvedAt && ` · Aprovada em ${fmtDate(s.approvedAt)}`}
                  </p>
                </div>
                <StatusPill tone={isDenied ? "danger" : isApproved ? "success" : "gold"}>
                  {statusLabel(s.status)}
                </StatusPill>
              </div>

              {/* Timeline · 2 colunas no mobile (em 2 linhas) · 4 no desktop */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                {STEPS.map((step, i) => {
                  const active = i <= idx && !isDenied;
                  return (
                    <div
                      key={step.key}
                      className={`py-2 px-1.5 rounded text-[0.65rem] uppercase tracking-mono-xwide font-semibold ${
                        active
                          ? "bg-gold-400/15 text-gold-300"
                          : isDenied && i === 0
                            ? "bg-red-500/15 text-red-300"
                            : "bg-app-subtle/60 text-sand-100/40"
                      }`}
                    >
                      {step.label}
                    </div>
                  );
                })}
              </div>

              {/* Motivo da negação */}
              {isDenied && s.denialReason && (
                <div className="mt-3 text-xs bg-red-500/10 border border-red-500/30 text-red-200 rounded p-2.5 inline-flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span><strong className="font-semibold">Motivo da negação:</strong> {s.denialReason}</span>
                </div>
              )}
            </article>
          );
        })}

        {/* Contratos negados separados visualmente, se houver */}
        {counts.denied > 0 && counts.total > counts.denied && (
          <p className="text-xs text-sand-100/45 text-center pt-2">
            {counts.denied} contrato{counts.denied === 1 ? "" : "s"} negado{counts.denied === 1 ? "" : "s"} acima
          </p>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number; accent?: "info" | "gold" | "warning" | "success" }) {
  const colorMap = {
    info:    "text-blue-300",
    gold:    "text-gold-300",
    warning: "text-orange-300",
    success: "text-emerald-300",
  };
  const cls = accent ? colorMap[accent] : "text-sand-50";
  return (
    <div className="card p-4">
      <p className="text-[0.62rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">{label}</p>
      <p className={`text-2xl md:text-3xl font-display font-light tracking-[-0.03em] mt-1 leading-tight ${cls}`}>{value}</p>
    </div>
  );
}
