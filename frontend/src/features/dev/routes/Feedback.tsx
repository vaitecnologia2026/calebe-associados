// Painel DEV · lista bug reports com análise IA
// GET  /api/dev/feedback
// POST /api/dev/feedback/analyze
import { useEffect, useMemo, useState } from "react";
import { Bug, RefreshCw, Sparkles, Loader2, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/store/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";

type Category = "bug" | "ux" | "performance" | "sugestao" | "duvida" | "outro";

interface FeedbackItem {
  id: string;
  type: Category | string;
  description: string;
  descriptionLen: number;
  screenshotUrl: string | null;
  currentUrl: string | null;
  userAgent: string | null;
  adminsNotified: number;
  sender: { id: string; name: string; email: string; role: string } | null;
  actorEmail: string | null;
  createdAt: string;
}
interface Resp { data: FeedbackItem[]; total: number }

const CAT_LABEL: Record<string, string> = {
  bug: "Bug", ux: "UX/Design", performance: "Performance",
  sugestao: "Sugestão", duvida: "Dúvida", outro: "Outro"
};
const CAT_TONE: Record<string, string> = {
  bug:         "bg-red-500/15 text-red-300 border-red-400/40",
  ux:          "bg-purple-500/15 text-purple-300 border-purple-400/40",
  performance: "bg-orange-500/15 text-orange-300 border-orange-400/40",
  sugestao:    "bg-emerald-500/15 text-emerald-300 border-emerald-400/40",
  duvida:      "bg-blue-500/15 text-blue-300 border-blue-400/40",
  outro:       "bg-sand-100/10 text-sand-100/75 border-sand-100/20",
};

function fmtDateTime(iso?: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return "—"; }
}

export function DevFeedback() {
  const [list, setList] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analises, setAnalises] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Category | "">("");
  const showToast = useUi((s) => s.showToast);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<Resp>("/api/dev/feedback?limit=200");
      setList(r.data ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function analyzeOne(item: FeedbackItem) {
    setAnalyzingId(item.id);
    try {
      const r = await api.post<{ analise: string; model?: string }>("/api/dev/feedback/analyze", {
        description: item.description,
        type: item.type,
        currentUrl: item.currentUrl ?? undefined,
        userAgent: item.userAgent ?? undefined,
      });
      setAnalises((prev) => ({ ...prev, [item.id]: r.analise }));
      setExpandedId(item.id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ia_nao_configurada")) {
        showToast("IA não configurada · vá em Configurações → Integrações & IA");
      } else {
        showToast(`Erro: ${msg}`);
      }
    } finally { setAnalyzingId(null); }
  }

  const filtered = useMemo(() => {
    if (!filter) return list;
    return list.filter((i) => i.type === filter);
  }, [list, filter]);

  const counts = useMemo(() => ({
    total: list.length,
    bug: list.filter((i) => i.type === "bug").length,
    ux: list.filter((i) => i.type === "ux").length,
    performance: list.filter((i) => i.type === "performance").length,
    sugestao: list.filter((i) => i.type === "sugestao").length,
  }), [list]);

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Bug Reports"
        description={`${counts.total} relatos enviados pelos usuários · ${counts.bug} bugs · ${counts.ux} UX · ${counts.performance} performance · ${counts.sugestao} sugestões`}
        actions={<Button variant="outline" onClick={load} loading={loading}><RefreshCw size={14} /> Atualizar</Button>}
      />

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => setFilter("")}
          className={`text-xs px-3 py-1.5 rounded-full border ${filter === "" ? "bg-gold-400/15 text-gold-300 border-gold-400/40" : "border-sand-100/15 text-sand-100/65 hover:border-sand-100/35"}`}
        >
          Todos ({counts.total})
        </button>
        {(["bug", "ux", "performance", "sugestao", "duvida", "outro"] as Category[]).map((c) => {
          const count = list.filter((i) => i.type === c).length;
          if (count === 0) return null;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setFilter(filter === c ? "" : c)}
              className={`text-xs px-3 py-1.5 rounded-full border ${filter === c ? CAT_TONE[c] : "border-sand-100/15 text-sand-100/65 hover:border-sand-100/35"}`}
            >
              {CAT_LABEL[c]} ({count})
            </button>
          );
        })}
      </div>

      {/* Lista */}
      <div className="space-y-3">
        {loading && list.length === 0 ? (
          <div className="card p-10 text-center text-sand-100/55">Carregando…</div>
        ) : filtered.length === 0 ? (
          <div className="card p-10 text-center">
            <Bug className="mx-auto mb-2 text-sand-100/35" size={28} />
            <p className="text-sand-100/55 text-sm">Nenhum relato {filter ? CAT_LABEL[filter].toLowerCase() : ""}.</p>
          </div>
        ) : filtered.map((item) => {
          const expanded = expandedId === item.id;
          const analise = analises[item.id];
          return (
            <article key={item.id} className="card p-4">
              <div className="flex items-start gap-3">
                <span className={`text-[0.6rem] uppercase tracking-mono-xwide font-bold px-2 py-1 rounded-full border ${CAT_TONE[item.type] ?? CAT_TONE.outro} shrink-0`}>
                  {CAT_LABEL[item.type] ?? item.type}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
                    <p className="text-sm font-semibold text-sand-50">
                      {item.sender?.name ?? item.actorEmail ?? "anônimo"}
                      <span className="text-xs text-sand-100/55 font-normal ml-2">{item.sender?.role ?? ""}</span>
                    </p>
                    <p className="text-xs text-sand-100/55 shrink-0">{fmtDateTime(item.createdAt)}</p>
                  </div>
                  <p className="text-sm text-sand-100/85 whitespace-pre-wrap leading-relaxed">{item.description}</p>

                  <div className="flex flex-wrap gap-3 mt-3 text-[0.7rem] text-sand-100/55">
                    {item.currentUrl && (
                      <span title={item.currentUrl}>
                        URL: <code className="text-sand-100/85">{item.currentUrl.length > 50 ? "…" + item.currentUrl.slice(-50) : item.currentUrl}</code>
                      </span>
                    )}
                    {item.screenshotUrl && (
                      <a href={item.screenshotUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200">
                        <ExternalLink size={11} /> Ver screenshot
                      </a>
                    )}
                  </div>

                  {/* Action: análise IA */}
                  <div className="mt-3 flex items-center gap-2">
                    {analise ? (
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : item.id)}
                        className="text-xs font-semibold text-purple-300 hover:text-purple-200 inline-flex items-center gap-1"
                      >
                        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {expanded ? "Ocultar análise" : "Ver análise IA"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void analyzeOne(item)}
                        disabled={analyzingId === item.id}
                        className="text-xs font-semibold text-purple-300 hover:text-purple-200 inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        {analyzingId === item.id
                          ? <Loader2 size={12} className="animate-spin" />
                          : <Sparkles size={12} />}
                        Analisar com IA
                      </button>
                    )}
                  </div>

                  {/* Painel da análise */}
                  {expanded && analise && (
                    <div className="mt-3 p-3 bg-purple-500/5 border border-purple-400/25 rounded">
                      <p className="text-[0.65rem] uppercase tracking-mono-xwide font-bold text-purple-300 mb-2 inline-flex items-center gap-1">
                        <Sparkles size={11} /> Análise técnica via IA
                      </p>
                      <pre className="text-xs text-sand-100/90 whitespace-pre-wrap font-sans leading-relaxed">{analise}</pre>
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
