// =============================================================================
// AssistantChat · FAB flutuante + painel de chat com o Assistente IA
// -----------------------------------------------------------------------------
// Gate: só renderiza se user.role === "ADMIN". Se um não-admin ainda passar,
// faz GET /api/ia/status como sanity check e remove o FAB em 401/403.
// Histórico: sessionStorage (max 50 msgs) — stateless por design.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, X, Send, Lightbulb, Bot } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { ApiError } from "@/types/api";
import "./assistant.css";

type Role = "user" | "assistant";
interface Msg { role: Role; content: string; fonte?: "ia" | "demo"; ts: number; }
interface StatusResp { configurado: boolean; provider?: string; model?: string; }
interface AssistResp  { texto: string; fonte: "ia" | "demo"; }

const STORAGE_KEY_ADMIN = "calebe-assistant-history";
const STORAGE_KEY_DEV   = "calebe-assistant-history-dev";
const MAX_HISTORY = 50;
const VISIBLE_SUGGESTIONS = 3;

// Sugestões focadas na operação do negócio (ADMIN)
const SUGGESTIONS_ADMIN: string[] = [
  "Como vão as vendas do mês?",
  "Qual a taxa de conversão atual?",
  "Quantos leads recebi este mês?",
  "Quantos leads aguardando distribuição?",
  "Tem lead parado há mais de 7 dias?",
  "Quais imóveis ativos estão sem corretor?",
  "Qual corretor está convertendo mais?",
  "Quantas vendas fechamos no mês?",
  "Total de imóveis ativos no portfólio?",
  "Quais são os top 3 corretores?",
];

// Sugestões focadas em saúde do sistema (DEV)
const SUGGESTIONS_DEV: string[] = [
  "Quantas mensagens frustradas tivemos hoje?",
  "Tem erro recente nas últimas 24h?",
  "Como está a taxa de falha de mensagens?",
  "WhatsApp Cloud e VAI estão configurados?",
  "Quantos bug reports abertos nos últimos 7 dias?",
  "Quais os tipos de bug mais relatados?",
  "Quantos usuários logaram nas últimas 24h?",
  "Status atual da IA (provider e modelo)?",
  "Quantas push subscriptions ativas?",
  "Algum problema de binding no WhatsApp?",
];

const STORAGE_KEY_CORRETOR = "calebe-assistant-history-corretor";
const SUGGESTIONS_CORRETOR: string[] = [
  "Quais são os meus leads?",
  "Como está o meu desempenho este mês?",
  "Tenho leads sem contato?",
  "Quantos leads recebi nos últimos 7 dias?",
  "Me dá uma dica pra abordar um lead novo.",
  "Quais leads devo priorizar hoje?",
];

// LLMs adoram ** apesar do system prompt pedir texto puro · cinto + suspensório.
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^---+\s*$/gm, "")
    .replace(/^\s*[*-]\s+/gm, "- ");
}

function loadHistory(storageKey: string): Msg[] {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Msg[];
    return Array.isArray(arr) ? arr.slice(-MAX_HISTORY) : [];
  } catch { return []; }
}

function saveHistory(storageKey: string, msgs: Msg[]): void {
  try { sessionStorage.setItem(storageKey, JSON.stringify(msgs.slice(-MAX_HISTORY))); } catch { /* quota */ }
}

function firstName(name?: string | null): string {
  if (!name) return "";
  return name.trim().split(/\s+/)[0] ?? "";
}

