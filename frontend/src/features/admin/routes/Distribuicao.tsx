// Distribuição · porte fiel do monólito · 4 tabs (Visão geral / Leads recebidos / Planejamento / Roleta)
// Endpoints:
//   /api/distribution/queue, /run, /rebalance, /extra
//   /api/distribution/top-called-replied?period=today|7d|30d|all (W9)
//   PATCH /api/distribution/rules/{BRONZE|SILVER|GOLD|DIAMOND}
//   /api/distribution/percentages, /inactivity-settings
//   /api/settings/leads.roleta (roleta config)

import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, Inbox, CalendarClock, RotateCw, Download, RefreshCw, Shuffle, Zap, Trophy,
  CalendarDays, Save, HelpCircle, Info, Users, History,
} from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { Button } from "@/components/ui/Button";

type Tab = "overview" | "recebidos" | "planejamento" | "historico" | "roleta";
type Periodo = "all" | "today" | "7d" | "30d";

interface QueueResp {
  total?: number;
  byDay?: { date: string; count: number }[];
  totalLeadsBase?: number;
  corretoresAtivos?: number;
  leadsAtribuidos?: number;
  capacityPerDay?: number;
  totalAgendados?: number;
  diasPlanejados?: { date: string; count: number; status?: string }[];
  recebidos?: { associateId: string; name: string; count: number; origin?: string; percent?: number }[];
}

interface TopRow {
  associateId: string;
  name: string;
  called: number;
  replied: number;
  responseRate: number;
}
interface TopCalledResp {
  period?: string;
  since?: string | null;
  data?: TopRow[];
}

export function Distribuicao() {
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const showToast = useUi((s) => s.showToast);

  // Overview state
  const [period, setPeriod] = useState<Periodo>("today");
  const [queueData, setQueueData] = useState<QueueResp | null>(null);
  const [topData, setTopData] = useState<TopRow[]>([]);

  async function loadOverview() {
    try {
      const [q, t] = await Promise.all([
        api.get<QueueResp>("/api/distribution/queue").catch(() => ({} as QueueResp)),
        api.get<TopCalledResp>(`/api/distribution/top-called-replied?period=${period}`).catch(() => ({ data: [] })),
      ]);
      setQueueData(q);
      setTopData(t.data ?? []);
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
  }

  useEffect(() => { void loadOverview(); }, [period]);

  async function runNow() {
    setBusy("run");
    try { await api.post("/api/distribution/run"); showToast("Reprocessou roleta"); await loadOverview(); }
    catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setBusy(null); }
  }
  async function recalcular() {
    setBusy("rec");
    try { await loadOverview(); showToast("Recalculado"); }
    finally { setBusy(null); }
  }
  async function extra() {
    const count = Number(prompt("Quantos leads extras distribuir?", "10"));
    if (!count || count < 1) return;
    setBusy("ext");
    try { await api.post("/api/distribution/extra", { count }); showToast(`${count} leads distribuídos`); await loadOverview(); }
    catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setBusy(null); }
  }

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-end gap-3 mb-6">
        <div>
          <span className="pill">Roleta ativa · auditoria</span>
          <h1 className="text-3xl md:text-4xl font-bold tracking-display-tight mt-2">Distribuição de Leads</h1>
          <p className="text-sm text-sand-100/65 mt-2 max-w-2xl">
            Validação da roleta por segmento — cruza leads recebidos, corretores ativos e capacidade de atendimento.
            Permite identificar desequilíbrio antes de virar atrito.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" style={{ padding: ".5rem 1rem" }} onClick={() => showToast("Exportação em preparação…")}>
            <Download size={14} /> Exportar CSV
          </Button>
          <Button variant="outline" style={{ padding: ".5rem 1rem" }} onClick={recalcular} loading={busy === "rec"}>
            <RefreshCw size={14} /> Recalcular
          </Button>
          <Button variant="gold" style={{ padding: ".5rem 1rem" }} onClick={runNow} loading={busy === "run"}>
            <Shuffle size={14} /> Reprocessar roleta
          </Button>
          <button
            className="btn-base inline-flex items-center gap-1.5 text-sm"
            style={{ padding: ".5rem 1rem", background: "#16a34a", color: "#fff", border: "1px solid #15803d" }}
            onClick={extra}
            disabled={busy === "ext"}
          >
            <Zap size={14} /> Distribuição extra
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b hairline overflow-x-auto">
        <TabBtn active={tab === "overview"}     onClick={() => setTab("overview")}>
          <LayoutDashboard size={14} className="inline -mt-0.5 mr-1" /> Visão geral
        </TabBtn>
        <TabBtn active={tab === "recebidos"}    onClick={() => setTab("recebidos")}>
          <Inbox size={14} className="inline -mt-0.5 mr-1" /> Leads recebidos
          <Badge>{queueData?.recebidos?.length ?? 0}</Badge>
        </TabBtn>
        <TabBtn active={tab === "planejamento"} onClick={() => setTab("planejamento")}>
          <CalendarClock size={14} className="inline -mt-0.5 mr-1" /> Planejamento de envio
          <Badge>{queueData?.diasPlanejados?.length ?? queueData?.totalAgendados ?? 0}</Badge>
        </TabBtn>
        <TabBtn active={tab === "historico"}    onClick={() => setTab("historico")}>
          <History size={14} className="inline -mt-0.5 mr-1" /> Histórico
        </TabBtn>
        <TabBtn active={tab === "roleta"}       onClick={() => setTab("roleta")}>
          <RotateCw size={14} className="inline -mt-0.5 mr-1" /> Roleta Automática
        </TabBtn>
      </div>

      {tab === "overview" && (
        <Overview
          period={period}
          setPeriod={setPeriod}
          queueData={queueData}
          topData={topData}
        />
      )}
      {tab === "recebidos" && <LeadsRecebidos queueData={queueData} />}
      {tab === "planejamento" && <Planejamento queueData={queueData} />}
      {tab === "historico" && <Historico />}
      {tab === "roleta" && <RoletaAuto />}
    </div>
  );
}

