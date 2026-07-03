// Painel do Gestor — Dashboard estratégico (v2) · centro de comando enterprise.
// Dados 100% reais (/api/dashboards/strategic). Atividade em janela móvel de 24h.
import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import {
  RefreshCw, AlertTriangle, Flame, Snowflake, Target, Trophy, TrendingUp,
  CheckCircle2, Inbox, PercentCircle, ArrowDownRight, Activity, MessageSquare,
  Clock, UserCheck, Phone, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { fmtNowBR } from "@/lib/format";

interface Strategic {
  funnel: { status: string; n: number }[];
  conv: { total: number; accepted: number; responded: number };
  leak: { responded_unaccepted: number; hot_open: number };
  offenders: { name: string; n: number }[];
  inactive: { brokers: number; leads: number };
  ops: { distributed: number; accepted: number; logins: number; tabulacoes: number };
  resp24h: number;
  msg24h: { inbound: number; outbound: number; total: number };
  msgTrend: { d: string; n: number }[];
  releases: { pending: number; total: number };
  applications: { pending: number };
  team: { total: number; new7d: number; new30d: number; online_today: number; online_now: number; inactive7d: number };
  sales: { status: string; n: number; v: number }[];
  visits: { status: string; n: number }[];
  ranking: { name: string; sales: number; leak: number; new_held: number }[];
  trend: { d: string; dist: number; acc: number }[];
}

// 2026-06-05 · cores estruturais (surface/line/text/dim/mute) leem de CSS vars
// pra modo claro funcionar. Acentos (gold/green/amber/red/blue) ficam fixos.
// Defaults dark + overrides em html.light estão em src/styles/globals.css.
const T = {
  surface:  "var(--adm-surface)",   line:    "var(--adm-line)",     lineSoft: "var(--adm-line-soft)",
  text:     "var(--adm-text)",       dim:     "var(--adm-dim)",       mute:    "var(--adm-mute)",
  gold: "#E3C078", goldSoft: "rgba(227,192,120,.12)",
  green: "#3FD18A", greenSoft: "rgba(63,209,138,.13)",
  amber: "#F2B45B", amberSoft: "rgba(242,180,91,.13)",
  red: "#F0816B", redSoft: "rgba(240,129,107,.13)",
  blue: "#5BA8F2", blueSoft: "rgba(91,168,242,.13)",
};
const MUTE = "var(--adm-mute)";
const card: CSSProperties = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: "var(--adm-card-shadow)" };
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const f1 = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const nf = (n: number) => (n ?? 0).toLocaleString("pt-BR");
const fmtD = (s: string) => (s ? s.split("-").slice(1).reverse().join("/") : "");
const TONE: Record<string, { c: string; s: string }> = {
  gold: { c: T.gold, s: T.goldSoft }, green: { c: T.green, s: T.greenSoft },
  amber: { c: T.amber, s: T.amberSoft }, red: { c: T.red, s: T.redSoft }, blue: { c: T.blue, s: T.blueSoft },
};

