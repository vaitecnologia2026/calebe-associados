// Dashboard admin · porte fiel de loadAdminDashboard + loadActiveBrokers + renderTopAtivos
// Endpoints: /api/dashboards/summary · /api/dashboards/active-brokers
import { useEffect, useState } from "react";
import { Database, RefreshCw, MessageCircle, Gem, Medal, Award, Trophy, Rocket, MessagesSquare } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { fmtBRL, fmtBRLCompact, fmtNowBR } from "@/lib/format";
import { Button } from "@/components/ui/Button";

interface Summary {
  totalAssociates?: number;
  associatesByCategory?: { DIAMOND?: number; GOLD?: number; SILVER?: number; BRONZE?: number };
  applPending?: number;
  leadsDistributedToday?: number;
  leadsInQueue?: number;
  activeConversations?: number;
  salesToday?: number;
  revenueYear?: number;
  commissionsPendingTotal?: number;
  commissionsDueMonth?: number;
  commissionsPaidMonth?: number;
  commissionsInReview?: number;
  commissionsBlocked?: number;
  structurePending?: number;
}

interface ActiveBroker {
  id: string;
  name: string;
  category: "BRONZE" | "SILVER" | "GOLD" | "DIAMOND";
  score: number;
  online: boolean;
  blocked: boolean;
  logins30: number;
  msgs30: number;
  convs30: number;
  sales30: number;
}
interface ActiveBrokersResp {
  kpis?: {
    conversationsStartedToday?: number;
    conversationsRepliedToday?: number;
    brokersOnlineToday?: number;
    online?: number;
    blocked?: number;
    neverLogged?: number;
  };
  ranking?: ActiveBroker[];
}

const CAT_COLOR: Record<string, string> = {
  BRONZE: "#8E6D2D",
  SILVER: "#8A93A6",
  GOLD: "#C9A961",
  DIAMOND: "#87A0B9",
};

