// Painel TV · KPIs em tempo real
// GET /api/dashboards/summary · /api/dashboards/active-brokers · /response-time-today
// Hero banner + KPIs + chart + Top 5 + Online — theme-aware (html.light) e personalizável
// (blocos exibidos / intervalo de refresh) com persistência em localStorage.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Settings, Users, MessagesSquare, Inbox, Clock3, TrendingUp, BarChart3, Award, Wifi } from "lucide-react";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import "./Tv.css";

// Bate com /api/dashboards/summary · getTvMetrics + getAdminSummary
interface Summary {
  totalAssociates?: number;
  activeConversations?: number;
  leadsInQueue?: number;
  leadsDistributedToday?: number;
  salesToday?: number;
  associatesByCategory?: Record<string, number>;
  topAssociates?: { id?: string; name: string; category?: string; sales: number }[];
  // getAdminSummary
  applPending?: number;
  salesPending?: number;
  propertiesCount?: number;
  leadsTotal?: number;
}

// Bate com /api/dashboards/active-brokers · { kpis, ranking }
interface ActiveBrokers {
  kpis?: {
    total?: number;
    online?: number;
    blocked?: number;
    neverLogged?: number;
    brokersOnlineToday?: number;
    conversationsStartedToday?: number;
    conversationsRepliedToday?: number;
  };
  ranking?: Array<{
    id?: string;
    name?: string;
    category?: string;
    online?: boolean;
    everLogged?: boolean;
    blocked?: boolean;
    lastSeenAt?: string | null;
    lastLoginAt?: string | null;
    score?: number;
  }>;
}

// Bate com /api/dashboards/response-time-today
interface ResponseTime {
  samples?: number;
  avgSeconds?: number | null;
  avgFormatted?: string | null;
  minSeconds?: number | null;
  maxSeconds?: number | null;
}

interface TvConfig {
  blocos: {
    corretoresAtivos: boolean;
    conversasAtivas: boolean;
    leadsFila: boolean;
    tempoResposta: boolean;
    vendas: boolean;
    distribuicao: boolean;
    topCorretores: boolean;
    online: boolean;
  };
  intervaloSegundos: number;
}

const STORAGE_KEY = "CALEBE_TV_CONFIG";
const DEFAULT_CONFIG: TvConfig = {
  blocos: {
    corretoresAtivos: true,
    conversasAtivas: true,
    leadsFila: true,
    tempoResposta: true,
    vendas: true,
    distribuicao: true,
    topCorretores: true,
    online: true,
  },
  intervaloSegundos: 3,
};

const INTERVALOS = [
  { value: 5,  label: "5 segundos · tempo real" },
  { value: 10, label: "10 segundos · padrão" },
  { value: 30, label: "30 segundos · estável" },
  { value: 60, label: "60 segundos · economia" },
];

const BLOCO_LABELS: { key: keyof TvConfig["blocos"]; label: string; descricao: string }[] = [
  { key: "corretoresAtivos", label: "Corretores ativos",   descricao: "Total + online" },
  { key: "conversasAtivas",  label: "Conversas ativas",    descricao: "Inbox + SLA crítico" },
  { key: "leadsFila",        label: "Leads na fila",       descricao: "Aguardando distribuição" },
  { key: "tempoResposta",    label: "Tempo médio resposta",descricao: "1º contato hoje" },
  { key: "vendas",           label: "Vendas",              descricao: "Acumulado do dia" },
  { key: "distribuicao",     label: "Corretores por categoria", descricao: "Gráfico Bronze/Prata/Ouro/Diamante" },
  { key: "topCorretores",    label: "Top 5 corretores",    descricao: "Ranking por vendas" },
  { key: "online",           label: "Corretores online",   descricao: "Tempo na plataforma" },
];

const CATEGORIES: { key: string; label: string; cls?: string }[] = [
  { key: "BRONZE",   label: "Bronze" },
  { key: "SILVER",   label: "Prata", cls: "tv-chart-bar--silver" },
  { key: "GOLD",     label: "Ouro" },
  { key: "DIAMOND",  label: "Diamante", cls: "tv-chart-bar--diamond" },
];

function readConfig(): TvConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const p = JSON.parse(raw) as Partial<TvConfig>;
    return {
      blocos: { ...DEFAULT_CONFIG.blocos, ...(p.blocos ?? {}) },
      intervaloSegundos: typeof p.intervaloSegundos === "number" ? p.intervaloSegundos : DEFAULT_CONFIG.intervaloSegundos,
    };
  } catch { return DEFAULT_CONFIG; }
}
function saveConfig(c: TvConfig): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch { /* quota */ }
}

function initials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function fmtTime(ms?: number): string {
  if (!ms || ms < 0) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return `${h}h${String(r).padStart(2, "0")}`;
}