export function AdminDashboardV2() {
  const [d, setD] = useState<Strategic | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState(1);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const showToast = useUi((s) => s.showToast);
  async function load() {
    setLoading(true);
    const q = range ? `from=${range.from}&to=${range.to}` : `days=${period}`;
    try { setD(await api.get<Strategic>(`/api/dashboards/strategic?${q}`)); }
    catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [period, range]);
  const PLABEL = range ? `${fmtD(range.from)} a ${fmtD(range.to)}` : period === 1 ? "últimas 24h" : `últimos ${period} dias`;

  if (!d) return <div style={{ padding: 28 }}><div style={{ ...card, padding: 48, textAlign: "center", color: T.dim }}>{loading ? "Carregando centro de comando…" : "Sem dados."}</div></div>;

  const F: Record<string, number> = Object.fromEntries(d.funnel.map((x) => [x.status, x.n]));
  const totalLeads = d.funnel.reduce((a, x) => a + x.n, 0);
  const won = F.CLOSED || 0;
  const worked = totalLeads - (F.NEW || 0);
  const convPct = pct(won, worked);
  const acceptPct = pct(d.conv.accepted, d.conv.total);
  const ignoredPct = pct(d.leak.responded_unaccepted, d.conv.responded);
  const activePct = pct(d.team.total - d.team.inactive7d, d.team.total);

  return (
    <div style={{ padding: "26px 32px 44px", maxWidth: 1900, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 22 }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: T.green, boxShadow: `0 0 0 4px ${T.greenSoft}` }} />
            <span style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: T.dim, fontWeight: 600 }}>Operação ao vivo</span>
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: T.text, lineHeight: 1.1 }}>Painel do Gestor</h1>
          <p style={{ fontSize: 13, color: T.dim, marginTop: 6 }}>Funil, conversão, atividade e vazamentos — para decidir e cobrar o time.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,.03)", border: `1px solid ${T.line}`, borderRadius: 10, padding: 3 }}>
            {[{ v: 1, l: "24h" }, { v: 7, l: "7d" }, { v: 30, l: "30d" }, { v: 90, l: "90d" }].map((o) => {
              const on = !range && period === o.v;
              return <button key={o.v} onClick={() => { setRange(null); setPeriod(o.v); }} style={{ fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 7, border: "none", cursor: "pointer", background: on ? T.gold : "transparent", color: on ? "#06141f" : T.dim, transition: "background .15s" }}>{o.l}</button>;
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.03)", border: `1px solid ${range ? T.gold : T.line}`, borderRadius: 10, padding: "3px 4px 3px 9px" }}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ background: "transparent", border: "none", color: T.text, fontSize: 12, colorScheme: "dark", outline: "none", width: 118 }} />
            <span style={{ color: MUTE, fontSize: 11 }}>a</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ background: "transparent", border: "none", color: T.text, fontSize: 12, colorScheme: "dark", outline: "none", width: 118 }} />
            <button onClick={() => { if (from && to) setRange({ from, to }); }} disabled={!from || !to} style={{ fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 7, border: "none", cursor: from && to ? "pointer" : "not-allowed", background: from && to ? T.gold : "rgba(255,255,255,.06)", color: from && to ? "#06141f" : MUTE }}>Aplicar</button>
          </div>
          <button onClick={() => load()} disabled={loading} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: T.gold, background: T.goldSoft, border: "1px solid rgba(227,192,120,.25)", borderRadius: 10, padding: "8px 14px", cursor: "pointer" }}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Atualizar
          </button>
          <span style={{ fontSize: 12, color: MUTE }}>{fmtNowBR()}</span>
        </div>
      </header>

      {/* KPIs estratégicos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16 }}>
        <Kpi icon={<UserCheck size={16} />} tone="green" emphasis label="Corretores online agora" value={nf(d.team.online_now)} foot={`de ${nf(d.team.total)} no total`} />
        <Kpi icon={<CheckCircle2 size={16} />} tone="blue" label="Logaram hoje" value={nf(d.team.online_today)} foot="acessos únicos no dia" />
        <Kpi icon={<PercentCircle size={16} />} tone={convPct < 1 ? "amber" : "green"} label="Conversão (ganho)" value={`${f1(convPct)}%`} foot={`${won} ganhos · ${nf(worked)} trabalhados`} />
        <Kpi icon={<CheckCircle2 size={16} />} tone={acceptPct < 30 ? "amber" : "green"} label="Taxa de aceite" value={`${f1(acceptPct)}%`} foot={`${nf(d.conv.accepted)} de ${nf(d.conv.total)} conversas`} />
        <Kpi icon={<Flame size={16} />} tone="red" emphasis label="Lead quente · Respondeu" value={nf(d.leak.responded_unaccepted)} foot={`${f1(ignoredPct)}% de quem respondeu foi ignorado`} />
        <Kpi icon={<Snowflake size={16} />} tone="amber" emphasis label="Inventário congelado" value={nf(d.inactive.leads)} foot={`${d.inactive.brokers} corretores inativos segurando`} />
        <Kpi icon={<Inbox size={16} />} tone="blue" label={`Responderam · ${period === 1 ? "24h" : period + "d"}`} value={nf(d.resp24h)} foot={`${nf(d.ops.accepted)} aceites · ${nf(d.ops.distributed)} distribuídos`} />
      </div>

      {/* Operação 24h */}
      <div style={{ marginTop: 16 }}>
        <Section icon={<Activity size={15} />} tone="blue" title={`Operação · ${PLABEL}`} subtitle="pulso da plataforma">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <StatCell icon={<MessageSquare size={14} />} label="Mensagens" value={nf(d.msg24h.total)} sub={`↓ ${nf(d.msg24h.inbound)} cliente · ↑ ${nf(d.msg24h.outbound)} corretor`} tone="blue" />
            <StatCell label="Tabulações" value={nf(d.ops.tabulacoes)} sub="mudanças de etapa" tone="gold" />
            <StatCell label="Distribuídos" value={nf(d.ops.distributed)} sub="leads novos repassados" />
            <StatCell label="Aceitos" value={nf(d.ops.accepted)} sub="leads assumidos" tone="green" />
            <StatCell label="Logins" value={nf(d.ops.logins)} sub="acessos de corretores" />
            <StatCell label="Responderam" value={nf(d.resp24h)} sub="clientes que voltaram" tone="blue" />
          </div>
        </Section>
      </div>

      {/* Funil + Saúde */}
      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 16, marginTop: 16 }} className="dash-2col">
        <Section icon={<Target size={15} />} tone="gold" title="Funil de conversão" subtitle={`${nf(totalLeads)} leads no total`}
          right={<span style={{ fontSize: 12, color: T.dim }}>Perdidos: <b style={{ color: T.red }}>{nf(F.LOST || 0)}</b></span>}>
          <Funnel F={F} />
          <p style={{ fontSize: 11.5, color: MUTE, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.lineSoft}`, lineHeight: 1.5 }}>
            <b style={{ color: T.amber }}>{f1(pct(F.NEW || 0, totalLeads))}%</b> dos leads nunca saíram de "Novo". O gargalo é <b style={{ color: T.text }}>execução</b>, não falta de lead.
          </p>
        </Section>
        <Section icon={<Flame size={15} />} tone="red" title="Saúde da operação" subtitle="indicadores de risco">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Risk tone="red" big={nf(d.leak.hot_open)} label="Leads quentes (janela aberta) sendo perdidos agora" />
            <Risk tone="amber" big={nf(d.inactive.leads)} label={`Leads "Novo" presos com ${d.inactive.brokers} corretores inativos`} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Mini label="Aceite total" value={`${f1(acceptPct)}%`} tone={acceptPct < 30 ? "amber" : "green"} />
              <Mini label="Responderam (total)" value={nf(d.conv.responded)} tone="blue" />
            </div>
          </div>
        </Section>
      </div>

      {/* Quem cobrar */}
      <div style={{ marginTop: 16 }}>
        <Section icon={<AlertTriangle size={15} />} tone="red" title="Quem cobrar" subtitle="corretores sentados em leads que o cliente respondeu"
          right={<span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: T.amber }}><Flame size={13} /> {nf(d.leak.hot_open)} quentes perdendo</span>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: "10px 26px" }}>
            {d.offenders.map((o, i) => {
              const w = Math.max(5, pct(o.n, d.offenders[0]?.n || 1));
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: i < 3 ? T.red : MUTE, textAlign: "center" }}>{i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: T.text, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</span>
                    <div style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,.05)", marginTop: 5, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${w}%`, background: `linear-gradient(90deg, ${T.red}, ${T.red}99)`, borderRadius: 99 }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 17, fontWeight: 300, color: T.red, fontVariantNumeric: "tabular-nums" }}>{o.n}</span>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      {/* Pendências do gestor + Time */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.25fr", gap: 16, marginTop: 16 }} className="dash-2col">
        <Section icon={<Clock size={15} />} tone="amber" title="Pendências do gestor" subtitle="esperando sua ação">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <PendCard icon={<UserCheck size={16} />} tone="amber" value={d.applications.pending} label="Cadastros aguardando aprovação" />
            <PendCard icon={<Phone size={16} />} tone="red" value={d.releases.pending} label="Pedidos de liberação de telefone" />
          </div>
        </Section>
        <Section icon={<Users size={15} />} tone="gold" title="Time de corretores" subtitle={`${nf(d.team.total)} ativos no programa`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px,1fr))", gap: 12 }}>
            <Mini label="Total" value={nf(d.team.total)} />
            <Mini label="Novos (30d)" value={nf(d.team.new30d)} tone="green" />
            <Mini label="Online hoje" value={nf(d.team.online_today)} tone="blue" />
            <Mini label="Inativos (>7d)" value={nf(d.team.inactive7d)} tone="red" />
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: MUTE, marginBottom: 5 }}>
              <span>Ativos vs inativos</span><span>{f1(activePct)}% ativos</span>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: T.redSoft, overflow: "hidden", display: "flex" }}>
              <div style={{ width: `${activePct}%`, background: `linear-gradient(90deg, ${T.green}, ${T.green}cc)` }} />
            </div>
          </div>
        </Section>
      </div>

      {/* Ranking + Resultados/Tendência */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16, marginTop: 16 }} className="dash-2col">
        <Section icon={<Trophy size={15} />} tone="gold" title="Ranking por resultado" subtitle="vendas e carteira — não atividade">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 64px 84px 72px", gap: 8, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: MUTE, padding: "0 4px 8px", borderBottom: `1px solid ${T.lineSoft}` }}>
            <span>Corretor</span><span style={{ textAlign: "right" }}>Vendas</span><span style={{ textAlign: "right" }}>Quente parado</span><span style={{ textAlign: "right" }}>Carteira</span>
          </div>
          {d.ranking.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 64px 84px 72px", gap: 8, alignItems: "center", padding: "9px 4px", borderBottom: i < d.ranking.length - 1 ? `1px solid ${T.lineSoft}` : "none", fontSize: 13 }}>
              <span style={{ color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><span style={{ color: MUTE, marginRight: 6 }}>{i + 1}</span>{r.name}</span>
              <span style={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: r.sales > 0 ? T.green : MUTE }}>{r.sales}</span>
              <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.leak > 0 ? T.red : MUTE }}>{r.leak}</span>
              <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: T.dim }}>{r.new_held}</span>
            </div>
          ))}
        </Section>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Section icon={<CheckCircle2 size={15} />} tone="green" title="Resultados" subtitle="saídas reais">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Mini label="Ganhos (funil)" value={nf(won)} tone="green" />
              <Mini label="Vendas formais" value={nf(d.sales.reduce((a, s) => a + s.n, 0))} tone="gold" />
              <Mini label="Visitas" value={nf(d.visits.reduce((a, v) => a + v.n, 0))} tone="blue" />
            </div>
          </Section>
          <Section icon={<TrendingUp size={15} />} tone="blue" title="Distribuído × Aceito" subtitle={PLABEL}>
            <TwinChart data={d.trend.map((t) => ({ d: t.d, a: t.dist, b: t.acc }))} aColor={T.gold} bColor={T.green} aLabel="Distribuídos" bLabel="Aceitos" />
          </Section>
        </div>
      </div>

      {/* Mensagens por dia */}
      <div style={{ marginTop: 16 }}>
        <Section icon={<MessageSquare size={15} />} tone="blue" title="Mensagens por dia" subtitle={`volume de tráfego · ${PLABEL}`}>
          <SingleChart data={d.msgTrend} color={T.blue} />
        </Section>
      </div>

      <p style={{ fontSize: 11, textAlign: "center", marginTop: 26, color: MUTE }}>
        Centro de comando (teste) · todos os números são consultas ao vivo do banco — zero dado fictício · atividade em janela móvel de 24h.
      </p>
      <style>{`@media (max-width: 980px){ .dash-2col{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

// ===== Componentes =====
function ChipIcon({ tone, children }: { tone: string; children: ReactNode }) {
  const t = TONE[tone] || TONE.gold;
  return <span style={{ width: 30, height: 30, borderRadius: 9, background: t.s, color: t.c, display: "grid", placeItems: "center", flex: "none" }}>{children}</span>;
}
function Kpi({ icon, tone, label, value, foot, emphasis }: { icon: ReactNode; tone: string; label: string; value: string; foot: string; emphasis?: boolean }) {
  const t = TONE[tone] || TONE.gold;
  return (
    <div style={{ ...card, position: "relative", overflow: "hidden", padding: "16px 18px", background: emphasis ? `linear-gradient(180deg, ${t.s}, ${T.surface} 60%)` : T.surface }}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: t.c, opacity: emphasis ? 1 : .5 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ChipIcon tone={tone}>{icon}</ChipIcon>
        <span style={{ fontSize: 10.5, letterSpacing: ".09em", textTransform: "uppercase", color: T.dim, fontWeight: 600 }}>{label}</span>
      </div>
      <p style={{ fontSize: 32, fontWeight: 300, letterSpacing: "-0.03em", color: emphasis ? t.c : T.text, marginTop: 10, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</p>
      <p style={{ fontSize: 11.5, color: MUTE, marginTop: 8, lineHeight: 1.35 }}>{foot}</p>
    </div>
  );
}
function Section({ icon, tone, title, subtitle, right, children }: { icon: ReactNode; tone: string; title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ ...card, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <ChipIcon tone={tone}>{icon}</ChipIcon>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 14.5, fontWeight: 700, color: T.text, letterSpacing: "-0.01em" }}>{title}</h2>
            {subtitle && <p style={{ fontSize: 11.5, color: MUTE, marginTop: 1 }}>{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}
function StatCell({ icon, label, value, sub, tone }: { icon?: ReactNode; label: string; value: string; sub?: string; tone?: string }) {
  const c = tone ? (TONE[tone]?.c || T.text) : T.text;
  return (
    <div style={{ background: "rgba(255,255,255,.025)", border: `1px solid ${T.lineSoft}`, borderRadius: 12, padding: "13px 14px" }}>
      <p style={{ fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", color: MUTE, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>{icon}{label}</p>
      <p style={{ fontSize: 24, fontWeight: 300, color: c, marginTop: 5, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</p>
      {sub && <p style={{ fontSize: 10.5, color: MUTE, marginTop: 5 }}>{sub}</p>}
    </div>
  );
}
function PendCard({ icon, tone, value, label }: { icon: ReactNode; tone: string; value: number; label: string }) {
  const t = TONE[tone] || TONE.amber;
  return (
    <div style={{ background: t.s, border: `1px solid ${t.c}33`, borderRadius: 12, padding: "14px 15px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: t.c }}>{icon}<span style={{ fontSize: 28, fontWeight: 300, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{nf(value)}</span></div>
      <p style={{ fontSize: 11.5, color: T.dim, marginTop: 8, lineHeight: 1.35 }}>{label}</p>
    </div>
  );
}
function Funnel({ F }: { F: Record<string, number> }) {
  const order = ["NEW", "QUALIFYING", "NEGOTIATING", "CLOSING", "CLOSED"];
  const label: Record<string, string> = { NEW: "Novos (parados)", QUALIFYING: "Qualificando", NEGOTIATING: "Negociação", CLOSING: "Fechamento", CLOSED: "Ganho" };
  const max = Math.max(...order.map((s) => F[s] || 0), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {order.map((s, i) => {
        const n = F[s] || 0;
        const w = Math.max(2.5, (n / max) * 100);
        const prev = i > 0 ? (F[order[i - 1]] || 0) : 0;
        const drop = i > 0 && prev > 0 ? pct(n, prev) : null;
        const isWin = s === "CLOSED"; const isNew = s === "NEW";
        const col = isWin ? T.green : isNew ? T.amber : T.gold;
        return (
          <div key={s} style={{ display: "grid", gridTemplateColumns: "118px 1fr 58px", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: isWin ? T.green : isNew ? T.amber : T.text }}>{label[s]}</span>
            <div style={{ height: 26, borderRadius: 7, background: "rgba(255,255,255,.04)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${w}%`, minWidth: 42, background: `linear-gradient(90deg, ${col}, ${col}bb)`, borderRadius: 7, display: "flex", alignItems: "center", paddingLeft: 10 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#06141f", fontVariantNumeric: "tabular-nums" }}>{nf(n)}</span>
              </div>
            </div>
            <span style={{ fontSize: 11, color: drop != null ? MUTE : "transparent", textAlign: "right", fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
              {drop != null && <ArrowDownRight size={11} />}{drop != null ? `${f1(drop)}%` : "0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
function Risk({ tone, big, label }: { tone: string; big: string; label: string }) {
  const t = TONE[tone] || TONE.red;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, background: t.s, border: `1px solid ${t.c}33`, borderRadius: 12, padding: "12px 14px" }}>
      <span style={{ fontSize: 26, fontWeight: 300, color: t.c, fontVariantNumeric: "tabular-nums", lineHeight: 1, flex: "none", minWidth: 44 }}>{big}</span>
      <span style={{ fontSize: 12, color: T.dim, lineHeight: 1.4 }}>{label}</span>
    </div>
  );
}
function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const c = tone ? (TONE[tone]?.c || T.text) : T.text;
  return (
    <div style={{ background: "rgba(255,255,255,.025)", border: `1px solid ${T.lineSoft}`, borderRadius: 11, padding: "11px 12px" }}>
      <p style={{ fontSize: 9.5, letterSpacing: ".07em", textTransform: "uppercase", color: MUTE, fontWeight: 600 }}>{label}</p>
      <p style={{ fontSize: 19, fontWeight: 400, color: c, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{value}</p>
    </div>
  );
}
function TwinChart({ data, aColor, bColor, aLabel, bLabel }: { data: { d: string; a: number; b: number }[]; aColor: string; bColor: string; aLabel: string; bLabel: string }) {
  const max = Math.max(...data.map((t) => Math.max(t.a, t.b)), 1); const H = 92;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: H, borderBottom: `1px solid ${T.lineSoft}` }}>
        {data.map((t, i) => (
          <div key={i} title={`${t.d} · ${t.a} / ${t.b}`} style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 3, height: "100%" }}>
            <div style={{ width: "44%", height: `${Math.max(3, (t.a / max) * H)}px`, background: `linear-gradient(180deg, ${aColor}, ${aColor}aa)`, borderRadius: "4px 4px 0 0" }} />
            <div style={{ width: "44%", height: `${Math.max(3, (t.b / max) * H)}px`, background: `linear-gradient(180deg, ${bColor}, ${bColor}aa)`, borderRadius: "4px 4px 0 0" }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 7 }}>{data.map((t, i) => <span key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: MUTE, whiteSpace: "nowrap", overflow: "hidden" }}>{(data.length <= 10 || i % Math.ceil(data.length / 7) === 0) ? t.d : ""}</span>)}</div>
      <div style={{ display: "flex", gap: 16, marginTop: 9, fontSize: 11, color: T.dim }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 9, height: 9, background: aColor, borderRadius: 2 }} /> {aLabel}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 9, height: 9, background: bColor, borderRadius: 2 }} /> {bLabel}</span>
      </div>
    </div>
  );
}
function SingleChart({ data, color }: { data: { d: string; n: number }[]; color: string }) {
  const max = Math.max(...data.map((t) => t.n), 1); const H = 120;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: H, borderBottom: `1px solid ${T.lineSoft}` }}>
        {data.map((t, i) => (
          <div key={i} title={`${t.d} · ${t.n} mensagens`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 4 }}>
            <span style={{ fontSize: data.length > 16 ? 8.5 : 10, color: T.dim, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{nf(t.n)}</span>
            <div style={{ width: data.length > 16 ? "82%" : "58%", height: `${Math.max(3, (t.n / max) * (H - 18))}px`, background: `linear-gradient(180deg, ${color}, ${color}99)`, borderRadius: "5px 5px 0 0" }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 7 }}>{data.map((t, i) => <span key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: MUTE, whiteSpace: "nowrap", overflow: "hidden" }}>{(data.length <= 10 || i % Math.ceil(data.length / 7) === 0) ? t.d : ""}</span>)}</div>
    </div>
  );
}