export function AssistantChat() {
  const user = useAuth((s) => s.user);
  const isDev = user?.role === "DEV";
  const isCorretor = user?.role === "ASSOCIATE";
  const canUseIa = user?.role === "ADMIN" || isDev || isCorretor;

  // Perfil define: nome, sugestões e bucket de histórico
  const SUGGESTIONS = isDev ? SUGGESTIONS_DEV : isCorretor ? SUGGESTIONS_CORRETOR : SUGGESTIONS_ADMIN;
  const STORAGE_KEY = isDev ? STORAGE_KEY_DEV : isCorretor ? STORAGE_KEY_CORRETOR : STORAGE_KEY_ADMIN;
  const HEAD_NAME   = isDev ? "Assistente Técnico Calebe" : isCorretor ? "Claude · Seu Assistente" : "Assistente Calebe IA";
  const HERO_SUB    = isDev
    ? "Pergunte sobre erros, mensagens frustradas, integrações e saúde do sistema."
    : isCorretor
    ? "Pergunte sobre os seus leads, seu desempenho e dicas de atendimento."
    : "Pergunte sobre vendas, leads, corretores, imóveis ou como usar o sistema.";

  // Gate cliente: só renderiza pra ADMIN ou DEV. Se backend rejeitar (403), também esconde.
  const [allowed, setAllowed] = useState<boolean>(canUseIa);

  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => loadHistory(STORAGE_KEY));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [iaStatus, setIaStatus] = useState<StatusResp | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const taRef   = useRef<HTMLTextAreaElement | null>(null);

  // Sanity check no mount: confirma que o usuário tem acesso à rota da IA.
  useEffect(() => {
    if (!canUseIa) { setAllowed(false); return; }
    let cancel = false;
    (async () => {
      try {
        const s = await api.get<StatusResp>("/api/assistant/status");
        if (!cancel) { setIaStatus(s); setAllowed(true); }
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          if (!cancel) setAllowed(false);
        }
      }
    })();
    return () => { cancel = true; };
  }, [canUseIa]);

  useEffect(() => { saveHistory(STORAGE_KEY, msgs); }, [msgs, STORAGE_KEY]);

  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const handleAsk = useCallback(async (perguntaArg?: string) => {
    const pergunta = (perguntaArg ?? draft).trim();
    if (!pergunta || sending) return;
    setSuggestionsOpen(false);
    setSending(true);
    const now = Date.now();
    const _history = [...msgs, { role: "user" as const, content: pergunta }].map((m) => ({ role: m.role, content: m.content }));
    setMsgs((prev) => [...prev, { role: "user", content: pergunta, ts: now }]);
    setDraft("");
    try {
      const r = await api.post<{ reply: string }>("/api/assistant", { messages: _history });
      const texto = stripMarkdown(r?.reply || "").trim() || "Sem resposta.";
      setMsgs((prev) => [...prev, { role: "assistant", content: texto, fonte: "ia", ts: Date.now() }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erro";
      setMsgs((prev) => [...prev, { role: "assistant", content: `Não consegui responder agora (${msg}).`, ts: Date.now() }]);
    } finally {
      setSending(false);
      setTimeout(() => taRef.current?.focus(), 50);
    }
  }, [draft, sending, msgs]);

  const onKeyDownInput = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleAsk();
    }
  };

  const clearChat = () => {
    setMsgs([]);
    setSuggestionsOpen(true);
    setSuggestionsExpanded(false);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  };
  void clearChat; // mantém função pública pro futuro botão "limpar"

  const statusLabel = useMemo(() => {
    if (!iaStatus) return { text: "Conectando…", className: "calebe-asst__status--idle" };
    if (iaStatus.configurado) return { text: "Pronto", className: "calebe-asst__status--ok" };
    return { text: "Modo demo", className: "calebe-asst__status--demo" };
  }, [iaStatus]);

  if (!allowed) return null;

  const nome = firstName(user?.name);
  const visibleSuggestions = suggestionsExpanded ? SUGGESTIONS : SUGGESTIONS.slice(0, VISIBLE_SUGGESTIONS);
  const showSuggestionsBlock = suggestionsOpen && msgs.length === 0;

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} style={{ position: "fixed", bottom: "94px", right: "18px", zIndex: 60, background: "linear-gradient(135deg,#8B5CF6,#6D28D9)", color: "#fff", padding: "8px 12px", borderRadius: "14px", fontSize: "12px", fontWeight: 700, boxShadow: "0 8px 24px rgba(109,40,217,.45)", maxWidth: "190px", lineHeight: 1.25, textAlign: "left", border: "none", cursor: "pointer" }}>
          &#10024; Clica aqui que eu fa&ccedil;o por voc&ecirc;
        </button>
      )}
      {/* FAB */}
      <button
        type="button"
        className="calebe-asst__fab"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Fechar assistente" : "Abrir assistente"}
        title="Assistente IA"
      >
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>

      {open && (
        <div className="calebe-asst__panel" role="dialog" aria-label="Assistente IA">
          <header className="calebe-asst__header">
            <div className="calebe-asst__head-left">
              <div className="calebe-asst__avatar" aria-hidden>
                <Bot size={18} />
              </div>
              <div className="calebe-asst__head-meta">
                <span className="calebe-asst__head-name">{HEAD_NAME}</span>
                <span className={`calebe-asst__status ${statusLabel.className}`}>
                  <span className="calebe-asst__status-dot" />
                  {statusLabel.text}
                </span>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="calebe-asst__icon-btn" aria-label="Fechar" title="Fechar">
              <X size={16} />
            </button>
          </header>

          <div ref={bodyRef} className="calebe-asst__body">
            {msgs.length === 0 && (
              <div className="calebe-asst__hero">
                <p className="calebe-asst__hero-title">
                  Como posso ajudar{nome ? `, ${nome}` : ""}?
                </p>
                <p className="calebe-asst__hero-sub">
                  {HERO_SUB}
                </p>
              </div>
            )}

            {msgs.map((m, i) => (
              <div key={i} className={`calebe-asst__msg calebe-asst__msg--${m.role}`}>
                <div className="calebe-asst__bubble">{m.content}</div>
                {m.role === "assistant" && m.fonte === "demo" && (
                  <span className="calebe-asst__demo-tag">modo demo</span>
                )}
              </div>
            ))}

            {sending && (
              <div className="calebe-asst__msg calebe-asst__msg--assistant">
                <div className="calebe-asst__bubble calebe-asst__bubble--typing">
                  <span /><span /><span />
                </div>
              </div>
            )}

            {showSuggestionsBlock && (
              <div className="calebe-asst__suggestions">
                {visibleSuggestions.map((s) => (
                  <button key={s} type="button" className="calebe-asst__suggestion" onClick={() => void handleAsk(s)}>
                    {s}
                  </button>
                ))}
                {!suggestionsExpanded && SUGGESTIONS.length > VISIBLE_SUGGESTIONS && (
                  <button
                    type="button"
                    className="calebe-asst__more"
                    onClick={() => setSuggestionsExpanded(true)}
                  >
                    <Lightbulb size={14} />
                    Ver mais sugestões…
                  </button>
                )}
                {suggestionsExpanded && (
                  <button
                    type="button"
                    className="calebe-asst__more"
                    onClick={() => setSuggestionsExpanded(false)}
                  >
                    <Lightbulb size={14} />
                    Mostrar menos
                  </button>
                )}
              </div>
            )}
          </div>

          <footer className="calebe-asst__footer">
            <button
              type="button"
              className={`calebe-asst__hint-btn ${suggestionsOpen ? "is-on" : ""}`}
              onClick={() => {
                if (msgs.length > 0) clearChat();
                else setSuggestionsOpen((v) => !v);
              }}
              aria-label={msgs.length > 0 ? "Limpar conversa e ver sugestões" : "Mostrar/ocultar sugestões"}
              title={msgs.length > 0 ? "Limpar conversa" : "Mostrar/ocultar sugestões"}
            >
              <Lightbulb size={16} />
            </button>
            <textarea
              ref={taRef}
              className="calebe-asst__input"
              placeholder="Pergunte algo…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDownInput}
              rows={1}
              disabled={sending}
            />
            <button
              type="button"
              className="calebe-asst__send"
              onClick={() => void handleAsk()}
              disabled={!draft.trim() || sending}
              aria-label="Enviar"
            >
              <Send size={16} />
            </button>
          </footer>
        </div>
      )}
    </>
  );
}