interface TvFeed {
  entrou: { id: string; name: string; at: string }[];
  respondeu: { id: string; lead: string; corretor: string | null; at: string }[];
  quentes: { stage: { id: string; lead: string; corretor: string | null; status: string }[]; engajados: { id: string; lead: string; corretor: string | null; respostas: number }[] };
}

export function Tv() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [actives, setActives] = useState<ActiveBrokers | null>(null);
  const [resp, setResp] = useState<ResponseTime | null>(null);
  const [now, setNow] = useState(() => new Date().toLocaleTimeString("pt-BR"));
  const [config, setConfig] = useState<TvConfig>(() => readConfig());
  const [configOpen, setConfigOpen] = useState(false);
  const [draft, setDraft] = useState<TvConfig>(config);
  const fpRef = useRef<string>("");
  const [tvFeed, setTvFeed] = useState<TvFeed | null>(null);
  const [tvToasts, setTvToasts] = useState<{ id: string; txt: string; hot?: boolean }[]>([]);
  const tvSeen = useRef<{ online: Set<string>; replies: Set<string>; hot: Set<string>; init: boolean; n: number }>({ online: new Set(), replies: new Set(), hot: new Set(), init: false, n: 0 });

  async function load() {
    try {
      const [s, a, r] = await Promise.all([
        api.get<Summary>("/api/dashboards/summary").catch(() => null),
        api.get<ActiveBrokers>("/api/dashboards/active-brokers").catch(() => null),
        api.get<ResponseTime>("/api/dashboards/response-time-today").catch(() => null),
      ]);
      const fp = JSON.stringify({ s, online: a?.kpis?.online, avg: r?.avgSeconds });
      if (fp !== fpRef.current) {
        fpRef.current = fp;
        if (s) setSummary(s);
        if (a) setActives(a);
        if (r) setResp(r);
      }
    } catch { /* silent */ }
  }

  useEffect(() => { void load(); }, []);
  usePolling(load, { intervalMs: 3000, immediate: false }); // KPIs da TV fixos em 3s
  useEffect(() => {
    let alive = true;
    const loadFeed = async () => { try { const fdat = await api.get<TvFeed>("/api/dashboards/tv-feed"); if (alive) setTvFeed(fdat); } catch { /* silent */ } };
    void loadFeed();
    const tf = setInterval(loadFeed, 3000); // 3s · atualizacao ao vivo da TV
    return () => { alive = false; clearInterval(tf); };
  }, []);

  // Eventos novos viram toasts no canto direito (5s e somem). 1o poll = baseline (sem flood).
  useEffect(() => {
    if (!tvFeed) return;
    const sr = tvSeen.current;
    const fresh: { id: string; txt: string; hot?: boolean }[] = [];
    const mk = (txt: string, hot?: boolean) => { fresh.push({ id: "t" + (++sr.n), txt, hot }); };
    const onlineIds = (tvFeed.entrou || []).map((e) => e.id);
    for (const e of (tvFeed.entrou || [])) { if (!sr.online.has(e.id) && sr.init) mk("\ud83d\udfe2 " + e.name + " entrou"); }
    sr.online = new Set(onlineIds);
    for (const r of (tvFeed.respondeu || [])) { const k = "re-" + r.id + "-" + (r.at || ""); if (!sr.replies.has(k)) { sr.replies.add(k); if (sr.init) mk("\ud83d\udcac " + r.lead + " respondeu" + (r.corretor ? " \u00b7 " + r.corretor : "")); } }
    for (const h of [...(tvFeed.quentes?.stage || []), ...(tvFeed.quentes?.engajados || [])]) { const k = "hot-" + h.id; if (!sr.hot.has(k)) { sr.hot.add(k); if (sr.init) mk("\ud83d\udd25 Negocia\u00e7\u00e3o quente: " + h.lead + (h.corretor ? " \u00b7 " + h.corretor : ""), true); } }
    if (!sr.init) { sr.init = true; return; }
    if (!fresh.length) return;
    setTvToasts((prev) => [...prev, ...fresh]);
    fresh.forEach((ev) => setTimeout(() => setTvToasts((prev) => prev.filter((t) => t.id !== ev.id)), 5000));
  }, [tvFeed]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toLocaleTimeString("pt-BR")), 1000);
    return () => clearInterval(t);
  }, []);

  function enterFullscreen() {
    document.documentElement.requestFullscreen?.().catch(() => { /* ignore */ });
  }

  const openConfig = useCallback(() => {
    setDraft(config);
    setConfigOpen(true);
  }, [config]);

  const applyConfig = useCallback(() => {
    setConfig(draft);
    saveConfig(draft);
    setConfigOpen(false);
  }, [draft]);

  const resetConfig = useCallback(() => {
    setDraft(DEFAULT_CONFIG);
  }, []);

  const toggleBloco = (key: keyof TvConfig["blocos"]) =>
    setDraft((d) => ({ ...d, blocos: { ...d.blocos, [key]: !d.blocos[key] } }));

  const top5 = useMemo(() => (summary?.topAssociates ?? []).slice(0, 5), [summary]);

  const categoryData = useMemo(() => {
    const dist = summary?.associatesByCategory ?? {};
    const norm = (k: string) =>
      dist[k] ?? dist[k.toLowerCase()] ?? dist[k.charAt(0) + k.slice(1).toLowerCase()] ?? 0;
    const values = CATEGORIES.map((c) => ({ ...c, value: norm(c.key) }));
    const max = Math.max(...values.map((v) => v.value), 1);
    return { values, max };
  }, [summary]);

  // corretores online vem dos kpis do /active-brokers (não vem no summary)
  const corretoresOnline = actives?.kpis?.online ?? 0;

  const b = config.blocos;
  const visibleKpisCount = (b.corretoresAtivos ? 1 : 0) + (b.conversasAtivas ? 1 : 0) + (b.leadsFila ? 1 : 0) + (b.tempoResposta ? 1 : 0) + (b.vendas ? 1 : 0);
  const visibleBottomCount = (b.distribuicao ? 1 : 0) + (b.topCorretores ? 1 : 0) + (b.online ? 1 : 0);

  return (
    <div className="p-6 md:p-8">
            {tvToasts.length > 0 && (
        <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10, maxWidth: "min(420px, 90vw)", pointerEvents: "none" }}>
          {tvToasts.map((t) => (
            <div key={t.id} className="tv-toast" style={{ background: t.hot ? "linear-gradient(90deg,#EF4444,#F5A524)" : "rgba(15,23,40,.94)", color: t.hot ? "#1a0a0a" : "#fff", fontWeight: t.hot ? 800 : 600, padding: "12px 16px", borderRadius: 12, fontSize: 16, boxShadow: "0 8px 28px rgba(0,0,0,.45)", border: t.hot ? "none" : "1px solid rgba(255,255,255,.12)" }}>{t.txt}</div>
          ))}
        </div>
      )}
      <PageHeader
        title="Painel TV"
        description="Dashboard executivo com atualização configurável. Ideal para exibir em TV na sala da operação."
        actions={
          <>
            <Button variant="outline" onClick={openConfig}>
              <Settings size={14} /> Personalizar
            </Button>
            <Button variant="gold" onClick={enterFullscreen}>
              <Maximize2 size={14} /> Entrar modo TV
            </Button>
          </>
        }
      />

      <div className="tv-hero">
        <div className="tv-watermark" aria-hidden>CALEBE</div>

        <div className="tv-header">
          <div className="tv-brand">
            <div className="tv-brand-logo">
              CALEBE
              <small>INVESTIMENTOS IMOBILIÁRIOS</small>
            </div>
            <div className="tv-brand-text">
              <p>Calebe Associados · Operação</p>
              <h2>Performance em tempo real</h2>
            </div>
          </div>
          <div className="tv-meta">
            <span className="tv-clock">{now}</span>
            <span className="tv-live">ao vivo</span>
          </div>
        </div>

        {visibleKpisCount > 0 && (
          <div className="tv-grid" style={{ gridTemplateColumns: `repeat(${Math.min(visibleKpisCount, 5)}, 1fr)` }}>
            {b.corretoresAtivos && (
              <div className="tv-card">
                <div>
                  <div className="tv-card-label">
                    <Users size={13} /> Corretores ativos
                    <span className="tv-card-label-extra">{corretoresOnline} online</span>
                  </div>
                  <p className="tv-card-value">{summary?.totalAssociates ?? 0}</p>
                </div>
                <p className="tv-card-hint">
                  {corretoresOnline} conectado{corretoresOnline === 1 ? "" : "s"} de {summary?.totalAssociates ?? 0} cadastrados
                </p>
              </div>
            )}

            {b.conversasAtivas && (
              <div className="tv-card">
                <div>
                  <div className="tv-card-label"><MessagesSquare size={13} /> Conversas ativas</div>
                  <p className="tv-card-value">{summary?.activeConversations ?? 0}</p>
                </div>
                <p className="tv-card-hint">aguardando atendimento</p>
              </div>
            )}

            {b.leadsFila && (
              <div className="tv-card">
                <div>
                  <div className="tv-card-label"><Inbox size={13} /> Leads na fila</div>
                  <p className="tv-card-value">{summary?.leadsInQueue ?? 0}</p>
                </div>
                <p className="tv-card-hint">
                  {summary?.leadsDistributedToday ?? 0} distribuídos hoje
                </p>
              </div>
            )}

            {b.tempoResposta && (
              <div className="tv-card">
                <div>
                  <div className="tv-card-label"><Clock3 size={13} /> Tempo médio resposta hoje</div>
                  <p className="tv-card-value">{resp?.avgFormatted && resp.avgFormatted !== "—" ? resp.avgFormatted : "—"}</p>
                </div>
                <p className="tv-card-hint">{resp?.samples ? `${resp.samples} amostras` : "aguardando 1ª"}</p>
              </div>
            )}

            {b.vendas && (
              <div className="tv-card">
                <div>
                  <div className="tv-card-label"><TrendingUp size={13} /> Vendas hoje</div>
                  <p className="tv-card-value">{summary?.salesToday ?? 0}</p>
                </div>
                <p className="tv-card-hint">contratos abertos</p>
              </div>
            )}
          </div>
        )}

        {visibleBottomCount > 0 && (
          <div className="tv-row-2" style={{ gridTemplateColumns: `repeat(${Math.min(visibleBottomCount, 3)}, 1fr)` }}>
            {b.distribuicao && (
              <div className="tv-card">
                <div className="tv-card-label"><BarChart3 size={13} /> Corretores por categoria</div>
                <div className="tv-chart-wrap">
                  {categoryData.values.map((c) => {
                    const h = `${(c.value / categoryData.max) * 100}%`;
                    return (
                      <div key={c.key} className={`tv-chart-bar ${c.cls ?? ""}`} style={{ height: h }} data-cat={c.label}>
                        <span>{c.value}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {b.topCorretores && (
              <div className="tv-card">
                <div className="tv-card-label"><Award size={13} /> Top 5 corretores</div>
                {top5.length === 0 ? (
                  <p className="tv-card-hint" style={{ marginTop: 12 }}>Sem dados</p>
                ) : (
                  <div className="tv-rank-list">
                    {top5.map((bk, i) => (
                      <div key={`${bk.name}-${i}`} className="tv-rank-item">
                        <div className="tv-rank-pos">{i + 1}</div>
                        <div className="tv-rank-nome">{bk.name}</div>
                        <div className="tv-rank-valor">{bk.sales} vendas</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {b.online && (() => {
              const onlineList = (actives?.ranking ?? []).filter((bk) => bk.online).slice(0, 8);
              return (
                <div className="tv-card">
                  <div className="tv-card-label"><Wifi size={13} /> Corretores online agora</div>
                  {onlineList.length === 0 ? (
                    <p className="tv-card-hint" style={{ marginTop: 12 }}>Nenhum corretor online no momento.</p>
                  ) : (
                    <div className="tv-online-list">
                      {onlineList.map((bk) => {
                        const sinceMs = bk.lastSeenAt ? Date.now() - new Date(bk.lastSeenAt).getTime() : 0;
                        return (
                          <div key={bk.id ?? bk.name} className="tv-online-item">
                            <div className="tv-online-avatar" translate="no">{initials(bk.name)}</div>
                            <span className="tv-online-dot" aria-hidden />
                            <span className="tv-online-nome">{bk.name}</span>
                            <span className="tv-online-time">visto há {fmtTime(sinceMs)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <Modal open={configOpen} onClose={() => setConfigOpen(false)} title="Personalizar Painel TV" size="md">
        <p className="text-sm text-sand-100/70 mb-5">
          Escolha quais blocos exibir no painel e a frequência de atualização. As alterações aplicam imediatamente.
        </p>

        <div className="mb-6">
          <p className="text-[0.7rem] uppercase tracking-mono-label font-semibold text-gold-400 mb-3">Blocos exibidos</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {BLOCO_LABELS.map((bl) => {
              const checked = draft.blocos[bl.key];
              return (
                <label
                  key={bl.key}
                  className={`tv-toggle ${checked ? "is-on" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleBloco(bl.key)}
                  />
                  <div className="tv-toggle-text">
                    <span className="tv-toggle-label">{bl.label}</span>
                    <span className="tv-toggle-desc">{bl.descricao}</span>
                  </div>
                  <span className="tv-toggle-switch" aria-hidden />
                </label>
              );
            })}
          </div>
        </div>

        <div className="mb-6">
          <p className="text-[0.7rem] uppercase tracking-mono-label font-semibold text-gold-400 mb-3">Intervalo de atualização</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {INTERVALOS.map((iv) => (
              <button
                key={iv.value}
                type="button"
                className={`tv-pill ${draft.intervaloSegundos === iv.value ? "is-on" : ""}`}
                onClick={() => setDraft((d) => ({ ...d, intervaloSegundos: iv.value }))}
              >
                <span className="tv-pill-value">{iv.value}s</span>
                <span className="tv-pill-label">{iv.label.split("·")[1]?.trim() ?? iv.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-4 border-t hairline">
          <Button variant="ghost" onClick={resetConfig}>Restaurar padrão</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setConfigOpen(false)}>Cancelar</Button>
            <Button variant="gold" onClick={applyConfig}>Aplicar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