// Histórico de distribuição · GET /api/distribution/history?days=N
interface HistoryDay { date: string; total?: number; distributed?: number; byCategoria?: Record<string, number> }
interface RedistRow { id: string; timestamp: string; reason?: string; fromAssociateId?: string; toAssociateId?: string; lead?: { name?: string; segment?: string } }

function Historico() {
  const showToast = useUi((s) => s.showToast);
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{ history: HistoryDay[]; redistributions: RedistRow[] } | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ history: HistoryDay[]; redistributions: RedistRow[] }>(`/api/distribution/history?days=${days}`);
      setData(r);
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [days]);

  const totalDistrib = data?.history?.reduce((a, d) => a + (d.distributed ?? d.total ?? 0), 0) ?? 0;
  const totalRedist = data?.redistributions?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
        <div>
          <p className="text-sm text-sand-100/65 mb-2">Distribuições efetuadas dia a dia + redistribuições por inatividade.</p>
          <div className="flex items-center gap-2 text-xs text-sand-100/65">
            <span>{totalDistrib} leads distribuídos · {totalRedist} redistribuições</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select className="field-input text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
            <option value={180}>180 dias</option>
          </select>
          <Button variant="outline" onClick={load} loading={loading}><RefreshCw size={13} /> Atualizar</Button>
        </div>
      </div>

      {/* Distribuição dia a dia */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
            <tr>
              <th className="text-left p-3">Data</th>
              <th className="text-right p-3">Distribuídos</th>
              <th className="text-right p-3">Bronze</th>
              <th className="text-right p-3">Prata</th>
              <th className="text-right p-3">Ouro</th>
              <th className="text-right p-3">Diamante</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr><td colSpan={6} className="p-10 text-center text-sand-100/55">Carregando…</td></tr>
            ) : !data?.history?.length ? (
              <tr><td colSpan={6} className="p-10 text-center text-sand-100/55">Sem registros no período.</td></tr>
            ) : data.history.map((d) => (
              <tr key={d.date} className="border-t hairline">
                <td className="p-3 text-xs">{new Date(d.date).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}</td>
                <td className="p-3 text-right font-bold tabular-nums text-gold-300">{d.distributed ?? d.total ?? 0}</td>
                <td className="p-3 text-right tabular-nums">{d.byCategoria?.BRONZE ?? "—"}</td>
                <td className="p-3 text-right tabular-nums">{d.byCategoria?.SILVER ?? "—"}</td>
                <td className="p-3 text-right tabular-nums">{d.byCategoria?.GOLD ?? "—"}</td>
                <td className="p-3 text-right tabular-nums">{d.byCategoria?.DIAMOND ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Redistribuições por inatividade · últimas 100 */}
      <div className="card overflow-x-auto">
        <header className="p-3 border-b hairline">
          <p className="text-xs uppercase tracking-mono-xwide font-semibold text-sand-100/55">Últimas redistribuições por inatividade</p>
        </header>
        <table className="w-full text-sm">
          <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
            <tr>
              <th className="text-left p-3">Quando</th>
              <th className="text-left p-3">Lead</th>
              <th className="text-left p-3">Segmento</th>
              <th className="text-left p-3">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {!data?.redistributions?.length ? (
              <tr><td colSpan={4} className="p-6 text-center text-sand-100/55 text-xs">Nenhuma redistribuição registrada.</td></tr>
            ) : data.redistributions.map((r) => (
              <tr key={r.id} className="border-t hairline">
                <td className="p-3 text-xs text-sand-100/85">{new Date(r.timestamp).toLocaleString("pt-BR")}</td>
                <td className="p-3 text-xs">{r.lead?.name ?? "—"}</td>
                <td className="p-3 text-xs text-sand-100/75">{r.lead?.segment ?? "—"}</td>
                <td className="p-3 text-xs">{r.reason ?? "inatividade"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
        active ? "border-gold-400 text-gold-300" : "border-transparent text-sand-100/60 hover:text-sand-100/85"
      }`}
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1 inline-block text-[0.65rem] bg-gold-400/20 text-gold-300 rounded-full px-1.5 py-0.5 font-bold">
      {children}
    </span>
  );
}

function Overview({ period, setPeriod, queueData, topData }: {
  period: Periodo;
  setPeriod: (p: Periodo) => void;
  queueData: QueueResp | null;
  topData: TopRow[];
}) {
  return (
    <>
      <div className="card p-4 mb-5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="text-[0.68rem] uppercase tracking-mono-xwide font-medium text-sand-100/55 mb-1 block">Período</label>
            <select className="field-input py-2 text-sm" value={period} onChange={(e) => setPeriod(e.target.value as Periodo)}>
              <option value="all">Todos</option>
              <option value="today">Hoje</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
            </select>
          </div>
          <div>
            <label className="text-[0.68rem] uppercase tracking-mono-xwide font-medium text-sand-100/55 mb-1 block">Corretor</label>
            <select className="field-input py-2 text-sm">
              <option value="">Todos</option>
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={() => setPeriod("today")} className="text-[0.72rem] uppercase tracking-mono-wide font-medium text-gold-300 hover:text-gold-200 py-2">
              Limpar filtros
            </button>
          </div>
        </div>
      </div>

      {/* 3 KPIs grandes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="card p-5">
          <p className="text-[0.72rem] uppercase tracking-mono-xwide font-medium text-sand-100/55">Total de leads na base</p>
          <p className="text-4xl font-display font-light text-gold-300 mt-2">{queueData?.totalLeadsBase ?? "—"}</p>
          <p className="text-xs text-sand-100/55 mt-1">Todos os leads cadastrados</p>
        </div>
        <div className="card p-5">
          <p className="text-[0.72rem] uppercase tracking-mono-xwide font-medium text-sand-100/55">Corretores ativos</p>
          <p className="text-4xl font-display font-light mt-2">{queueData?.corretoresAtivos ?? "—"}</p>
          <p className="text-xs text-sand-100/55 mt-1">Aprovados e em operação</p>
        </div>
        <div className="card p-5">
          <p className="text-[0.72rem] uppercase tracking-mono-xwide font-medium text-sand-100/55">Leads atribuídos</p>
          <p className="text-4xl font-display font-light mt-2">{queueData?.leadsAtribuidos ?? "—"}</p>
          <p className="text-xs text-sand-100/55 mt-1">Enviados aos corretores</p>
        </div>
      </div>

      {/* Top 10 chamados e respondidos */}
      <div className="card overflow-hidden mb-5">
        <div className="p-4 border-b hairline">
          <p className="text-[0.72rem] uppercase tracking-mono-xwide font-semibold text-gold-400/80 inline-flex items-center gap-1.5">
            <Trophy size={14} /> Top 10 corretores · leads chamados e respondidos
          </p>
          <p className="text-sm text-sand-100/60 mt-1">
            Conversas onde o corretor mandou mensagem E o lead respondeu (engajamento real, não só "recebeu o lead").
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-app-subtle/60 text-[0.7rem] uppercase tracking-mono-xwide font-medium text-sand-100/60">
              <tr>
                <th className="text-left p-4">#</th>
                <th className="text-left p-4">Corretor</th>
                <th className="text-center p-4">Chamados</th>
                <th className="text-center p-4">Respondidos</th>
                <th className="text-left p-4">Taxa resposta</th>
              </tr>
            </thead>
            <tbody>
              {topData.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-sand-100/55">Sem dados no período.</td></tr>
              ) : topData.map((b, i) => {
                const pct = Math.round((b.responseRate || 0) * 100);
                return (
                  <tr key={b.associateId} className="border-t hairline">
                    <td className="p-4 text-sand-100/55">{i + 1}</td>
                    <td className="p-4 font-semibold inline-flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" /> {b.name}
                    </td>
                    <td className="p-4 text-center text-gold-300 font-bold">{b.called}</td>
                    <td className={`p-4 text-center font-bold ${b.replied === 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {b.replied}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 rounded-full bg-app-subtle/60 overflow-hidden max-w-[180px]">
                          <div className={`h-full ${pct >= 30 ? "bg-emerald-400" : "bg-gold-400"}`} style={{ width: `${Math.max(2, pct)}%` }} />
                        </div>
                        <span className={`text-xs font-semibold ${pct < 10 ? "text-red-400" : pct < 30 ? "text-gold-400" : "text-emerald-400"}`}>
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Envios por dia */}
      <div className="card overflow-hidden mb-5">
        <div className="p-4 border-b hairline">
          <p className="text-[0.72rem] uppercase tracking-mono-xwide font-semibold text-gold-400/80 inline-flex items-center gap-1.5">
            <CalendarDays size={14} /> Leads enviados por dia
          </p>
          <p className="text-sm text-sand-100/60 mt-1">Quantos leads saíram para os corretores em cada dia do período.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-app-subtle/60 text-[0.7rem] uppercase tracking-mono-xwide font-medium text-sand-100/60">
              <tr><th className="text-left p-4">Dia</th><th className="text-center p-4">Leads enviados</th><th className="text-left p-4">% de leads entregues</th></tr>
            </thead>
            <tbody>
              {(queueData?.byDay ?? []).length === 0 ? (
                <tr><td colSpan={3} className="p-8 text-center text-sand-100/55">Sem dados de envio no período.</td></tr>
              ) : (queueData?.byDay ?? []).map((d) => {
                const max = Math.max(...(queueData?.byDay ?? []).map(x => x.count), 1);
                const pct = Math.round((d.count / max) * 100);
                return (
                  <tr key={d.date} className="border-t hairline">
                    <td className="p-4">{d.date}</td>
                    <td className="p-4 text-center font-bold">{d.count}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 rounded-full bg-app-subtle/60 overflow-hidden max-w-[200px]">
                          <div className="h-full bg-gold-gradient" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-semibold">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function LeadsRecebidos({ queueData }: { queueData: QueueResp | null }) {
  const items = queueData?.recebidos ?? [];
  const total = items.reduce((a, b) => a + b.count, 0);
  const max = items[0]?.count ?? 0;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="card p-4"><p className="text-[0.7rem] uppercase text-sand-100/55">Total distribuído</p>
          <p className="text-2xl font-bold text-gold-300 mt-1">{total || "—"}</p>
          <p className="text-xs text-sand-100/55 mt-1">no período filtrado</p>
        </div>
        <div className="card p-4"><p className="text-[0.7rem] uppercase text-sand-100/55">Corretores que receberam</p>
          <p className="text-2xl font-bold mt-1">{items.length || "—"}</p>
          <p className="text-xs text-sand-100/55 mt-1">do total de {queueData?.corretoresAtivos ?? "—"} aprovados</p>
        </div>
        <div className="card p-4"><p className="text-[0.7rem] uppercase text-sand-100/55">Média por corretor</p>
          <p className="text-2xl font-bold mt-1">{items.length ? Math.round(total / items.length) : "—"}</p>
          <p className="text-xs text-sand-100/55 mt-1">Apenas entre os que receberam</p>
        </div>
        <div className="card p-4"><p className="text-[0.7rem] uppercase text-sand-100/55">Maior volume</p>
          <p className="text-2xl font-bold mt-1">{max || "—"}</p>
          <p className="text-xs text-sand-100/55 mt-1">{items[0]?.name ?? "—"}</p>
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="p-4 border-b hairline">
          <p className="text-[0.72rem] uppercase tracking-mono-xwide font-semibold text-gold-400/80 inline-flex items-center gap-1.5">
            <Users size={14} /> Corretores · leads recebidos
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-app-subtle/60 text-[0.7rem] uppercase tracking-mono-xwide font-medium text-sand-100/60">
              <tr><th className="text-left p-4">#</th><th className="text-left p-4">Corretor</th><th className="text-center p-4">Qtd. de leads</th><th className="text-left p-4">Origem</th><th className="text-left p-4">% entregues</th></tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-sand-100/55">Sem leads recebidos no período.</td></tr>
              ) : items.map((r, i) => (
                <tr key={r.associateId} className="border-t hairline">
                  <td className="p-4 text-sand-100/55">{i + 1}</td>
                  <td className="p-4 font-semibold">{r.name}</td>
                  <td className="p-4 text-center text-gold-300 font-bold">{r.count}</td>
                  <td className="p-4 text-xs">{r.origin ?? "—"}</td>
                  <td className="p-4 text-xs">{r.percent != null ? `${r.percent.toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Planejamento({ queueData }: { queueData: QueueResp | null }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        <div className="card p-4">
          <p className="text-[0.7rem] uppercase text-sand-100/55">Total agendado</p>
          <p className="text-3xl font-bold text-gold-300 mt-1">{queueData?.totalAgendados ?? "—"}</p>
          <p className="text-xs text-sand-100/55 mt-1">Leads aguardando envio nos próximos dias</p>
        </div>
        <div className="card p-4">
          <p className="text-[0.7rem] uppercase text-sand-100/55">Capacidade diária</p>
          <p className="text-3xl font-bold mt-1">{queueData?.capacityPerDay ?? "—"}</p>
          <p className="text-xs text-sand-100/55 mt-1">Quantos leads podem ser entregues por dia</p>
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="p-4 border-b hairline">
          <p className="text-[0.72rem] uppercase tracking-mono-xwide font-semibold text-gold-400/80 inline-flex items-center gap-1.5">
            <CalendarClock size={14} /> Agenda dos próximos envios
          </p>
          <p className="text-sm text-sand-100/60 mt-1">Envio automático às <strong>08:00</strong> de cada dia.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-app-subtle/60 text-[0.7rem] uppercase tracking-mono-xwide font-medium text-sand-100/60">
              <tr><th className="text-left p-4">Data</th><th className="text-center p-4">Qtd. de leads</th><th className="text-left p-4">Status</th></tr>
            </thead>
            <tbody>
              {(queueData?.diasPlanejados ?? []).length === 0 ? (
                <tr><td colSpan={3} className="p-8 text-center text-sand-100/55">Sem agendamentos futuros.</td></tr>
              ) : (queueData?.diasPlanejados ?? []).map((d) => (
                <tr key={d.date} className="border-t hairline">
                  <td className="p-4">{d.date}</td>
                  <td className="p-4 text-center font-bold">{d.count}</td>
                  <td className="p-4 text-xs uppercase tracking-mono-wide">{d.status ?? "AGUARDANDO"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

interface RoletaCfg {
  ativo?: boolean;
  intervalo?: number;
  inicio?: string;
  fim?: string;
  maxTransferencias?: number;
  diasSemana?: string[];
}

function RoletaAuto() {
  const showToast = useUi((s) => s.showToast);
  const [cfg, setCfg] = useState<RoletaCfg>({
    ativo: false, intervalo: 30, inicio: "08:00", fim: "20:00", maxTransferencias: 3,
    diasSemana: ["seg", "ter", "qua", "qui", "sex"],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<{ value?: RoletaCfg } | RoletaCfg>("/api/settings/leads.roleta");
        const data = (r as any).value ?? r;
        if (data) setCfg({ ...cfg, ...data });
      } catch { /* silent */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaving(true);
    try {
      // 2 endpoints:
      //   1) /api/settings/leads.roleta → UI config (dias, horário, intervalo)
      //   2) /api/distribution/inactivity-settings → backend engine de redistribuição
      //      (minutes, maxRedistributions, active) — esses são os que a fila usa de verdade
      await Promise.all([
        api.patch("/api/settings/leads.roleta", { value: cfg }),
        api.patch("/api/distribution/inactivity-settings", {
          minutes:            Math.max(1, Math.min(1440, Number(cfg.intervalo) || 30)),
          maxRedistributions: Math.max(1, Math.min(10,   Number(cfg.maxTransferencias) || 3)),
          active:             !!cfg.ativo,
        }),
      ]);
      showToast("Roleta + redistribuição salvas");
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setSaving(false); }
  }

  function toggleDia(d: string) {
    const has = cfg.diasSemana?.includes(d);
    setCfg({ ...cfg, diasSemana: has ? (cfg.diasSemana ?? []).filter(x => x !== d) : [...(cfg.diasSemana ?? []), d] });
  }

  return (
    <div className="card p-5 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 text-gold-300 font-semibold">
          <RotateCw size={14} />
          <span className="text-sm uppercase tracking-mono-xwide">Roleta Automática</span>
        </div>
        <Button variant="gold" onClick={save} loading={saving} style={{ padding: ".55rem 1.1rem" }}>
          <Save size={14} /> Salvar alterações
        </Button>
      </div>

      <div className="bg-blue-500/5 border border-blue-500/25 rounded p-3 mb-5 text-xs text-blue-100/85 flex gap-2">
        <Info size={14} className="text-blue-300 mt-0.5 shrink-0" />
        <p>
          Estas configurações aplicam-se à rotação automática de novos leads. Se o corretor não realizar o atendimento
          dentro do <strong>Intervalo de rotação</strong>, o lead é automaticamente transferido para o próximo corretor da fila —
          respeitando os <strong>dias e horários</strong> configurados abaixo.
        </p>
      </div>

      <div className="mb-5">
        <label className="text-sm font-medium text-sand-50 block mb-2">Ativar roleta automática</label>
        <label className="inline-flex items-center cursor-pointer">
          <input type="checkbox" className="sr-only peer" checked={!!cfg.ativo} onChange={(e) => setCfg({ ...cfg, ativo: e.target.checked })} />
          <div className="relative w-11 h-6 bg-app-subtle/70 border hairline rounded-full peer-checked:bg-gold-400/80 peer-checked:border-gold-400 transition-colors">
            <div className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-sand-50 transition-transform peer-checked:translate-x-5" />
          </div>
          <span className="ml-3 text-xs text-sand-100/60">{cfg.ativo ? "Ativada" : "Desativada"}</span>
        </label>
      </div>

      <div className="mb-5">
        <label className="text-sm font-medium text-sand-50 block mb-2 inline-flex items-center gap-1.5">
          Expediente durante a semana
          <HelpCircle size={14} className="text-sand-100/45" />
        </label>
        <div className="flex flex-wrap gap-3 text-sm">
          {[["dom","Dom"],["seg","Seg"],["ter","Ter"],["qua","Qua"],["qui","Qui"],["sex","Sex"],["sab","Sab"]].map(([k, l]) => (
            <label key={k} className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="accent-gold-400" checked={cfg.diasSemana?.includes(k) ?? false} onChange={() => toggleDia(k)} />
              {l}
            </label>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3 mb-5">
        <div>
          <label className="text-sm font-medium text-sand-50 block mb-1.5">
            <span className="text-red-400">*</span> Tempo sem resposta para redistribuir:
          </label>
          <select className="field-input" value={cfg.intervalo} onChange={(e) => setCfg({ ...cfg, intervalo: Number(e.target.value) })}>
            {[5, 10, 15, 20, 30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>após {m} minutos sem resposta</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-sand-50 block mb-1.5"><span className="text-red-400">*</span> Início expediente:</label>
          <input type="time" className="field-input" value={cfg.inicio ?? ""} onChange={(e) => setCfg({ ...cfg, inicio: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-medium text-sand-50 block mb-1.5"><span className="text-red-400">*</span> Fim expediente:</label>
          <input type="time" className="field-input" value={cfg.fim ?? ""} onChange={(e) => setCfg({ ...cfg, fim: e.target.value })} />
        </div>
      </div>

      <div className="mb-3">
        <label className="text-sm font-medium text-sand-50 block mb-1.5 inline-flex items-center gap-1.5">
          N.º Max. de transferências:
          <HelpCircle size={14} className="text-sand-100/45" />
        </label>
        <input
          type="number" min={1} max={10}
          className="field-input"
          value={cfg.maxTransferencias ?? 3}
          onChange={(e) => setCfg({ ...cfg, maxTransferencias: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}