export function AdminDashboard() {
  const [s, setS] = useState<Summary | null>(null);
  const [a, setA] = useState<ActiveBrokersResp | null>(null);
  const [loadingTop, setLoadingTop] = useState(false);
  const showToast = useUi((s) => s.showToast);

  async function load() {
    try {
      const [sum, act] = await Promise.all([
        api.get<Summary>("/api/dashboards/summary"),
        api.get<ActiveBrokersResp>("/api/dashboards/active-brokers"),
      ]);
      setS(sum);
      setA(act);
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
  }

  async function refreshTop() {
    setLoadingTop(true);
    try {
      const act = await api.get<ActiveBrokersResp>("/api/dashboards/active-brokers");
      setA(act);
    } catch { /* silent */ }
    finally { setLoadingTop(false); }
  }

  useEffect(() => { void load(); }, []);

  const cat = s?.associatesByCategory ?? {};
  const top = (a?.ranking ?? []).filter((b) => b.score >= 0 && !b.blocked).slice(0, 10);
  const maxScore = top[0]?.score || 1;
  const receitaPct = (s?.revenueYear ?? 0) > 0 ? 100 : 0;

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <p className="pill">Visão executiva</p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-display-tight mt-2">Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => showToast("Exportação em preparação…")} style={{ padding: ".5rem 1rem" }}>
            <Database size={14} /> Exportar todos os dados
          </Button>
          <span className="text-xs text-sand-100/55">{fmtNowBR()}</span>
        </div>
      </div>

      {/* 8 KPIs principais · 2 cols mobile · 4 cols md */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
        <Kpi label="Corretores" value={s?.totalAssociates ?? 0}
             hintNode={
               <span className="inline-flex items-center gap-2 text-xs">
                 <span className="inline-flex items-center gap-0.5"><Gem size={11} className="text-cyan-300" />{cat.DIAMOND || 0}</span>
                 <span className="inline-flex items-center gap-0.5"><Trophy size={11} className="text-amber-300" />{cat.GOLD || 0}</span>
                 <span className="inline-flex items-center gap-0.5"><Award size={11} className="text-zinc-300" />{cat.SILVER || 0}</span>
                 <span className="inline-flex items-center gap-0.5"><Medal size={11} className="text-orange-400" />{cat.BRONZE || 0}</span>
               </span>
             } />
        <Kpi label="Pendentes aprovação" value={s?.applPending ?? 0} hint="—" />
        <Kpi label="Leads hoje" value={s?.leadsDistributedToday ?? 0} hint={`${s?.leadsInQueue ?? 0} na fila`} />
        <Kpi label="Conversas ativas" value={s?.activeConversations ?? 0} hint="—" />
        <Kpi label="Vendas hoje" value={s?.salesToday ?? 0} hint="—" />
        <Kpi label="Receita (ano)" value={fmtBRLCompact(s?.revenueYear)} hint="aprovadas" />
        <Kpi label="Comissão pendente" value={fmtBRLCompact(s?.commissionsPendingTotal)} hint="—" />
        <Kpi label="Estrutura pendente" value={s?.structurePending ?? 0} hint="—" />
      </div>

      {/* 3 KPIs diários coloridos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 lg:gap-4 mt-3">
        <KpiColored
          icon={<Rocket size={13} />}
          label="Conversas iniciadas hoje"
          value={a?.kpis?.conversationsStartedToday ?? "—"}
          hint="1ª mensagem do corretor pro lead"
          bg="linear-gradient(135deg,rgba(34,197,94,.08),rgba(34,197,94,.02))"
          border="rgba(34,197,94,.25)"
          labelColor="#86efac"
          valueColor="#22c55e"
        />
        <KpiColored
          icon={<MessagesSquare size={13} />}
          label="Conversas respondidas hoje"
          value={a?.kpis?.conversationsRepliedToday ?? "—"}
          hint="leads que responderam hoje"
          bg="linear-gradient(135deg,rgba(96,165,250,.08),rgba(96,165,250,.02))"
          border="rgba(96,165,250,.25)"
          labelColor="#93C5FD"
          valueColor="#60a5fa"
        />
        <KpiColored
          label="⏱ Corretores online hoje"
          value={a?.kpis?.brokersOnlineToday ?? "—"}
          hint="já abriram a plataforma hoje"
          bg="linear-gradient(135deg,rgba(222,185,109,.08),rgba(222,185,109,.02))"
          border="rgba(222,185,109,.3)"
          labelColor="#DEB96D"
          valueColor="#DEB96D"
        />
      </div>

      {/* Top corretores · mais ativos */}
      <div className="card p-5 lg:p-6 mt-6">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div>
            <span className="pill" style={{ background: "rgba(34,197,94,.15)", color: "#86efac", borderColor: "rgba(34,197,94,.35)" }}>
              Top corretores · mais ativos na plataforma
            </span>
            <p className="text-xs text-sand-100/55 mt-1">
              Score baseado em login, mensagens, conversas e vendas dos últimos 30 dias. Atualiza a cada 30s.
            </p>
          </div>
          <button
            className="text-[0.72rem] uppercase tracking-mono-wide font-semibold text-gold-300 hover:text-gold-200 inline-flex items-center gap-1.5"
            onClick={refreshTop}
            disabled={loadingTop}
          >
            <RefreshCw size={13} className={loadingTop ? "animate-spin" : ""} /> Atualizar
          </button>
        </div>

        {top.length === 0 ? (
          <p className="text-sm text-sand-100/55 italic">Carregando…</p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {top.map((b, i) => {
              const pct = Math.max(2, Math.round((b.score / maxScore) * 100));
              return (
                <div key={b.id} className="grid grid-cols-[28px_1fr_auto_auto] items-center gap-3 p-2.5 rounded hover:bg-app-subtle/40 transition-colors">
                  <span className="font-display text-gold-400 text-base text-center">{i + 1}º</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {b.online && <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Online agora" />}
                      <span className="font-semibold truncate">{b.name}</span>
                      <span
                        className="text-[0.6rem] uppercase tracking-mono-wide font-bold px-1.5 py-0.5 rounded"
                        style={{ background: CAT_COLOR[b.category] || "#666", color: "#04101F" }}
                      >
                        {b.category}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-app-subtle/40 overflow-hidden">
                      <div className="h-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#DEB96D,#C9A961)" }} />
                    </div>
                    <p className="text-[0.66rem] text-sand-100/55 mt-1">
                      {b.logins30} login{b.logins30 === 1 ? "" : "s"} · {b.msgs30} msg{b.msgs30 === 1 ? "" : "s"} · {b.convs30} conv{b.convs30 === 1 ? "" : "s"} · {b.sales30} venda{b.sales30 === 1 ? "" : "s"} (30d)
                    </p>
                  </div>
                  <span className="font-display text-gold-400 text-lg shrink-0" title="Engagement score">{b.score}</span>
                  <button
                    className="text-[0.7rem] uppercase tracking-mono-wide font-bold px-2.5 py-1.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors shrink-0 inline-flex items-center gap-1"
                    onClick={() => showToast(`Reconhecer ${b.name} · use o monolito por enquanto`)}
                    title="Mandar recado motivacional via WhatsApp"
                  >
                    <MessageCircle size={11} /> Reconhecer
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {a?.kpis && (
          <p className="text-[0.7rem] text-sand-100/55 mt-3 pt-3 border-t hairline">
            Online agora: <strong className="text-emerald-300">{a.kpis.online ?? 0}</strong> ·
            {" "}Bloqueados: <strong className="text-red-300">{a.kpis.blocked ?? 0}</strong> ·
            {" "}Nunca logaram: <strong className="text-orange-300">{a.kpis.neverLogged ?? 0}</strong>
            {" "}(inelegíveis pra receber lead)
          </p>
        )}
      </div>

      {/* Metas (barra simples · sem chart real por enquanto · monólito também tinha mock) */}
      <div className="grid md:grid-cols-2 gap-4 mt-6">
        <div className="card p-5 lg:p-6">
          <span className="pill mb-3">Metas do trimestre</span>
          <div className="space-y-3 text-sm mt-3">
            <ProgressBar label="Receita meta" detail={fmtBRL(s?.revenueYear ?? 0) + " · ano corrente"} pct={receitaPct} />
            <ProgressBar label="Vendas Q2" detail="14 / 30" pct={47} />
            <ProgressBar label="Novos corretores" detail="3 / 10" pct={30} />
          </div>
        </div>
        <div className="card p-5 lg:p-6">
          <span className="pill mb-3">Resumo financeiro do mês</span>
          <dl className="grid grid-cols-2 gap-3 mt-3 text-sm">
            <FinKpi label="A pagar"     value={fmtBRLCompact(s?.commissionsDueMonth)} />
            <FinKpi label="Pago"        value={fmtBRLCompact(s?.commissionsPaidMonth)} />
            <FinKpi label="Conferência" value={fmtBRLCompact(s?.commissionsInReview)} />
            <FinKpi label="Bloqueado"   value={fmtBRLCompact(s?.commissionsBlocked)} />
          </dl>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, hintNode }: { label: string; value: number | string; hint?: string; hintNode?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <p className="text-[0.62rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">{label}</p>
      <p className="text-[2rem] md:text-[2.25rem] font-display font-light tracking-[-0.03em] mt-1 leading-tight">{value}</p>
      <div className="text-xs text-sand-100/55 mt-1">{hintNode ?? hint ?? "—"}</div>
    </div>
  );
}

function KpiColored({ icon, label, value, hint, bg, border, labelColor, valueColor }: {
  icon?: React.ReactNode;
  label: string; value: number | string; hint: string;
  bg: string; border: string; labelColor: string; valueColor: string;
}) {
  return (
    <div className="card p-4" style={{ background: bg, borderColor: border }}>
      <p className="text-[0.62rem] uppercase tracking-mono-xwide font-semibold inline-flex items-center gap-1.5" style={{ color: labelColor }}>
        {icon}{label}
      </p>
      <p className="text-[2rem] md:text-[2.25rem] font-display font-light tracking-[-0.03em] mt-1 leading-tight" style={{ color: valueColor }}>{value}</p>
      <p className="text-xs text-sand-100/55 mt-1">{hint}</p>
    </div>
  );
}

function ProgressBar({ label, detail, pct }: { label: string; detail: string; pct: number }) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-sand-100/70">{label}</span>
        <span className="font-semibold">{detail}</span>
      </div>
      <div className="h-1.5 bg-app-subtle rounded-full overflow-hidden">
        <div className="h-full bg-gold-gradient" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FinKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-app-subtle/40 rounded p-3">
      <dt className="text-[0.62rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">{label}</dt>
      <dd className="text-lg font-display mt-1">{value}</dd>
    </div>
  );
}
