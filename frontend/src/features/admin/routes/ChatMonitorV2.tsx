// =====================================================================
// Centro de Operações Comerciais (admin) · /admin/chat-monitor-v2
// Evolução visual do Monitoramento de conversas (ChatMonitor.tsx).
// NÃO substitui a tela atual — rota isolada. NÃO altera regra de negócio:
//   - colunas = espelho 1:1 dos status existentes (convStatus)
//   - SLA = getSlaMinutos/getSlaColor existentes
//   - tempo real = SSE que o store já registra (registerSse)
//   - ações (status/transferir/ligar) reusam endpoints que o sistema já usa
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw, Loader2, Phone, Search, MapPin, Building2, Trophy, Info } from "lucide-react";
import { useConversations } from "@/store/conversations";
import { useUi } from "@/store/ui";
import { usePolling } from "@/hooks/usePolling";
import { getSlaMinutos, getSlaColor, formatTime, formatLeadTelForCorretor, waUrl } from "@/lib/format";
import { CHAT_STATUS, LEAD_TO_CHAT_STATUS, type ChatStatus } from "@/types/conversation";
import type { Conversation, LeadStatus, Message } from "@/types/conversation";
import { api } from "@/lib/api";
import { ChatStream } from "@/components/chat/ChatStream";
import { setLeadStatus, voiceCall } from "@/features/corretor/chat-v2/chat-v2-api";
import "./chat-monitor-v2.css";

// ---------- mapeamentos (todos baseados nos status que JÁ existem) ----------
function convStatus(c: Conversation): ChatStatus | undefined {
  if (c.status) return c.status;
  const ls = c.lead?.status;
  return ls ? LEAD_TO_CHAT_STATUS[ls] : undefined;
}
const CHAT_TO_LEAD: Partial<Record<ChatStatus, LeadStatus>> = {
  novo: "NEW", qualificando: "QUALIFYING", negociando: "NEGOTIATING",
  fechamento: "CLOSING", fechado: "CLOSED", perdido: "LOST",
};
const STATUS_OPTIONS: [LeadStatus, string][] = [
  ["NEW", "Novo lead"], ["QUALIFYING", "Qualificando"], ["NEGOTIATING", "Negociando"],
  ["CLOSING", "Fechamento"], ["CLOSED", "Ganho"], ["LOST", "Perdido"],
];

type ColKey = ChatStatus | "encerrados";
const COLUMNS: { key: ColKey; label: string; sub: string; statuses: ChatStatus[]; color: string }[] = [
  { key: "novo",         label: "Pendente",   sub: "Recebidos · não atendidos",     statuses: ["novo"],                    color: "var(--c-novo)" },
  { key: "qualificando", label: "Atendendo",  sub: "Primeiro contato feito",        statuses: ["qualificando"],            color: "var(--c-qualif)" },
  { key: "negociando",   label: "Negociando", sub: "Interesse demonstrado",         statuses: ["negociando"],              color: "var(--c-negoc)" },
  { key: "fechamento",   label: "Fechamento", sub: "Proposta · contrato · reserva", statuses: ["fechamento"],              color: "var(--c-fecham)" },
  { key: "fechado",      label: "Ganho",      sub: "Venda concluída",               statuses: ["fechado"],                 color: "var(--c-ganho)" },
  { key: "encerrados",   label: "Encerrados", sub: "Perdidos · descartados",        statuses: ["perdido", "descartado"],   color: "var(--c-perd)" },
];

