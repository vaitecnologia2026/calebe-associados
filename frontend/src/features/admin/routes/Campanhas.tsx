// Central de Campanhas — dashboard de performance (zerado, conta após o disparo).
// Funil de campanhas + criador + campanha rodando (processando) + histórico com gráfico
// + feed de quem respondeu (com corretor) + conversa. 2026-07-01.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Send, Upload, Megaphone, Play, Pause, Loader2, X, RefreshCw, MessageSquare, User, TrendingUp } from "lucide-react";

type FunnelStage = { key: string; label: string; value: number };
type Overview = { campanhas: number; disparado: number; respondeu: number; falhas: number; sem_whatsapp: number; em_negociacao: number; ganho: number; funnel: FunnelStage[] };
type Pool = { disponivel: number; nao_abordado: number };
type NumberOpt = { id: string; number: string; msgs24h: number; quality?: string };
type TemplateOpt = { name: string; vars: number };
type Campaign = { id: string; name: string; status: string; templateName: string; targetCount: number; intervalMs: number; phoneNumberIds: string[]; statSent: number; statFailed: number; statNoWhatsapp: number; statResponded: number; createdAt?: string; buckets?: Record<string, number> };
type Resp = { leadId: string; lead_name: string; corretor: string | null; respondedAt: string | null; conv_id: string | null; roletaStatus?: string | null; roletaAttempts?: number };
type ChatMsg = { id: string; direction: string; content?: string | null; content_type?: string | null; created_at?: string };

const fmt = (n: number) => (n ?? 0).toLocaleString("pt-BR");
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);
const hhmm = (s?: string | null) => s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const qColor = (q?: string) => q === "GREEN" ? "#34d399" : q === "YELLOW" ? "#fbbf24" : q === "RED" ? "#f87171" : "#94a3b8";
const STATUS_BADGE: Record<string, string> = {
  running: "bg-emerald-400/20 text-emerald-300", done: "bg-blue-500/20 text-blue-300",
  paused: "bg-amber-400/20 text-amber-300", draft: "bg-sand-100/10 text-sand-100/60", error: "bg-red-500/20 text-red-300",
};
const STATUS_PT: Record<string, string> = { running: "processando", done: "concluída", paused: "pausada", draft: "rascunho", error: "erro" };
const ROLETA_CHIP: Record<string, [string, string]> = {
  pending: ["🎡 na roleta", "bg-amber-400/20 text-amber-300"],
  holding: ["🎡 aguardando corretor (5min)", "bg-amber-400/20 text-amber-300"],
  spinning: ["🎡 repassado", "bg-amber-400/20 text-amber-300"],
  attended: ["✓ atendido", "bg-emerald-400/20 text-emerald-300"],
  exhausted: ["sem atendimento", "bg-red-500/20 text-red-300"],
};
const FUNNEL_COLORS = ["#378ADD", "#8fc73e", "#e8c020", "#ef9f27", "#1D9E75"];

function FunnelCone({ stages }: { stages: FunnelStage[] }) {
  const has = stages.some(s => s.value > 0);
  const W = 340, segH = 42, gap = 6, pad = 6, cx = W / 2, n = stages.length, minFrac = 0.3;
  const H = n * segH + (n - 1) * gap + pad * 2;
  const fracAt = (i: number) => 1 - (i / n) * (1 - minFrac);
  const top = Math.max(1, stages[0]?.value || 0);
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Funil de campanhas">
        {stages.map((s, i) => {
          const yTop = pad + i * (segH + gap);
          const topW = W * fracAt(i), botW = W * fracAt(i + 1);
          const tl = cx - topW / 2, tr = cx + topW / 2, bl = cx - botW / 2, br = cx + botW / 2;
          const mid = yTop + segH / 2, p = has ? Math.round((100 * s.value) / top) : 0;
          return (
            <g key={s.key}>
              <polygon points={`${tl},${yTop} ${tr},${yTop} ${br},${yTop + segH} ${bl},${yTop + segH}`} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} opacity={has ? 1 : 0.25} />
              <text x={cx} y={mid - 3} textAnchor="middle" fontSize="11" fill="#0d1c08" opacity="0.8">{s.label}</text>
              <text x={cx} y={mid + 13} textAnchor="middle" fontSize="15" fontWeight="700" fill="#0a1206">{fmt(s.value)}{has && <tspan fontSize="10" fontWeight="400" fillOpacity="0.7"> · {p}%</tspan>}</text>
            </g>
          );
        })}
      </svg>
      {!has && <div className="text-center text-xs text-sand-100/40 -mt-2">zerado — enche depois do 1º disparo</div>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-sand-100/5 p-3">
      <div className="text-xs text-sand-100/60">{label}</div>
      <div className={`text-2xl font-medium tabular-nums ${tone || "text-sand-100"}`}>{value}</div>
    </div>
  );
}

