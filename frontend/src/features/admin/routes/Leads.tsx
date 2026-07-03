// Leads (admin master) · porte fiel · RASTREABILIDADE
// Endpoints: /api/leads?limit=20000 · /api/associates?limit=5000

import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Upload, UserPlus, X, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { Field } from "@/components/ui/Field";
import { useNavigate } from "react-router-dom";
import type { Lead, LeadStatus } from "@/types/lead";
import { fmtPhone, waUrl } from "@/lib/format";

interface AssociateBrief { id: string; user?: { name?: string }; category?: string; segment?: string }

interface LeadFull extends Lead {
  assignedTo?: { user?: { name?: string } };
  createdAt?: string;
  campaignName?: string;
}

const LEAD_TONE: Record<LeadStatus, "info" | "gold" | "warning" | "success" | "danger" | "neutral"> = {
  NEW: "info", QUALIFYING: "gold", NEGOTIATING: "success",
  CLOSING: "warning", CLOSED: "success", LOST: "danger",
};
const LEAD_LABEL: Record<LeadStatus, string> = {
  NEW: "Novo", QUALIFYING: "Qualificando", NEGOTIATING: "Negociando",
  CLOSING: "Em fechamento", CLOSED: "Fechado", LOST: "Perdido",
};

export function AdminLeads() {
  const [list, setList] = useState<LeadFull[]>([]);
  const [loading, setLoading] = useState(false);
  const [assignFor, setAssignFor] = useState<LeadFull | null>(null);
  const [q, setQ] = useState("");
  const [periodo, setPeriodo] = useState("");
  const [corretor, setCorretor] = useState("");
  const [segmento, setSegmento] = useState("");
  const [origem, setOrigem] = useState("");
  const [campanha, setCampanha] = useState("");
  const showToast = useUi((s) => s.showToast);
  const nav = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ data: LeadFull[] }>("/api/leads?limit=20000");
      setList(r.data ?? []);
    } catch (e: any) { showToast(`Erro: ${e?.message ?? e}`); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const origens = useMemo(() => [...new Set(list.map(l => l.origin).filter(Boolean) as string[])].sort(), [list]);
  const segmentos = useMemo(() => [...new Set(list.map(l => l.segment).filter(Boolean) as string[])].sort(), [list]);
  const corretores = useMemo(() => [...new Set(list.map(l => l.assignedTo?.user?.name).filter(Boolean) as string[])].sort(), [list]);
  const campanhas = useMemo(() => [...new Set(list.map(l => l.campaignName).filter(Boolean) as string[])].sort(), [list]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return list.filter((l) => {
      if (corretor && l.assignedTo?.user?.name !== corretor) return false;
      if (segmento && l.segment !== segmento) return false;
      if (origem && l.origin !== origem) return false;
      if (campanha && l.campaignName !== campanha) return false;
      if (periodo && l.createdAt) {
        const t0 = new Date(l.createdAt).getTime();
        const D = 86_400_000;
        const limit = periodo === "hoje" ? Date.now() - D
          : periodo === "7d" ? Date.now() - 7 * D
          : periodo === "30d" ? Date.now() - 30 * D : 0;
        if (limit > 0 && t0 < limit) return false;
      }
      if (t) {
        const hay = `${l.name ?? ""} ${(l as any).phoneMasked ?? ""} ${(l as any).phone ?? ""}`.toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [list, q, periodo, corretor, segmento, origem, campanha]);

  const atribuidos = useMemo(() => filtered.filter(l => !!l.assignedTo?.user?.name).length, [filtered]);
  const naoAtribuidos = filtered.length - atribuidos;

  const mediaPorDia = useMemo(() => {
    const dates = new Set<string>();
    filtered.forEach(l => { if (l.createdAt) dates.add(l.createdAt.slice(0, 10)); });
    return dates.size > 0 ? +(filtered.length / dates.size).toFixed(1) : 0;
  }, [filtered]);

  // Matriz · datas × corretores (top 5)
  const matrix = useMemo(() => {
    const topCors = corretores.slice(0, 5);
    const byDate = new Map<string, Record<string, number>>();
    filtered.forEach(l => {
      const d = l.createdAt?.slice(0, 10);
      const c = l.assignedTo?.user?.name;
      if (!d) return;
      if (!byDate.has(d)) byDate.set(d, {});
      const row = byDate.get(d)!;
      if (c && topCors.includes(c)) row[c] = (row[c] ?? 0) + 1;
    });
    const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a)).slice(0, 7);
    return { dates, topCors, byDate };
  }, [filtered, corretores]);

  function clearFilters() {
    setQ(""); setPeriodo(""); setCorretor(""); setSegmento(""); setOrigem(""); setCampanha("");
  }

  function exportCSV() {
    const headers = ["Nome", "Telefone", "Origem", "Segmento", "Status", "Corretor", "Criado em"];
    const rows = filtered.slice(0, 5000).map(l => [
      l.name, (l as any).phone ?? (l as any).phoneMasked ?? "", l.origin ?? "", l.segment ?? "", l.status ?? "",
      l.assignedTo?.user?.name ?? "", l.createdAt ?? "",
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `leads-${Date.now()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <span className="pill">Rastreabilidade</span>
          <h1 className="text-3xl md:text-4xl font-bold tracking-display-tight mt-2">Leads</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={exportCSV} style={{ padding: ".5rem 1rem" }}>
            <Download size={14} /> Exportar CSV
          </Button>
          <Button variant="outline" onClick={load} loading={loading} style={{ padding: ".5rem 1rem" }}>
            <RefreshCw size={14} /> Reprocessar
          </Button>
          <Button variant="gold" onClick={() => nav("/admin/ingestao")} style={{ padding: ".5rem 1rem" }}>
            <Upload size={14} /> Importar
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="card p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 mb-3">
          <Sel label="Período" value={periodo} onChange={setPeriodo}
               options={[["","Todos"],["hoje","Hoje"],["7d","Últimos 7"],["30d","Últimos 30"]]} />
          <Sel label="Corretor" value={corretor} onChange={setCorretor}
               options={[["","Todos os corretores"], ...corretores.map(c => [c, c] as [string, string])]} />
          <Sel label="Segmento" value={segmento} onChange={setSegmento}
               options={[["","Todos"], ...segmentos.map(s => [s, s] as [string, string])]} />
          <Sel label="Origem" value={origem} onChange={setOrigem}
               options={[["","Todas"], ...origens.map(o => [o, o] as [string, string])]} />
          <Sel label="Campanha" value={campanha} onChange={setCampanha}
               options={[["","Todas"], ...campanhas.map(c => [c, c] as [string, string])]} />
        </div>
        <div>
          <label className="text-[0.68rem] uppercase tracking-mono-xwide font-medium text-sand-100/55 mb-1 block">Buscar</label>
          <input
            type="text"
            placeholder="Nome, telefone…"
            className="field-input text-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between mt-3 text-xs text-sand-100/55">
          <span>{filtered.length} de {list.length} leads na seleção · exibindo {Math.min(50, filtered.length)}</span>
          <button onClick={clearFilters} className="text-gold-300 hover:text-gold-200 uppercase tracking-mono-wide font-medium">
            Limpar filtros
          </button>
        </div>
      </div>

      {/* 4 KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="card p-4">
          <p className="text-[0.7rem] uppercase text-sand-100/55">No filtro</p>
          <p className="text-3xl font-display font-light mt-1">{filtered.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-[0.7rem] uppercase text-sand-100/55">Atribuídos</p>
          <p className="text-3xl font-display font-light mt-1 text-emerald-300">{atribuidos}</p>
        </div>
        <div className="card p-4">
          <p className="text-[0.7rem] uppercase text-sand-100/55">Não atribuídos</p>
          <p className="text-3xl font-display font-light mt-1 text-amber-300">{naoAtribuidos}</p>
        </div>
        <div className="card p-4">
          <p className="text-[0.7rem] uppercase text-sand-100/55">Média/dia</p>
          <p className="text-3xl font-display font-light mt-1">{mediaPorDia}</p>
        </div>
      </div>

      {/* Matriz dia × corretor (top 5 corretores · últimos 7 dias) */}
      <div className="card overflow-hidden mb-5">
        <div className="p-4 border-b hairline">
          <p className="text-[0.72rem] uppercase tracking-mono-xwide font-semibold text-gold-400/80">Leads enviados por dia · por corretor</p>
          <p className="text-sm text-sand-100/60 mt-1">Consolidação diária do que foi distribuído (filtro aplicado).</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-app-subtle/60 text-[0.7rem] uppercase tracking-mono-xwide font-medium text-sand-100/60">
              <tr>
                <th className="text-left p-3">Dia ▼</th>
                {matrix.topCors.map((c) => (
                  <th key={c} className="text-center p-3 whitespace-nowrap" title={c}>
                    {c.split(" ").slice(0, 2).join(" ")}
                  </th>
                ))}
                <th className="text-right p-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {matrix.dates.length === 0 ? (
                <tr><td colSpan={matrix.topCors.length + 2} className="p-8 text-center text-sand-100/55">Sem dados no filtro.</td></tr>
              ) : matrix.dates.map((d) => {
                const row = matrix.byDate.get(d) ?? {};
                const total = matrix.topCors.reduce((acc, c) => acc + (row[c] ?? 0), 0);
                return (
                  <tr key={d} className="border-t hairline">
                    <td className="p-3 font-mono text-xs">{d.slice(5)}</td>
                    {matrix.topCors.map((c) => (
                      <td key={c} className="p-3 text-center text-sand-100/55">
                        {row[c] ? <span className="text-gold-300 font-semibold">{row[c]}</span> : "—"}
                      </td>
                    ))}
                    <td className="p-3 text-right font-semibold">{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lista resumida (50 primeiros) */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
            <tr>
              <th className="text-left p-3">Lead</th>
              <th className="text-left p-3">Origem</th>
              <th className="text-left p-3">Segmento</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Corretor</th>
              <th className="text-left p-3">Entrada</th>
              <th className="text-right p-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 50).map((l) => (
              <tr key={l.id} className="border-t hairline hover:bg-app-subtle/30">
                <td className="p-3">
                  <p className="font-semibold">{l.name}</p>
                  <p className="text-xs text-sand-100/55">
                    {fmtPhone((l as any).phone) || (l as any).phoneMasked || "—"}
                  </p>
                  {(l as any).phone && (
                    <a
                      href={waUrl((l as any).phone)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 mt-1 text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-400 hover:text-emerald-300"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.116 1.524 5.849L.057 23.55a.75.75 0 00.914.914l5.701-1.467A11.948 11.948 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.925 0-3.73-.5-5.292-1.376l-.378-.214-3.938 1.013 1.013-3.938-.214-.378A9.953 9.953 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                      WhatsApp
                    </a>
                  )}
                </td>
                <td className="p-3">{l.origin ?? "—"}</td>
                <td className="p-3">{l.segment ?? "—"}</td>
                <td className="p-3">{l.status ? <StatusPill tone={LEAD_TONE[l.status]}>{LEAD_LABEL[l.status]}</StatusPill> : "—"}</td>
                <td className="p-3">
                  {l.assignedTo?.user?.name
                    ? l.assignedTo.user.name
                    : <span className="text-amber-400/80 text-xs font-medium">Sem corretor</span>}
                </td>
                <td className="p-3 text-xs text-sand-100/55">{l.createdAt?.slice(0, 10) ?? "—"}</td>
                <td className="p-3 text-right">
                  <button
                    type="button"
                    onClick={() => setAssignFor(l)}
                    className="text-[0.7rem] uppercase tracking-mono-wide font-semibold text-gold-300 hover:text-gold-200 inline-flex items-center gap-1"
                    title="Atribuir/redistribuir manualmente"
                  >
                    <UserPlus size={12} /> {l.assignedTo?.user?.name ? "Reatribuir" : "Atribuir"}
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="p-10 text-center text-sand-100/55">Nenhum lead na seleção.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {assignFor && (
        <AssignLeadModal
          lead={assignFor}
          onClose={() => setAssignFor(null)}
          onDone={() => { setAssignFor(null); void load(); }}
        />
      )}
    </div>
  );
}

// Modal de atribuição · POST /api/leads/:id/assign
// 3 modos: specific (escolhe corretor) · queue (rodízio) · race (top N online disputam)
function AssignLeadModal({ lead, onClose, onDone }: {
  lead: LeadFull;
  onClose: () => void;
  onDone: () => void;
}) {
  const showToast = useUi((s) => s.showToast);
  const [mode, setMode] = useState<"specific" | "queue" | "race">("specific");
  const [associateId, setAssociateId] = useState("");
  const [raceMinutes, setRaceMinutes] = useState(10);
  const [raceCandidates, setRaceCandidates] = useState(5);
  const [associates, setAssociates] = useState<AssociateBrief[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<{ data: AssociateBrief[] }>("/api/associates?limit=2000");
        // Filtra por segmento do lead se disponível, mas mantém todos como opção
        const all = r.data ?? [];
        const segMatch = all.filter((a) => a.segment === lead.segment);
        setAssociates(segMatch.length > 0 ? [...segMatch, ...all.filter((a) => a.segment !== lead.segment)] : all);
      } catch { /* silent */ }
    })();
  }, [lead.segment]);

  async function submit() {
    if (mode === "specific" && !associateId) { showToast("Selecione o corretor"); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { mode };
      if (mode === "specific") payload.associateId = associateId;
      if (mode === "race") { payload.raceMinutes = raceMinutes; payload.raceCandidates = raceCandidates; }
      await api.post(`/api/leads/${lead.id}/assign`, payload);
      showToast(
        mode === "specific" ? "Lead atribuído" :
        mode === "queue" ? "Lead enviado pra fila" :
        `Disputa criada (${raceMinutes}min · top ${raceCandidates})`
      );
      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] calebe-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-app-canvas border hairline rounded-lg w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b hairline">
          <div>
            <p className="text-xs uppercase tracking-mono-wide font-semibold text-sand-100/55">Atribuição manual</p>
            <h2 className="font-bold text-lg">{lead.name}</h2>
            <p className="text-xs text-sand-100/65 mt-0.5">
              {lead.segment ? `Segmento: ${lead.segment} · ` : ""}
              {lead.assignedTo?.user?.name ? `Atual: ${lead.assignedTo.user.name}` : "Sem corretor"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sand-100/55 hover:text-sand-50" aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {/* Tabs de modo */}
          <div className="grid grid-cols-3 gap-1 border hairline rounded p-1 bg-app-subtle/30">
            <ModeTab active={mode === "specific"} onClick={() => setMode("specific")}>Específico</ModeTab>
            <ModeTab active={mode === "queue"} onClick={() => setMode("queue")}>Fila</ModeTab>
            <ModeTab active={mode === "race"} onClick={() => setMode("race")}>Disputa</ModeTab>
          </div>

          {mode === "specific" && (
            <div className="space-y-2">
              <p className="text-xs text-sand-100/65">Atribui diretamente ao corretor escolhido. Corretores do segmento do lead aparecem primeiro.</p>
              <select className="field-input text-sm" value={associateId} onChange={(e) => setAssociateId(e.target.value)} required>
                <option value="">Selecione o corretor…</option>
                {associates.map((a) => {
                  const segLabel = a.segment === lead.segment ? "[mesmo segmento] " : "";
                  return (
                    <option key={a.id} value={a.id}>
                      {segLabel}{a.user?.name ?? a.id}{a.category ? ` · ${a.category}` : ""}{a.segment ? ` · ${a.segment}` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {mode === "queue" && (
            <div className="text-xs text-sand-100/65 bg-blue-500/5 border border-blue-500/25 rounded p-3">
              O lead volta pra fila automática · o distribuidor escolhe o próximo corretor segundo as cotas e prioridades da roleta.
            </div>
          )}

          {mode === "race" && (
            <div className="space-y-3">
              <p className="text-xs text-sand-100/65 bg-orange-500/5 border border-orange-500/25 rounded p-3">
                Notifica os <strong>top N corretores online</strong> por score. O primeiro a clicar "Pegar" leva. Se ninguém pegar até o timer expirar, vai pro rodízio normal.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Tempo (min)" type="number" min={2} max={60} value={String(raceMinutes)} onChange={(e) => setRaceMinutes(Math.max(2, Math.min(60, Number(e.target.value) || 10)))} />
                <Field label="Candidatos" type="number" min={2} max={20} value={String(raceCandidates)} onChange={(e) => setRaceCandidates(Math.max(2, Math.min(20, Number(e.target.value) || 5)))} />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t hairline">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button
              type="button"
              variant="gold"
              onClick={submit}
              disabled={saving || (mode === "specific" && !associateId)}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              {saving ? "Atribuindo…" : "Confirmar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-semibold py-2 px-3 rounded transition-colors ${
        active ? "bg-gold-400 text-app-canvas" : "text-sand-100/65 hover:text-sand-50"
      }`}
    >
      {children}
    </button>
  );
}

function Sel({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <div>
      <label className="text-[0.68rem] uppercase tracking-mono-xwide font-medium text-sand-100/55 mb-1 block">{label}</label>
      <select className="field-input py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
      </select>
    </div>
  );
}