// ---------- helpers ----------
function ini(name?: string): string {
  if (!name) return "—";
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function firstName(name?: string): string { return (name ?? "—").trim().split(/\s+/)[0]; }
function isWaiting(c: Conversation): boolean { return c.lastMessage?.direction === "inbound"; }
function slaClass(min: number): "ok" | "warn" | "crit" | "over" {
  if (min <= 4) return "ok";
  if (min <= 9) return "warn";
  if (min <= 19) return "crit";
  return "over";
}
function slaText(min: number): string { return min === 0 ? "em dia" : `${min}min`; }
// Campos que podem não vir no payload slim — leitura defensiva (degrada elegante)
function getCity(c: Conversation): string | undefined {
  const l = c.lead as Record<string, unknown> | undefined;
  return (l?.city as string) || (l?.cidade as string) || undefined;
}
function getProperty(c: Conversation): string | undefined {
  const l = c.lead as Record<string, unknown> | undefined;
  const lp = (l?.linkedProperty as Record<string, unknown>) || (l?.property as Record<string, unknown>);
  return (lp?.name as string) || (lp?.title as string) || (l?.propertyName as string) || undefined;
}
function lastSeen(c: Conversation): number | null {
  const u = c.associate?.user as Record<string, unknown> | undefined;
  const ls = u?.lastSeenAt as string | undefined;
  if (!ls) return null;
  const t = new Date(ls).getTime();
  return Number.isFinite(t) ? t : null;
}
function isToday(iso?: string): boolean {
  if (!iso) return false;
  const d = new Date(iso); const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
// Adaptação de mensagem (replica o store, mas LOCAL no drawer — não toca na lista de 10k)
function isVaiActivityLocal(m: Partial<Message>): boolean {
  const ct = String(m.contentType ?? "").toLowerCase();
  if (ct === "activity" || ct === "system" || ct === "event") return true;
  const text = String(m.text ?? "");
  return /\b(iniciou|encerrou|transferiu|assumiu|finalizou|reabriu)\s+o\s+atendimento\b/i.test(text);
}
function adaptMsgLocal(m: Message): Message {
  const direction = m.direction === "OUT" ? "outbound" : m.direction === "IN" ? "inbound" : m.direction;
  return { ...m, direction, from: direction === "outbound" ? "corretor" : "lead", text: m.text ?? "", contentType: m.contentType ?? "text", createdAt: m.createdAt ?? undefined };
}

type FilterKey = "todos" | "comconversa" | "aguardando" | "critico" | "g5" | "g10" | "negociando" | "fechamento" | "ganho";

export function ChatMonitorV2() {
  const list = useConversations((s) => s.list);
  const fetchList = useConversations((s) => s.fetchList);
  const registerSse = useConversations((s) => s.registerSse);
  const isLoading = useConversations((s) => s.isLoading);

  const [filter, setFilter] = useState<FilterKey>("todos");
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [corr, setCorr] = useState("");
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [viewingId, setViewingId] = useState<string | null>(null);

  useEffect(() => {
    void fetchList();
    const unsub = registerSse();
    return unsub;
  }, [fetchList, registerSse]);
  // Pausa o polling enquanto o drawer está aberto → não reprocessa as 10k conversas
  // (nem trava a thread) enquanto o admin lê uma conversa.
  usePolling(() => fetchList(), { intervalMs: 30000, immediate: false, enabled: !viewingId });

  // Decora uma vez (status/waiting/sla) — base de tudo
  const decorated = useMemo(() => list.map((c) => {
    const status = convStatus(c);
    return { c, status, waiting: isWaiting(c), sla: getSlaMinutos(c), hasMsg: !!c.lastMessage };
  }), [list]);

  const q = search.trim().toLowerCase();
  const passFilter = (d: typeof decorated[number]): boolean => {
    const name = (d.c.lead?.name ?? "").toLowerCase();
    const cn = d.c.associate?.user?.name ?? "";
    if (q && !(name.includes(q) || cn.toLowerCase().includes(q))) return false;
    if (city && getCity(d.c) !== city) return false;
    if (corr && cn !== corr) return false;
    switch (filter) {
      case "comconversa": return d.hasMsg;
      case "aguardando": return d.waiting;
      case "critico":    return d.sla >= 10;
      case "g5":         return d.sla >= 5;
      case "g10":        return d.sla >= 10;
      case "negociando": return d.status === "negociando";
      case "fechamento": return d.status === "fechamento";
      case "ganho":      return d.status === "fechado";
      default:           return true;
    }
  };

  const grouped = useMemo(() => {
    const out: Record<string, typeof decorated> = {};
    for (const col of COLUMNS) out[col.key] = [];
    for (const d of decorated) {
      if (!d.status) continue;
      if (!passFilter(d)) continue;
      const col = COLUMNS.find((c) => c.statuses.includes(d.status as ChatStatus));
      if (col) out[col.key].push(d);
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => (Number(b.waiting) - Number(a.waiting)) || (b.sla - a.sla));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decorated, filter, q, city, corr]);

  // ---------- KPIs (todos computáveis com o dado atual) ----------
  const kpis = useMemo(() => {
    const ativas = decorated.filter((d) => d.status && !["perdido", "fechado", "descartado"].includes(d.status));
    const aguardando = decorated.filter((d) => d.waiting);
    const esperaMedia = aguardando.length
      ? Math.round(aguardando.reduce((s, d) => s + d.sla, 0) / aguardando.length) : 0;
    const ganhosHoje = decorated.filter((d) => d.status === "fechado" && isToday(d.c.lastMessageAt)).length;
    const corrAtivos = new Set(ativas.map((d) => d.c.associate?.user?.name).filter(Boolean));
    const onlineNow = new Set(
      decorated.map((d) => ({ n: d.c.associate?.user?.name, t: lastSeen(d.c) }))
        .filter((x) => x.n && x.t && (Date.now() - (x.t as number)) < 5 * 60000)
        .map((x) => x.n),
    );
    const anyLastSeen = decorated.some((d) => lastSeen(d.c) != null);
    return {
      ativas: ativas.length,
      aguardando: aguardando.length,
      negociando: decorated.filter((d) => d.status === "negociando").length,
      fechamento: decorated.filter((d) => d.status === "fechamento").length,
      ganhosHoje,
      esperaMedia,
      corretores: anyLastSeen ? onlineNow.size : corrAtivos.size,
      corretoresLabel: anyLastSeen ? "Corretores online" : "Corretores ativos",
    };
  }, [decorated]);

  // ---------- Ranking ----------
  const ranking = useMemo(() => {
    const map = new Map<string, { atend: number; neg: number; fech: number; online: boolean }>();
    for (const d of decorated) {
      const n = d.c.associate?.user?.name;
      if (!n || !d.status) continue;
      if (["perdido", "descartado"].includes(d.status)) continue;
      const r = map.get(n) ?? { atend: 0, neg: 0, fech: 0, online: false };
      r.atend++;
      if (d.status === "negociando") r.neg++;
      if (d.status === "fechamento" || d.status === "fechado") r.fech++;
      const t = lastSeen(d.c);
      if (t && Date.now() - t < 5 * 60000) r.online = true;
      map.set(n, r);
    }
    return [...map.entries()].map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.atend - a.atend).slice(0, 12);
  }, [decorated]);
  const rankMax = ranking[0]?.atend || 1;

  // ---------- opções de filtro ----------
  const cities = useMemo(() => [...new Set(list.map(getCity).filter(Boolean) as string[])].sort(), [list]);
  const corretores = useMemo(() => [...new Set(list.map((c) => c.associate?.user?.name).filter(Boolean) as string[])].sort(), [list]);

  const showMore = (key: string, total: number) =>
    setLimits((m) => ({ ...m, [key]: Math.min(total, (m[key] ?? 30) + 30) }));

  const CHIPS: [FilterKey, string, boolean][] = [
    ["todos", "Todos", false], ["comconversa", "💬 Com conversa", false], ["aguardando", "⚡ Cliente aguardando", true], ["critico", "SLA crítico", true],
    ["g5", "+5 min", false], ["g10", "+10 min", false],
    ["negociando", "Negociando", false], ["fechamento", "Fechamento", false], ["ganho", "Ganho", false],
  ];

  return (
    <div className="cov">
      {/* header */}
      <div className="c-head">
        <div>
          <h1>Centro de Operações</h1>
          <div className="c-sub">Monitoramento comercial · tempo real</div>
        </div>
        <button className="c-btn" onClick={() => void fetchList()} title="Atualizar agora" style={{ marginLeft: "auto" }}>
          {isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />} Atualizar
        </button>
        <span className="c-live"><span className="d" /> Ao vivo</span>
      </div>

      {/* KPIs */}
      <div className="c-kpis">
        <Kpi edge="var(--c-novo)"   lab="Conversas ativas"   val={kpis.ativas.toLocaleString("pt-BR")} sub="em atendimento" />
        <Kpi edge="var(--c-crit)"   lab="⚡ Cliente aguardando" val={kpis.aguardando} sub="resposta pendente" danger subcls="crit" />
        <Kpi edge="var(--c-negoc)"  lab="Negociando"         val={kpis.negociando} sub="interesse ativo" />
        <Kpi edge="var(--c-fecham)" lab="Fechamento"         val={kpis.fechamento} sub="proposta/contrato" />
        <Kpi edge="var(--c-ganho)"  lab="Ganhos hoje"        val={kpis.ganhosHoje} sub="vendas concluídas" subcls="up" />
        <Kpi edge="var(--c-qualif)" lab="Espera média"       val={kpis.esperaMedia ? `${kpis.esperaMedia}min` : "—"} sub="aguardando resposta" />
        <Kpi edge="var(--c-ganho)"  lab={kpis.corretoresLabel} val={kpis.corretores} sub="atuando agora" />
      </div>

      {/* filtros */}
      <div className="c-filters">
        <label className="c-search">
          <Search size={14} color="rgba(245,239,228,.4)" />
          <input placeholder="Buscar lead ou corretor…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {CHIPS.map(([key, label, crit]) => (
          <button key={key} className={`c-chip ${crit ? "crit" : ""} ${filter === key ? "on" : ""}`} onClick={() => setFilter(key)}>
            {label}
            {key === "comconversa" && <span className="c-n">{decorated.filter((d) => d.hasMsg).length}</span>}
            {key === "aguardando" && <span className="c-n">{kpis.aguardando}</span>}
            {key === "critico" && <span className="c-n">{decorated.filter((d) => d.sla >= 10).length}</span>}
          </button>
        ))}
        <span className="c-fspace" />
        {cities.length > 0 && (
          <select className="c-sel" value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">Todas as cidades</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select className="c-sel" value={corr} onChange={(e) => setCorr(e.target.value)}>
          <option value="">Todos os corretores</option>
          {corretores.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* legenda SLA */}
      <div className="c-legend">
        <span className="i"><span className="d" style={{ background: "var(--c-ok)" }} /> 0–5 min</span>
        <span className="i"><span className="d" style={{ background: "var(--c-warn)" }} /> 5–10 min</span>
        <span className="i"><span className="d" style={{ background: "var(--c-crit)" }} /> +10 min</span>
        <span className="i"><span className="d" style={{ background: "var(--c-over)", animation: "covblink .9s steps(2,start) infinite" }} /> +20 min</span>
        <span className="i" style={{ marginLeft: 4 }}><span style={{ color: "#ff9b9b" }}>⚡</span> = cliente respondeu, corretor ainda não → prioridade</span>
      </div>

      {/* board + ranking */}
      <div className="c-workspace">
        <div className="c-board">
          {COLUMNS.map((col) => {
            const items = grouped[col.key] ?? [];
            const limit = limits[col.key] ?? 30;
            const shown = items.slice(0, limit);
            const rest = items.length - shown.length;
            return (
              <div className="c-col" key={col.key} style={{ ["--ce" as string]: col.color }}>
                <div className="c-col-head">
                  <div className="c-col-row">
                    <div className="c-col-name"><span className="c-dotc" style={{ background: col.color }} />{col.label}</div>
                    <span className="c-col-cnt tnum">{items.length.toLocaleString("pt-BR")}</span>
                  </div>
                  <div className="c-col-sub">{col.sub}</div>
                </div>
                <div className="c-col-body">
                  {shown.length === 0 && <div className="c-empty">Nenhuma conversa</div>}
                  {shown.map((d) => <Card key={d.c.id} d={d} onOpen={() => setViewingId(d.c.id)} />)}
                  {rest > 0 && (
                    <button className="c-more" onClick={() => showMore(col.key, items.length)}>
                      + {rest.toLocaleString("pt-BR")} conversas · carregar mais
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <aside className="c-rank">
          <h3 className="c-rank-h"><Trophy size={13} /> Top corretores hoje</h3>
          <p className="c-rank-hint">Por atendimentos no período carregado</p>
          <div className="c-rk-list">
            {ranking.length === 0 && <div className="c-empty">Sem dados</div>}
            {ranking.map((r, i) => (
              <div className={`c-rk ${i < 3 ? "top" + (i + 1) : ""}`} key={r.name}>
                <div className="c-rk-pos">{i + 1}</div>
                <div className="c-rk-av">{ini(r.name)}{r.online && <span className="on" />}</div>
                <div className="c-rk-info">
                  <b>{r.name}</b>
                  <div className="c-rk-bar"><i style={{ width: `${Math.round(r.atend / rankMax * 100)}%` }} /></div>
                  <div className="c-rk-stats"><span>Neg <b>{r.neg}</b></span><span>Fech <b>{r.fech}</b></span></div>
                </div>
                <div className="c-rk-big"><b className="tnum">{r.atend}</b><span>atend.</span></div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* drawer */}
      <div className={`c-scrim ${viewingId ? "open" : ""}`} onClick={() => setViewingId(null)} />
      <Drawer convId={viewingId} onClose={() => setViewingId(null)} onChanged={() => void fetchList()} />
    </div>
  );
}

// ---------- KPI ----------
function Kpi({ edge, lab, val, sub, danger, subcls }: {
  edge: string; lab: string; val: React.ReactNode; sub: string; danger?: boolean; subcls?: string;
}) {
  return (
    <div className={`c-kpi ${danger ? "danger" : ""}`} style={{ ["--edge" as string]: edge }}>
      <div className="c-lab">{lab}</div>
      <div className="c-val tnum">{val}</div>
      <div className={`c-sub ${subcls ?? ""}`}>{sub}</div>
    </div>
  );
}

// ---------- Card ----------
function Card({ d, onOpen }: { d: { c: Conversation; status?: ChatStatus; waiting: boolean; sla: number; hasMsg: boolean }; onOpen: () => void }) {
  const { c, status, waiting, sla, hasMsg } = d;
  const sc = slaClass(sla);
  const city = getCity(c);
  const prop = getProperty(c);
  const msg = c.lastMessage?.text;
  return (
    <div className={`c-card ${waiting ? "waiting" : ""} ${sc === "over" ? "over" : ""}`} onClick={onOpen}>
      <div className="c-acc" />
      <div className="c-card-top">
        <div className="c-nm">
          <span className="c-pdot" style={{ background: status ? CHAT_STATUS[status].color : "var(--c-faint)" }} />
          <span>{c.lead?.name ?? "—"}</span>
        </div>
        <span className={`c-sla ${sc}`}><span className="d" />{slaText(sla)}</span>
      </div>
      {waiting && <div className="c-ribbon">⚡ aguardando sua resposta</div>}
      {msg && <div className="c-msg"><span className="ar">{c.lastMessage?.direction === "inbound" ? "↩" : "↪"}</span><em>{msg}</em></div>}
      <div className="c-foot">
        <span className="c-tag corr"><span className="c-av">{ini(c.associate?.user?.name)}</span>{firstName(c.associate?.user?.name)}</span>
        {city && <span className="c-tag"><MapPin size={10} />{city}</span>}
        {prop && <span className="c-tag"><Building2 size={10} />{prop}</span>}
        {!hasMsg && <span className="c-tag" style={{ opacity: .55 }}>sem mensagens</span>}
        {!!c.unread && c.unread > 0 && <span className="c-unread">{c.unread}</span>}
      </div>
    </div>
  );
}

// ---------- Drawer ----------
function Drawer({ convId, onClose, onChanged }: { convId: string | null; onClose: () => void; onChanged: () => void }) {
  const conv = useConversations((s) => (convId ? s.list.find((c) => c.id === convId) : undefined));
  const showToast = useUi((s) => s.showToast);
  const [tab, setTab] = useState<"conversa" | "timeline" | "logs">("conversa");
  const [associates, setAssociates] = useState<{ id: string; user?: { name?: string } }[]>([]);
  const [busy, setBusy] = useState(false);
  const [syncingVai, setSyncingVai] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  // Carrega mensagens em estado LOCAL — NÃO passa pelo store (que recria a lista de 10k
  // e dispararia o reprocessamento pesado). Abre instantâneo.
  const loadMsgs = useCallback(async () => {
    if (!convId) return;
    setLoadingMsgs(true);
    try {
      const r = await api.get<{ messages?: Message[]; data?: Message[] }>(`/api/conversations/${convId}/messages?limit=300`);
      const raw = (r.messages ?? r.data ?? []) as Message[];
      setMessages(raw.filter((m) => !isVaiActivityLocal(m)).map(adaptMsgLocal));
    } catch (e) {
      showToast(`Erro ao carregar mensagens: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingMsgs(false);
    }
  }, [convId, showToast]);

  useEffect(() => {
    if (!convId) return;
    setTab("conversa");
    setMessages([]);
    void loadMsgs();
    // associates para transferência (mesmo endpoint da tela Leads)
    if (associates.length === 0) {
      api.get<{ data: { id: string; user?: { name?: string } }[] }>("/api/associates?limit=2000")
        .then((r) => setAssociates(r.data ?? [])).catch(() => { /* silent */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  // Esc fecha
  useEffect(() => {
    if (!convId) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [convId, onClose]);

  if (!conv) return <aside className="c-drawer" aria-hidden />;

  const status = convStatus(conv);
  const sla = getSlaMinutos(conv);
  const sc = slaClass(sla);
  const leadId = conv.leadId ?? conv.lead?.id ?? "";
  const phone = formatLeadTelForCorretor(conv);
  const city = getCity(conv);
  const prop = getProperty(conv);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); showToast(ok); onChanged(); }
    catch (e) { showToast(`Erro: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  }
  function handleStatus(value: LeadStatus) {
    const label = STATUS_OPTIONS.find(([v]) => v === value)?.[1] ?? value;
    if (!leadId) { showToast("Lead sem id"); return; }
    if (!window.confirm(`Alterar status de ${conv!.lead?.name ?? "lead"} para "${label}"?`)) return;
    void run(() => setLeadStatus(leadId, value), `Status alterado para ${label}`);
  }
  function handleTransfer(associateId: string) {
    if (!associateId || !leadId) return;
    const dest = associates.find((a) => a.id === associateId)?.user?.name ?? "corretor";
    if (!window.confirm(`Transferir ${conv!.lead?.name ?? "lead"} para ${dest}?`)) return;
    void run(() => api.post(`/api/leads/${leadId}/assign`, { mode: "specific", associateId }), `Transferido para ${dest}`);
  }
  function handleCall() {
    if (!leadId) return;
    if (!window.confirm(`Ligar para ${conv!.lead?.name ?? "lead"} via ponte protegida? O sistema liga para o corretor e conecta com o cliente.`)) return;
    void run(() => voiceCall(leadId), "Ligação iniciada");
  }
  // Puxa histórico do VAI (safety-net pra webhook inbound que falhou). Reusa o
  // endpoint que a tela antiga já usava. Síncrono: após o POST, recarrega as mensagens.
  async function handleSyncVai() {
    if (!convId) return;
    setSyncingVai(true);
    try {
      const r = await api.post<{ added?: number; reason?: string }>(`/api/conversations/${convId}/sync-vai`, {});
      if (r?.reason === "no_vai_chat") showToast("Esta conversa não tem chat vinculado no VAI — não há histórico a importar.");
      else if (r?.added && r.added > 0) { showToast(`${r.added} mensagem(ns) trazida(s) do VAI`); await loadMsgs(); }
      else showToast("Nenhuma mensagem nova encontrada no VAI.");
    } catch (e) {
      showToast(`Erro ao sincronizar VAI: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSyncingVai(false); }
  }

  const curLead: LeadStatus | "" = status ? (CHAT_TO_LEAD[status] ?? "") : "";

  return (
    <aside className={`c-drawer ${convId ? "open" : ""}`} onClick={(e) => e.stopPropagation()}>
      <div className="c-dw-head">
        <div className="c-dw-r1">
          <div className="c-dw-av">{ini(conv.lead?.name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{conv.lead?.name ?? "—"}</h2>
            <div className="c-dw-meta">
              {status && <span className="c-pill" style={{ background: CHAT_STATUS[status].bg, color: CHAT_STATUS[status].color }}>{CHAT_STATUS[status].label}</span>}
              <span className={`c-sla ${sc}`} style={{ padding: "2px 7px" }}><span className="d" />SLA {slaText(sla)}</span>
              <span>{messages.length} mensagens</span>
              {isWaiting(conv) && <span style={{ color: "#ff9b9b", fontWeight: 700 }}>⚡ aguardando resposta</span>}
            </div>
          </div>
          <button className="c-dw-x" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <div className="c-dw-actions">
          <select className="c-selact" value="" disabled={busy} onChange={(e) => { if (e.target.value) handleTransfer(e.target.value); e.currentTarget.value = ""; }} title="Transferir corretor">
            <option value="">⇄ Transferir corretor…</option>
            {associates.map((a) => <option key={a.id} value={a.id}>{a.user?.name ?? a.id}</option>)}
          </select>
          <select className="c-selact" value={curLead} disabled={busy} onChange={(e) => { if (e.target.value) handleStatus(e.target.value as LeadStatus); }} title="Alterar status">
            {!curLead && <option value="">Alterar status…</option>}
            {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="c-btn" disabled={busy} onClick={handleCall}><Phone size={13} /> Ligar</button>
          <button className="c-btn" disabled={syncingVai} onClick={handleSyncVai} title="Puxar histórico do VAI (use quando faltar mensagem)">
            {syncingVai ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />} Sincronizar VAI
          </button>
          {busy && <Loader2 size={15} className="animate-spin" />}
        </div>
      </div>

      <div className="c-dw-tabs">
        <button className={tab === "conversa" ? "on" : ""} onClick={() => setTab("conversa")}>Conversa</button>
        <button className={tab === "timeline" ? "on" : ""} onClick={() => setTab("timeline")}>Timeline</button>
        <button className={tab === "logs" ? "on" : ""} onClick={() => setTab("logs")}>Logs</button>
      </div>

      <div className="c-dw-body">
        {tab === "conversa" && (
          <div className="c-pane conv">
            <div className="c-lead-strip">
              <div className="c-strip-it">
                <div className="k">Telefone</div>
                <div className="v" style={{display:"flex",alignItems:"center",gap:"8px"}}>
                  {phone || "—"}
                  {conv.lead?.phone && (
                    <a
                      href={waUrl(conv.lead.phone)}
                      target="_blank"
                      rel="noreferrer"
                      title="Abrir no WhatsApp"
                      style={{display:"inline-flex",alignItems:"center",gap:"3px",fontSize:"0.65rem",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",color:"#34d399",textDecoration:"none"}}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.116 1.524 5.849L.057 23.55a.75.75 0 00.914.914l5.701-1.467A11.948 11.948 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.925 0-3.73-.5-5.292-1.376l-.378-.214-3.938 1.013 1.013-3.938-.214-.378A9.953 9.953 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                      WA
                    </a>
                  )}
                </div>
              </div>
              <div className="c-strip-it"><div className="k">Cidade</div><div className="v">{city ? <><MapPin size={11} /> {city}</> : "—"}</div></div>
              <div className="c-strip-it"><div className="k">Origem</div><div className="v">{conv.lead?.origin ?? "—"}</div></div>
              <div className="c-strip-it"><div className="k">Imóvel</div><div className="v">{prop ?? "—"}</div></div>
              <div className="c-strip-it"><div className="k">Corretor</div><div className="v">{conv.associate?.user?.name ?? "—"}</div></div>
            </div>
            <div className="c-thread-host">
              {loadingMsgs
                ? <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--c-mute)", fontSize: 13 }}><Loader2 size={14} className="animate-spin" /> &nbsp;Carregando mensagens…</div>
                : messages.length === 0
                ? <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, color: "var(--c-mute)", fontSize: 13, textAlign: "center", padding: "0 28px", lineHeight: 1.6 }}>
                    <div>Nenhuma mensagem carregada nesta conversa.<br /><span style={{ color: "var(--c-faint)", fontSize: 12 }}>Pode ser um lead importado (sem conversa) ou o histórico estar no VAI.</span></div>
                    <button className="c-btn" disabled={syncingVai} onClick={handleSyncVai}>{syncingVai ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />} Tentar sincronizar do VAI</button>
                  </div>
                : <ChatStream messages={messages} />}
            </div>
          </div>
        )}
        {tab === "timeline" && <div className="c-pane"><Timeline conv={conv} status={status} msgCount={messages.length} /></div>}
        {tab === "logs" && <div className="c-pane"><Logs messages={messages} /></div>}
      </div>

      <div className="c-dw-foot">
        <Info size={13} />
        Modo supervisão (admin) · a resposta ao cliente é feita pelo corretor responsável. Nada foi removido do fluxo atual.
      </div>
    </aside>
  );
}

// ---------- Timeline (derivada de campos reais da conversa) ----------
function Timeline({ conv, status, msgCount }: { conv: Conversation; status?: ChatStatus; msgCount: number }) {
  const l = conv.lead as Record<string, unknown> | undefined;
  const evs: { color: string; t?: string; b: string; s: string }[] = [];
  evs.push({ color: "var(--c-novo)", t: conv.createdAt, b: "Conversa criada", s: `Origem: ${conv.lead?.origin ?? "—"}` });
  if (l?.assignedAt) evs.push({ color: "var(--c-qualif)", t: l.assignedAt as string, b: "Lead atribuído", s: `Corretor: ${conv.associate?.user?.name ?? "—"}` });
  if (l?.firstContactAt) evs.push({ color: "var(--c-negoc)", t: l.firstContactAt as string, b: "1º contato realizado", s: "Atendimento iniciado" });
  if (conv.lastMessageAt) evs.push({ color: "var(--c-fecham)", t: conv.lastMessageAt, b: "Última interação", s: `${msgCount || conv._count?.messages || "?"} mensagens` });
  if (status) evs.push({ color: CHAT_STATUS[status].color, b: `Status atual: ${CHAT_STATUS[status].label}`, s: "Estágio na esteira comercial" });
  return (
    <div className="c-tl">
      {evs.map((e, i) => (
        <div className="c-tl-ev" key={i}>
          <span className="c-tl-dot" style={{ background: e.color }} />
          <div><b>{e.b}</b><span>{e.s}</span>{e.t && <time>{new Date(e.t).toLocaleString("pt-BR")}</time>}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- Logs (visão técnica das mensagens reais — provider/status/erros) ----------
function Logs({ messages }: { messages: Message[] }) {
  const msgs = messages;
  if (msgs.length === 0) return <div className="c-log">Abra a aba Conversa para carregar os eventos.</div>;
  return (
    <div className="c-log">
      {msgs.slice(-60).map((m, i) => {
        const cls = m.messageStatus === "failed" ? "err" : "";
        const t = m.createdAt ? new Date(m.createdAt).toLocaleTimeString("pt-BR") : "--:--";
        const parts = [
          m.direction,
          m.contentType ?? "text",
          m.provider ? `via ${m.provider}` : "",
          m.templateName ? `template:${m.templateName}` : "",
          m.messageStatus ? `status:${m.messageStatus}` : "",
          m.errorReason ? `erro:${m.errorReason}` : "",
        ].filter(Boolean).join(" · ");
        return <div className={`ln ${cls}`} key={i}><time>{t}</time><span>{parts}</span></div>;
      })}
    </div>
  );
}