// Mini gráfico de barra por campanha: enviados (azul) com respondeu (verde) + falha (vermelho)
function CampaignBar({ c, max }: { c: Campaign; max: number }) {
  const w = (v: number) => `${Math.round((100 * v) / Math.max(1, max))}%`;
  const ruim = (c.statFailed || 0) + (c.statNoWhatsapp || 0);
  return (
    <div className="h-2 rounded-full bg-sand-100/10 overflow-hidden flex">
      <div style={{ width: w((c.statSent || 0) - (c.statResponded || 0) - 0) }} className="h-full bg-blue-500/70" />
      <div style={{ width: w(c.statResponded || 0) }} className="h-full bg-emerald-400" />
      <div style={{ width: w(ruim) }} className="h-full bg-red-500/60" />
    </div>
  );
}

export function Campanhas() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [pool, setPool] = useState<Pool | null>(null);
  const [numbers, setNumbers] = useState<NumberOpt[]>([]);
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [list, setList] = useState<Campaign[]>([]);
  const [active, setActive] = useState<Campaign | null>(null);
  const [responses, setResponses] = useState<Resp[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [drawer, setDrawer] = useState<{ resp: Resp; msgs: ChatMsg[]; loading: boolean } | null>(null);
  const timer = useRef<any>(null);
  const [form, setForm] = useState({ name: "", templateName: "", targetCount: 200, intervalSec: 8, onlyNotContacted: true, phoneNumberIds: [] as string[] });

  const loadOv = () => api.get<Overview>("/api/campaigns/overview").then(setOv).catch(() => {});
  const loadPool = () => api.get<Pool>("/api/campaigns/pool").then(setPool).catch(() => {});
  const loadList = () => api.get<{ data: Campaign[] }>("/api/campaigns").then(r => {
    const data = r.data || []; setList(data);
    const running = data.find(c => c.status === "running");
    if (running && !active) setActive(running); // mostra "processando" ao abrir
  }).catch(() => {});
  async function loadOptions() {
    try {
      const o = await api.get<{ numbers: NumberOpt[]; templates: TemplateOpt[] }>("/api/campaigns/options");
      setNumbers(o.numbers || []); setTemplates(o.templates || []);
      if (!form.templateName && o.templates?.[0]) setForm(f => ({ ...f, templateName: o.templates[0].name }));
    } catch {}
  }
  const loadActive = (id: string) => api.get<Campaign>(`/api/campaigns/${id}`).then(setActive).catch(() => {});
  const loadResponses = (id: string) => api.get<{ data: Resp[] }>(`/api/campaigns/${id}/responses`).then(r => setResponses(r.data || [])).catch(() => {});

  useEffect(() => { loadOv(); loadPool(); loadOptions(); loadList(); }, []);
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (active?.id) {
      loadResponses(active.id);
      timer.current = setInterval(() => { loadActive(active.id); loadResponses(active.id); loadOv(); loadList(); }, 4000);
    }
    return () => timer.current && clearInterval(timer.current);
  }, [active?.id]);

  const toggleNumber = (id: string) => setForm(f => ({ ...f, phoneNumberIds: f.phoneNumberIds.includes(id) ? f.phoneNumberIds.filter(x => x !== id) : [...f.phoneNumberIds, id] }));

  async function createAndStart() {
    setErr(null);
    if (!form.name.trim()) return setErr("Dê um nome à campanha.");
    if (!form.templateName) return setErr("Escolha um template.");
    if (numbers.filter(n => form.phoneNumberIds.includes(n.id)).some(n => n.quality === "RED")) return setErr("Você selecionou um número VERMELHO. Tire-o antes de disparar.");
    setBusy(true);
    try {
      const camp = await api.post<Campaign & { recipients: number }>("/api/campaigns", { name: form.name.trim(), templateName: form.templateName, targetCount: Number(form.targetCount), intervalMs: Math.max(1, Number(form.intervalSec)) * 1000, onlyNotContacted: form.onlyNotContacted, phoneNumberIds: form.phoneNumberIds });
      await api.post(`/api/campaigns/${camp.id}/start`, {});
      setForm(f => ({ ...f, name: "" }));
      setActive({ ...camp, status: "running" });
      loadList();
    } catch (e: any) { setErr(e?.message || "Falha ao criar campanha."); }
    finally { setBusy(false); }
  }
  const pauseActive = () => active && api.post(`/api/campaigns/${active.id}/pause`, {}).then(() => loadActive(active.id)).catch(() => {});
  const resumeActive = () => active && api.post(`/api/campaigns/${active.id}/start`, {}).then(() => loadActive(active.id)).catch(() => {});

  async function openConversation(resp: Resp) {
    if (!resp.conv_id) return;
    setDrawer({ resp, msgs: [], loading: true });
    try { const r = await api.get<{ data: ChatMsg[] }>(`/api/chat-history/${encodeURIComponent(resp.conv_id)}?limit=500`); setDrawer({ resp, msgs: r.data || [], loading: false }); }
    catch { setDrawer({ resp, msgs: [], loading: false }); }
  }
  async function doImport() {
    const leads = importText.split("\n").map(l => l.trim()).filter(Boolean).map(l => { const p = l.split(/[,;\t]/).map(x => x.trim()); return { name: p[0] || "", phone: p[1] || "" }; }).filter(l => l.name && l.phone);
    if (!leads.length) return setErr("Cole linhas no formato: Nome, telefone");
    setBusy(true);
    try { const r = await api.post<{ created: number; invalidos: number }>("/api/campaigns/import", { leads }); setErr(null); setShowImport(false); setImportText(""); await loadPool(); alert(`Importados: ${r.created} · inválidos: ${r.invalidos}`); }
    catch (e: any) { setErr(e?.message || "Falha ao importar."); } finally { setBusy(false); }
  }

  const running = list.find(c => c.status === "running") || (active?.status === "running" ? active : null);
  const maxSent = Math.max(1, ...list.map(c => c.statSent || 0));
  const b = active?.buckets || {};
  const aSent = active?.statSent ?? 0, aResp = active?.statResponded ?? 0, aQueued = b.queued ?? 0;

  return (
    <div className="p-4 md:p-6 text-sand-100">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold-400/15 grid place-items-center text-gold-300"><Megaphone size={20} /></div>
          <div>
            <h1 className="text-xl font-medium">Central de campanhas</h1>
            <p className="text-sm text-sand-100/60">Performance de disparos · {fmt(pool?.disponivel ?? 0)} leads disponíveis pra campanha</p>
          </div>
        </div>
        <button onClick={() => setShowImport(true)} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-sand-100/15 hover:bg-sand-100/10"><Upload size={16} /> Importar leads</button>
      </div>

      {/* KPIs de campanha (zerados até haver disparo) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Stat label="Disparados" value={fmt(ov?.disparado ?? 0)} tone="text-blue-300" />
        <Stat label="Responderam" value={fmt(ov?.respondeu ?? 0)} tone="text-emerald-400" />
        <Stat label="% resposta" value={`${pct(ov?.respondeu ?? 0, ov?.disparado ?? 0)}%`} tone="text-emerald-400" />
        <Stat label="Em negociação" value={fmt(ov?.em_negociacao ?? 0)} tone="text-amber-300" />
        <Stat label="Vendas" value={fmt(ov?.ganho ?? 0)} tone="text-gold-300" />
      </div>

      {/* campanha rodando · processando (persiste ao recarregar) */}
      {running && (
        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-400/30 p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-emerald-300 font-medium"><Loader2 size={16} className="animate-spin" /> Processando: {running.name}</div>
            <div className="flex items-center gap-3">
              <span className="text-sm tabular-nums text-emerald-200">{fmt(running.statSent)}/{fmt(running.targetCount)}</span>
              {active?.id === running.id
                ? <button onClick={pauseActive} className="text-emerald-200 hover:text-white" title="Pausar"><Pause size={16} /></button>
                : <button onClick={() => setActive(running)} className="text-xs underline text-emerald-200">ver</button>}
            </div>
          </div>
          <div className="h-2 rounded-full bg-emerald-900/40 overflow-hidden">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: `${pct(running.statSent, running.targetCount)}%` }} />
          </div>
          <div className="text-xs text-emerald-200/70 mt-1.5">{fmt(running.statResponded)} responderam · {fmt(running.statFailed + running.statNoWhatsapp)} não entregues</div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="rounded-2xl bg-sand-100/5 border border-sand-100/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[15px] font-medium">Funil de campanhas</h2>
            <button onClick={() => { loadOv(); loadList(); }} className="text-sand-100/50 hover:text-sand-100"><RefreshCw size={15} /></button>
          </div>
          <FunnelCone stages={ov?.funnel || [{ key: "d", label: "Disparados", value: 0 }, { key: "r", label: "Responderam", value: 0 }, { key: "a", label: "Em atendimento", value: 0 }, { key: "n", label: "Em negociação", value: 0 }, { key: "g", label: "Vendas (ganho)", value: 0 }]} />
        </div>

        <div className="rounded-2xl bg-sand-100/5 border border-sand-100/10 p-4">
          <h2 className="text-[15px] font-medium mb-3">Nova campanha</h2>
          <label className="block text-xs text-sand-100/60 mb-1">Nome da campanha</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Reabordagem litoral · julho" className="w-full mb-3 px-3 py-2 rounded-lg bg-sand-100/10 border border-sand-100/15 text-sand-100 placeholder:text-sand-100/30 outline-none focus:border-sand-100/40" />
          <label className="block text-xs text-sand-100/60 mb-1.5">Número(s) <span className="text-sand-100/40">— qualidade Meta · nenhum = todos GREEN</span></label>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {numbers.map(n => {
              const on = form.phoneNumberIds.includes(n.id);
              return (
                <button key={n.id} onClick={() => toggleNumber(n.id)} className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${on ? "bg-emerald-400/20 border-emerald-400/50 text-emerald-200" : "bg-sand-100/5 border-sand-100/15 text-sand-100/70"}`} title={`Qualidade Meta · ${n.msgs24h} msgs/24h`}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: qColor(n.quality), display: "inline-block", flex: "none" }} />{n.number.replace("+55 ", "")}
                </button>
              );
            })}
          </div>
          <label className="block text-xs text-sand-100/60 mb-1">Template</label>
          <select value={form.templateName} onChange={e => setForm(f => ({ ...f, templateName: e.target.value }))} className="w-full mb-3 px-3 py-2 rounded-lg bg-sand-100/10 border border-sand-100/15 text-sand-100 outline-none">
            {templates.map(t => <option key={t.name} value={t.name} className="bg-slate-800">{t.name} ({t.vars} var)</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><label className="block text-xs text-sand-100/60 mb-1">Qtd. de leads</label><input type="number" value={form.targetCount} min={1} max={5000} onChange={e => setForm(f => ({ ...f, targetCount: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-lg bg-sand-100/10 border border-sand-100/15 text-sand-100 outline-none" /></div>
            <div><label className="block text-xs text-sand-100/60 mb-1">Intervalo (s)</label><input type="number" value={form.intervalSec} min={1} max={300} onChange={e => setForm(f => ({ ...f, intervalSec: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-lg bg-sand-100/10 border border-sand-100/15 text-sand-100 outline-none" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer"><input type="checkbox" checked={form.onlyNotContacted} onChange={e => setForm(f => ({ ...f, onlyNotContacted: e.target.checked }))} /> Somente leads não abordados</label>
          {err && <div className="text-sm text-red-300 mb-2">{err}</div>}
          <button onClick={createAndStart} disabled={busy} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"><Send size={16} /> {busy ? "Disparando…" : "Criar e disparar campanha"}</button>
        </div>
      </div>

      {/* histórico de campanhas com gráfico */}
      <div className="rounded-2xl bg-sand-100/5 border border-sand-100/10 p-4 mb-4">
        <h2 className="text-[15px] font-medium mb-3">Campanhas ({list.length})</h2>
        {list.length === 0 ? <div className="text-sm text-sand-100/40 py-6 text-center">Nenhuma campanha ainda. Crie a primeira acima.</div> : (
          <div className="space-y-2">
            {list.map(c => (
              <button key={c.id} onClick={() => setActive(c)} className={`w-full text-left rounded-xl border p-3 hover:bg-sand-100/5 ${active?.id === c.id ? "border-gold-400/40 bg-sand-100/5" : "border-sand-100/10"}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_BADGE[c.status] || "bg-sand-100/10"}`}>{STATUS_PT[c.status] || c.status}</span>
                  </div>
                  <span className="text-xs text-sand-100/40 flex-none">{hhmm(c.createdAt)}</span>
                </div>
                <CampaignBar c={c} max={maxSent} />
                <div className="flex items-center gap-4 mt-1.5 text-xs text-sand-100/60">
                  <span className="text-blue-300">{fmt(c.statSent)} enviados</span>
                  <span className="text-emerald-400">{fmt(c.statResponded)} resp ({pct(c.statResponded, c.statSent)}%)</span>
                  <span className="text-red-400">{fmt(c.statFailed + c.statNoWhatsapp)} não entregues</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* detalhe da campanha selecionada: quem respondeu + conversa */}
      {active && (
        <div className="rounded-2xl bg-sand-100/5 border border-sand-100/10 p-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[15px] font-medium">Responderam · {active.name}</h2>
            <button onClick={() => setActive(null)} className="text-sand-100/40 hover:text-sand-100"><X size={16} /></button>
          </div>
          <p className="text-xs text-sand-100/50 mb-3">Clique pra ver a conversa. Cada resposta vai pro corretor responsável.</p>
          {responses.length === 0 ? <div className="text-sm text-sand-100/40 py-5 text-center">Ninguém respondeu ainda — aparece aqui em tempo real.</div> : (
            <div className="divide-y divide-sand-100/10">
              {responses.map(r => (
                <button key={r.leadId} onClick={() => openConversation(r)} disabled={!r.conv_id} className="w-full flex items-center justify-between py-2.5 text-left hover:bg-sand-100/5 px-2 rounded-lg disabled:opacity-50">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-emerald-400/15 grid place-items-center text-emerald-300 flex-none"><MessageSquare size={15} /></div>
                    <div className="min-w-0"><div className="text-sm font-medium truncate">{r.lead_name}</div><div className="text-xs text-sand-100/50 flex items-center gap-1.5 flex-wrap"><User size={11} /> {r.corretor || "sem corretor"}{r.roletaStatus && ROLETA_CHIP[r.roletaStatus] && <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${ROLETA_CHIP[r.roletaStatus][1]}`}>{ROLETA_CHIP[r.roletaStatus][0]}{(r.roletaAttempts ?? 0) > 1 ? ` ·${r.roletaAttempts}x` : ""}</span>}</div></div>
                  </div>
                  <div className="text-xs text-sand-100/40 flex-none">{hhmm(r.respondedAt)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setDrawer(null)}>
          <div className="w-full max-w-md h-full bg-slate-900 border-l border-sand-100/15 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-sand-100/10 flex items-center justify-between">
              <div className="min-w-0"><div className="font-medium truncate">{drawer.resp.lead_name}</div><div className="text-xs text-sand-100/50 flex items-center gap-1"><User size={11} /> {drawer.resp.corretor || "sem corretor"}</div></div>
              <button onClick={() => setDrawer(null)}><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {drawer.loading ? <div className="text-sand-100/40 text-sm text-center py-8">carregando…</div> : drawer.msgs.length === 0 ? <div className="text-sand-100/40 text-sm text-center py-8">sem mensagens</div> : drawer.msgs.map(m => (
                <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${m.direction === "outbound" ? "bg-emerald-600/30 text-emerald-50" : "bg-sand-100/10 text-sand-100"}`}>
                    {m.content_type && m.content_type !== "text" ? <span className="italic opacity-70">[{m.content_type}]</span> : <p className="whitespace-pre-wrap leading-relaxed">{m.content || "(vazio)"}</p>}
                    <div className="text-[10px] opacity-50 mt-1 text-right">{hhmm(m.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setShowImport(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-sand-100/15 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><h3 className="text-base font-medium">Importar leads novos</h3><button onClick={() => setShowImport(false)}><X size={18} /></button></div>
            <p className="text-sm text-sand-100/60 mb-2">Uma linha por lead: <code className="text-sand-100/80">Nome, telefone</code>. Entram no bolsão.</p>
            <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={8} placeholder={"João Silva, 47999998888"} className="w-full px-3 py-2 rounded-lg bg-sand-100/10 border border-sand-100/15 text-sand-100 placeholder:text-sand-100/30 outline-none font-mono text-sm mb-3" />
            <button onClick={doImport} disabled={busy} className="w-full py-2.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50">{busy ? "Importando…" : "Importar"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
