// Atendimento (corretor) · porte FIEL ao monólito (cors-chat · linhas 2957-3131)
// Inclui: status filter chips · SLA badge · presence dot · header completo (tel mascarado +
// fonte + imóvel + Liberar contato) · toolbar Ligar · action toolbar (Estrutura/Vincular/
// Venda/Fechamento/Descartar) · WA Cloud abordagem callout · Pitch padrão · Coach IA panel ·
// audio recording UX (idle/recording/sending) · 3 estados do input
//
// SSE via useConversations.registerSse() · polling 20s pausa em document.hidden (W7)

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Lock, Unlock, Phone, Sparkles, Send, MessageSquareHeart, UserPlus,
  Home, FileCheck2, Handshake, XCircle, Mic, Paperclip, X, Loader2, Quote, Lightbulb,
  Copy, Clock, MessageCircle, AlertTriangle, MoreVertical, LifeBuoy,
} from "lucide-react";
import { useConversations } from "@/store/conversations";
import { useAuth } from "@/store/auth";
import { useUi } from "@/store/ui";
import { ChatList } from "@/components/chat/ChatList";
import { ChatStream } from "@/components/chat/ChatStream";
import { NovaVendaModal } from "../components/NovaVendaModal";
import { MetaTemplateModal } from "../components/MetaTemplateModal";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { CHAT_STATUS, LEAD_TO_CHAT_STATUS, type ChatStatus } from "@/types/conversation";
import type { Conversation } from "@/types/conversation";

// Conversation não tem campo status no backend — deriva do lead.status (mesma lógica do ChatMonitor)
function convStatus(c: Conversation | null | undefined): ChatStatus | undefined {
  if (!c) return undefined;
  if (c.status) return c.status;
  const ls = c.lead?.status;
  return ls ? LEAD_TO_CHAT_STATUS[ls] : undefined;
}

type StatusFilter = "all" | "novo" | "qualificando" | "negociando" | "fechamento";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all",           label: "Todos" },
  { key: "novo",          label: "Novos" },
  { key: "qualificando",  label: "Qualificando" },
  { key: "negociando",    label: "Negociando" },
  { key: "fechamento",    label: "Fechamento" },
];

const PITCH_PADRAO =
  "Olá! Aqui é o seu assessor Calebe — assessoria imobiliária premium em Santa Catarina. " +
  "Acabei de receber seu contato e quero te ajudar a encontrar a oportunidade ideal. " +
  "Posso te enviar 2 ou 3 opções alinhadas com o seu perfil? Me conta rapidinho: você busca para morar, investir ou veranear?";

function formatSla(ms: number): { text: string; tone: "ok" | "warn" | "danger" } {
  if (ms < 60_000) return { text: "agora", tone: "ok" };
  const min = Math.floor(ms / 60_000);
  if (min < 60) return { text: `${min}m`, tone: min > 15 ? "warn" : "ok" };
  const h = Math.floor(min / 60);
  if (h < 24) return { text: `${h}h`, tone: h > 2 ? "danger" : "warn" };
  return { text: `${Math.floor(h / 24)}d`, tone: "danger" };
}

export function CorretorConversa() {
  const list = useConversations((s) => s.list);
  const fetchList = useConversations((s) => s.fetchList);
  const loadMessages = useConversations((s) => s.loadMessages);
  const registerSse = useConversations((s) => s.registerSse);
  const setActive = useConversations((s) => s.setActive);
  const activeId = useConversations((s) => s.activeId);

  const user = useAuth((s) => s.user);
  const showToast = useUi((s) => s.showToast);
  const nav = useNavigate();
  const { convId } = useParams<{ convId?: string }>();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [vendaModalOpen, setVendaModalOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  // Sheet de "mais ações" no mobile · concentra Ligar + Estrutura + Vincular + Venda + Fechar + Descartar
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [assistModalOpen, setAssistModalOpen] = useState(false);

  // boot · 1ª fetch + registra SSE
  useEffect(() => {
    void fetchList();
    const unsub = registerSse();
    return unsub;
  }, [fetchList, registerSse]);

  // Sincroniza activeId com URL param
  useEffect(() => {
    if (convId && convId !== activeId) setActive(convId);
  }, [convId, activeId, setActive]);

  // polling 20s pra cobrir SSE down · pausa em document.hidden (W7)
  usePolling(() => fetchList(), { intervalMs: 20000, immediate: false });

  // Quando seleciona conversa, carrega mensagens
  useEffect(() => {
    if (activeId) void loadMessages(activeId);
  }, [activeId, loadMessages]);

  const meAssocId = (user?.associate as any)?.id;
  const myConversations = useMemo(
    () => list.filter((c) => !meAssocId || c.associateId === meAssocId),
    [list, meAssocId],
  );

  // Aplica filtro de status sobre as conversas (deriva de lead.status)
  const filteredConversations = useMemo(() => {
    if (statusFilter === "all") return myConversations;
    return myConversations.filter((c) => convStatus(c) === statusFilter);
  }, [myConversations, statusFilter]);

  const active = activeId ? myConversations.find((c) => c.id === activeId) : null;
  const activeStatus = convStatus(active);

  // SLA · tempo desde última msg inbound do lead
  const slaInfo = useMemo(() => {
    if (!active?.lastMessage) return null;
    if (active.lastMessage.direction !== "inbound") return null;
    const at = active.lastMessage.createdAt ?? active.lastMessage.at;
    if (!at) return null;
    const ms = Date.now() - new Date(at).getTime();
    return formatSla(ms);
  }, [active]);

  // Detecta primeiro contato (sem msg outbound) · mostra WA Cloud callout
  const isFirstContact = useMemo(() => {
    if (!active) return false;
    const msgs = active.messages ?? [];
    return !msgs.some((m) => m.direction === "outbound" || m.direction === "OUT");
  }, [active]);

  // Lead respondeu? (alguma inbound) · habilita pitch padrão
  const leadResponded = useMemo(() => {
    if (!active) return false;
    return (active.messages ?? []).some((m) => m.direction === "inbound" || m.direction === "IN");
  }, [active]);

  // =======================================================================
  // GATE de janela WhatsApp · WA Cloud só entrega quando o lead respondeu
  // nas últimas 24h. Fora desse intervalo, qualquer outbound vira /dev/null.
  // Solução: bloquear composer e forçar template oficial Meta, com limite
  // de 2 templates antes de aguardar resposta (evita spam).
  // =======================================================================
  const WA_WINDOW_HOURS = 24;
  const TEMPLATE_LIMIT  = 2;

  const isInbound = (d?: string) => d === "inbound" || d === "IN";
  const isOutbound = (d?: string) => d === "outbound" || d === "OUT";

  const waGate = useMemo(() => {
    if (!active) return null;
    const msgs = active.messages ?? [];
    // Última inbound (mais recente)
    let lastInboundAt: number | null = null;
    for (const m of msgs) {
      if (!isInbound(m.direction)) continue;
      const at = m.createdAt ?? m.at;
      if (!at) continue;
      const t = new Date(at).getTime();
      if (Number.isFinite(t) && (lastInboundAt === null || t > lastInboundAt)) lastInboundAt = t;
    }
    const hasInbound = lastInboundAt !== null;
    const windowOpen = hasInbound && (Date.now() - (lastInboundAt as number)) < WA_WINDOW_HOURS * 60 * 60 * 1000;
    // Outbounds enviados desde a última inbound (ou desde o início se !hasInbound)
    const templatesSent = msgs.reduce((acc, m) => {
      if (!isOutbound(m.direction)) return acc;
      const at = m.createdAt ?? m.at;
      const t = at ? new Date(at).getTime() : 0;
      if (lastInboundAt && t < lastInboundAt) return acc;
      return acc + 1;
    }, 0);
    const requiresTemplate = !windowOpen;
    const canSendTemplate = templatesSent < TEMPLATE_LIMIT;
    return { hasInbound, lastInboundAt, windowOpen, templatesSent, requiresTemplate, canSendTemplate };
    // CRÍTICO: as deps precisam observar a LISTA de mensagens (não só o objeto active).
    // O store muta active.messages em-place e só troca a referência do array (não do conv).
    // Sem incluir messages aqui, o gate ficava preso: SSE chegava com nova msg inbound mas
    // o useMemo não rodava de novo (===deps inalteradas) → composer continuava bloqueado
    // mesmo após o cliente responder.
  }, [active, active?.messages, active?.messages?.length]);

  // Presence · online se associate.user.lastSeenAt < 90s
  const leadOnline = false; // backend ainda não expõe presence do lead · placeholder

  // ============ Ações da toolbar ============
  async function chatAcaoEstrutura() {
    showToast("Abrindo Estrutura Premium…");
    window.location.hash = "#/corretor/estrutura";
  }
  async function chatAcaoVincular() {
    if (!active) return;
    const imovelId = prompt("ID do imóvel a vincular ao lead (CUID):");
    if (!imovelId?.trim()) return;
    try {
      // PATCH /api/leads/:id { linkedPropertyId } — backend zod strict aceita cuid|null
      await api.patch(`/api/leads/${active.leadId}`, { linkedPropertyId: imovelId.trim() });
      showToast("Imóvel vinculado · status avançado pra Negociando");
      void fetchList();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }
  function chatAcaoVenda() {
    if (!active) { showToast("Abra uma conversa primeiro"); return; }
    setVendaModalOpen(true);
  }
  async function chatAcaoQualificar() {
    if (!active) return;
    try {
      await api.patch(`/api/leads/${active.leadId}/status`, { status: "QUALIFYING" });
      showToast("Lead marcado como Qualificando");
      void fetchList();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }
  async function chatAcaoConcluirVenda() {
    if (!active) return;
    if (!confirm("Marcar negociação como CONCLUÍDA? Isso fecha a conversa na VAI e encerra o ciclo do lead.")) return;
    try {
      // PATCH status CLOSED — backend encerra chat na VAI + limpa vaiConvId preservando contato
      await api.patch(`/api/leads/${active.leadId}/status`, { status: "CLOSED" });
      showToast("Venda concluída · lead fechado");
      void fetchList();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }
  async function chatAcaoFechar() {
    if (!active) return;
    // Workflow do legado: "Solicitar fechamento" = pedir liberação de telefone com justificativa
    // de negociação. Admin aprova → Conversation.phoneReleased=true (corretor consegue ver tel real).
    // O Lead.status NÃO muda automaticamente pra CLOSING — segue NEGOTIATING até venda registrada.
    const justificativa = prompt("Justifique por que essa negociação está pronta pra fechar (admin vai aprovar e liberar o telefone real):");
    if (!justificativa?.trim()) return;
    if (justificativa.trim().length < 5) { showToast("Justificativa muito curta (mínimo 5 caracteres)"); return; }
    try {
      await api.post(`/api/phone-release`, {
        conversationId: active.id,
        justification: justificativa.trim(),
      });
      showToast("Solicitação enviada ao admin · aguarde aprovação pra ver o telefone real");
    } catch (e: unknown) {
      // Backend retorna 409 quando já tem pedido pendente ou tel já liberado
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("already_pending")) showToast("Já existe solicitação pendente pra esse lead");
      else if (msg.includes("already_released")) showToast("Telefone já está liberado");
      else showToast(`Erro: ${msg}`);
    }
  }
  async function chatAcaoDescartar() {
    if (!active) return;
    const motivo = prompt("Motivo do descarte (Sem condição financeira / Quer comprar no futuro / Precisa vender outro imóvel / Não respondeu / Outros):");
    if (!motivo?.trim()) return;
    try {
      // PATCH /api/leads/:id/status { status: "LOST", reason } — backend salva discardReason+discardedAt
      await api.patch(`/api/leads/${active.leadId}/status`, { status: "LOST", reason: motivo.trim() });
      showToast("Lead descartado");
      void fetchList();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }
  async function chatLigarParaLead() {
    if (!active?.leadId) return;
    // Calebe Bridge · POST /api/leads/:id/voice-call (Twilio)
    // Backend liga primeiro pro corretor; quando ele atende, conecta com o lead.
    // Telefone do lead vem decriptado server-side (corretor não precisa "Liberar contato" pra ligar).
    showToast("Iniciando ligação · seu telefone vai tocar em segundos");
    try {
      const r = await api.post<{ ok?: boolean; callSid?: string; preNotice?: { ok?: boolean } }>(
        `/api/leads/${active.leadId}/voice-call`,
        {}
      );
      if (r.callSid) {
        const preMsg = r.preNotice?.ok ? " · aviso prévio enviado por WhatsApp" : "";
        showToast(`Ligação encaminhada${preMsg}. Atenda seu celular pra falar com o lead.`);
      } else {
        showToast("Ligação iniciada");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("twilio_not_configured")) {
        showToast("Calebe Bridge não está configurado · contate o admin");
      } else if (msg.includes("no_corretor_phone")) {
        showToast("Você precisa cadastrar seu telefone em Meu Perfil pra usar a ligação");
      } else if (msg.includes("not_lead_owner")) {
        showToast("Esse lead não é seu · só o corretor responsável pode ligar");
      } else if (msg.includes("phone_decrypt_failed")) {
        showToast("Erro ao descriptografar telefone do lead · contate o suporte");
      } else if (msg.includes("not_found")) {
        showToast("Lead não encontrado");
      } else {
        showToast(`Erro ao ligar: ${msg}`);
      }
    }
  }
  async function chatPedirLiberacaoTel() {
    if (!active) return;
    const justificativa = prompt("Justifique a necessidade de liberar o telefone:");
    if (!justificativa?.trim()) return;
    try {
      // POST /api/phone-release { conversationId, justification } — endpoint real do backend
      await api.post(`/api/phone-release`, {
        conversationId: active.id,
        justification: justificativa.trim(),
      });
      showToast("Solicitação de liberação enviada ao admin");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Erro: ${msg}`);
    }
  }

  // Mobile: quando active está setado, escondemos lista + header da página → chat fullscreen
  const mobileFullscreenChat = !!active;

  return (
    <div className={`${mobileFullscreenChat ? "p-0 md:p-6 lg:p-8" : "p-4 md:p-6 lg:p-8"}`}>
      {/* Header da página · escondido no mobile quando uma conversa está aberta */}
      <header className={`mb-5 flex-wrap justify-between items-end gap-3 ${mobileFullscreenChat ? "hidden md:flex" : "flex"}`}>
        <div>
          <p className="meta-gold mb-1">Conversas</p>
          <h1 className="text-2xl md:text-3xl font-bold tracking-display-tight">Chat com leads</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a
            href="https://wa.me/5547992069573?text=Ol%C3%A1%2C%20sou%20Corretor%20Associado%20Calebe%20e%20preciso%20de%20ajuda."
            target="_blank" rel="noopener noreferrer"
            className="btn-ajuda-calebe"
            title="Ajuda do Calebe · WhatsApp"
          >
            <MessageSquareHeart size={16} /> Ajuda do Calebe
          </a>
          <button
            className="btn-base btn-gold"
            style={{ padding: ".55rem 1.1rem" }}
            onClick={() => showToast("Adicionar Lead Manual em breve")}
          >
            <UserPlus size={14} /> Adicionar Lead Manual
          </button>
        </div>
      </header>

      {/*
       * Container do chat
       * Desktop: split view (lista + chat lado a lado) com altura calculada
       * Mobile: fullscreen — mostra LISTA ou CHAT (nunca os dois)
       * NOTA: usa "card" direto (não "md:card") pra `html.light .card` aplicar tema claro.
       * Tailwind responsive prefix gera ".md\\:card" que NÃO é alvo do override de tema.
       */}
      <div className={`card md:overflow-hidden flex h-[100dvh] md:h-[calc(100dvh-260px)] md:min-h-[560px] border-0 md:border md:border-app-border`}>
        {/* ============ Sidebar de conversas ============ */}
        <aside className={`w-full md:w-80 shrink-0 md:border-r hairline flex-col ${mobileFullscreenChat ? "hidden md:flex" : "flex"}`}>
          <div className="p-3 border-b hairline">
            <input
              className="field-input py-2 text-sm w-full"
              placeholder="Buscar conversa…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {/* Status filter chips · monólito linha 2975 */}
          <div className="px-3 py-2 border-b hairline flex gap-1 overflow-x-auto">
            {STATUS_FILTERS.map((f) => {
              const active = statusFilter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={`text-[0.65rem] uppercase tracking-mono-wide font-semibold px-2 py-1 rounded-[3px] whitespace-nowrap transition-colors ${
                    active
                      ? "bg-gold-400/15 text-gold-300 border border-gold-400/30"
                      : "text-sand-100/55 hover:text-sand-50"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <div className="flex-1 overflow-y-auto">
            <ChatList
              conversations={filteredConversations}
              activeId={activeId}
              onSelect={(id) => { setActive(id); nav(`/corretor/chat/conv/${id}`); }}
              filterQuery={search}
            />
          </div>
        </aside>

        {/* ============ Área do chat ativo ============ */}
        <section className={`flex-1 flex-col min-w-0 min-h-0 ${mobileFullscreenChat ? "flex" : "hidden md:flex"}`}>
          {active ? (
            <>
              {/* Status pills · estado da negociação */}
              {(() => {
                const _activeStatus = convStatus(active);
                return _activeStatus ? (
                <div className="px-5 pt-4 pb-3 border-b hairline flex flex-wrap gap-2">
                  <span
                    className="text-[0.62rem] uppercase tracking-mono-xwide font-bold px-2 py-1 rounded"
                    style={{ background: CHAT_STATUS[_activeStatus]?.bg, color: CHAT_STATUS[_activeStatus]?.color }}
                  >
                    {CHAT_STATUS[_activeStatus]?.label ?? _activeStatus}
                  </span>
                  {active.phoneReleased && (
                    <span className="text-[0.62rem] uppercase tracking-mono-xwide font-bold px-2 py-1 rounded bg-emerald-400/15 text-emerald-300">
                      Tel liberado
                    </span>
                  )}
                  {active.manualFree && (
                    <span className="text-[0.62rem] uppercase tracking-mono-xwide font-bold px-2 py-1 rounded bg-sand-100/15 text-sand-50">
                      Manual livre
                    </span>
                  )}
                </div>
                ) : null;
              })()}

              {/* Header da conversa · monólito linha 2991 */}
              <header className="px-5 py-3 border-b hairline flex items-center gap-3 flex-wrap">
                <button
                  className="text-sand-100/70 hover:text-gold-400 -ml-1 mr-1"
                  onClick={() => { setActive(null); nav("/corretor/chat"); }}
                  aria-label="Voltar à lista"
                  title="Voltar a Meus leads"
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="relative shrink-0">
                  <div className="h-10 w-10 rounded-full bg-gold-400/15 flex items-center justify-center text-gold-400 font-bold">
                    {(active.lead?.name?.[0] ?? "—").toUpperCase()}
                  </div>
                  {leadOnline && (
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-app-canvas" title="online" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate text-[0.95rem]">{active.lead?.name ?? "—"}</p>
                  {leadOnline && (
                    <p className="text-[0.7rem] text-emerald-400/90 mt-0.5 truncate">online</p>
                  )}
                  <p className="text-xs text-sand-100/60 flex items-center gap-2 flex-wrap mt-0.5">
                    <span className="inline-flex items-center gap-1 text-gold-400">
                      <Lock size={11} />
                      {active.lead?.phoneMasked ?? "—"}
                    </span>
                    <span className="text-sand-100/40">·</span>
                    <span>{active.lead?.origin ?? active.lead?.source ?? "—"}</span>
                    <span className="text-sand-100/40">·</span>
                    <span className="inline-flex items-center gap-1 text-sand-100/75">
                      <Home size={11} className="text-gold-400/60" />
                      {active.lead?.linkedPropertyId ?? "—"}
                    </span>
                    {!active.phoneReleased && (
                      <>
                        <span className="text-sand-100/40">·</span>
                        <button
                          onClick={chatPedirLiberacaoTel}
                          className="inline-flex items-center gap-1 text-[0.7rem] uppercase tracking-mono-wide font-semibold text-gold-300 hover:text-gold-200 hover:underline"
                          title="Solicita ao admin liberação do telefone real do lead"
                        >
                          <Unlock size={11} /> Liberar contato
                        </button>
                      </>
                    )}
                  </p>
                </div>
                {slaInfo && (
                  <span
                    className="inline-flex items-center gap-1.5 text-[0.7rem] md:text-[0.65rem] uppercase tracking-mono-xwide font-semibold px-2 md:px-2.5 py-1 rounded-full border shrink-0 whitespace-nowrap"
                    style={{
                      borderColor: slaInfo.tone === "danger" ? "rgba(239,68,68,.5)" : slaInfo.tone === "warn" ? "rgba(245,165,36,.5)" : "rgba(95,209,168,.4)",
                      color: slaInfo.tone === "danger" ? "#E89494" : slaInfo.tone === "warn" ? "#F5A524" : "#5FD1A8",
                    }}
                  >
                    <Clock size={11} /> {slaInfo.text}
                  </span>
                )}
                {/* Botão "Mais ações" · só no mobile (esconde no md+ porque as toolbars já mostram tudo) */}
                <button
                  className="md:hidden p-2 -mr-1 text-sand-100/70 hover:text-gold-400 shrink-0"
                  onClick={() => setMobileActionsOpen(true)}
                  aria-label="Mais ações"
                  title="Mais ações"
                >
                  <MoreVertical size={20} />
                </button>
              </header>

              {/* Toolbar · Ligar (monólito 3019) · desktop-only · mobile vê no sheet "Mais ações" */}
              <div className="px-4 py-2 border-b hairline hidden md:flex items-center gap-2 flex-wrap">
                <button
                  className="btn-base btn-outline text-xs"
                  style={{ padding: ".45rem .9rem" }}
                  onClick={() => void chatLigarParaLead()}
                  title="Ligar pelo Calebe Bridge (número do cliente fica oculto)"
                >
                  <Phone size={12} /> Ligar
                </button>
              </div>

              {/* Mensagens */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <ChatStream messages={active.messages ?? []} />
              </div>

              {/* Action toolbar · ações rápidas (monólito 3029) · desktop-only · mobile vê no sheet "Mais ações" */}
              <div className="px-3 py-2 border-t hairline hidden md:flex gap-2 overflow-x-auto">
                {/* Marcar Qualificando · só aparece se status ainda for "novo" */}
                {activeStatus === "novo" && (
                  <button
                    className="text-[0.7rem] font-semibold px-3 py-2 md:py-1.5 rounded-[4px] bg-app-subtle/60 hover:bg-blue-500/15 hover:text-blue-300 text-sand-100/75 inline-flex items-center gap-1.5 whitespace-nowrap border hairline min-h-[40px]"
                    onClick={chatAcaoQualificar}
                  >
                    <UserPlus size={12} /> Marcar qualificando
                  </button>
                )}
                <button
                  className="text-[0.7rem] font-semibold px-3 py-2 md:py-1.5 rounded-[4px] bg-app-subtle/60 hover:bg-gold-400/15 hover:text-gold-300 text-sand-100/75 inline-flex items-center gap-1.5 whitespace-nowrap border hairline min-h-[40px]"
                  onClick={chatAcaoEstrutura}
                >
                  <Sparkles size={12} /> Agendar estrutura
                </button>
                <button
                  className="text-[0.7rem] font-semibold px-3 py-2 md:py-1.5 rounded-[4px] bg-app-subtle/60 hover:bg-gold-400/15 hover:text-gold-300 text-sand-100/75 inline-flex items-center gap-1.5 whitespace-nowrap border hairline min-h-[40px]"
                  onClick={chatAcaoVincular}
                >
                  <Home size={12} /> Vincular imóvel
                </button>
                <button
                  className="text-[0.7rem] font-semibold px-3 py-2 md:py-1.5 rounded-[4px] bg-app-subtle/60 hover:bg-gold-400/15 hover:text-gold-300 text-sand-100/75 inline-flex items-center gap-1.5 whitespace-nowrap border hairline min-h-[40px]"
                  onClick={chatAcaoVenda}
                >
                  <FileCheck2 size={12} /> Registrar venda
                </button>
                <button
                  className="text-[0.7rem] font-semibold px-3 py-2 md:py-1.5 rounded-[4px] bg-app-subtle/60 hover:bg-orange-500/15 hover:text-orange-300 text-sand-100/75 inline-flex items-center gap-1.5 whitespace-nowrap border hairline min-h-[40px]"
                  onClick={chatAcaoFechar}
                >
                  <Handshake size={12} /> Solicitar fechamento
                </button>
                {/* Concluir venda · só aparece quando já está em CLOSING (fechamento) */}
                {activeStatus === "fechamento" && (
                  <button
                    className="text-[0.7rem] font-semibold px-3 py-2 md:py-1.5 rounded-[4px] bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 inline-flex items-center gap-1.5 whitespace-nowrap border border-emerald-500/40 min-h-[40px]"
                    onClick={chatAcaoConcluirVenda}
                  >
                    <FileCheck2 size={12} /> Concluir venda
                  </button>
                )}
                <button
                  className="text-[0.7rem] font-semibold px-3 py-2 md:py-1.5 rounded-[4px] bg-app-subtle/60 hover:bg-gold-400/15 hover:text-gold-300 text-sand-100/75 inline-flex items-center gap-1.5 whitespace-nowrap border hairline min-h-[40px]"
                  onClick={() => setTemplateModalOpen(true)}
                  title="Enviar template Meta (mesmo com janela aberta)"
                >
                  <Send size={12} /> Enviar template
                </button>
                <button
                  className="text-[0.7rem] font-semibold px-3 py-2 md:py-1.5 rounded-[4px] bg-app-subtle/60 hover:bg-blue-500/15 hover:text-blue-300 text-sand-100/75 inline-flex items-center gap-1.5 whitespace-nowrap border hairline min-h-[40px]"
                  onClick={() => setAssistModalOpen(true)}
                  title="Solicitar ajuda do suporte interno"
                >
                  <LifeBuoy size={12} /> Pedir ajuda
                </button>
                <button
                  className="text-[0.7rem] font-semibold px-3 py-2 md:py-1.5 rounded-[4px] bg-app-subtle/60 hover:bg-red-500/15 hover:text-red-300 text-sand-100/75 inline-flex items-center gap-1.5 whitespace-nowrap border hairline min-h-[40px]"
                  onClick={chatAcaoDescartar}
                >
                  <XCircle size={12} /> Descartar lead
                </button>
              </div>

              {/* GATE de janela WhatsApp · banner amarelo permanente quando bloqueado */}
              {waGate?.requiresTemplate && (
                <div className="px-4 py-3 border-t border-amber-400/30 bg-amber-400/10">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={18} className="text-amber-300 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[0.82rem] font-bold text-amber-200">
                        {waGate.hasInbound
                          ? "Janela do WhatsApp fechada"
                          : "Esse cliente ainda não respondeu"}
                      </p>
                      <p className="text-[0.72rem] text-amber-100/85 mt-1 leading-snug">
                        {waGate.hasInbound
                          ? "A última mensagem do lead foi há mais de 24h. Mensagens normais não chegam — você precisa enviar um novo template oficial Meta pra reabrir a janela."
                          : "Mensagens só chegam ao cliente depois que ele respondeu. Envie um template oficial Meta pra iniciar a conversa."}
                      </p>
                      <p className="text-[0.7rem] text-amber-100/70 mt-2">
                        Templates enviados: <strong>{waGate.templatesSent}/{TEMPLATE_LIMIT}</strong>
                        {!waGate.canSendTemplate && (
                          <span className="ml-2 text-amber-300 font-semibold">
                            · Limite atingido. Aguarde resposta do lead.
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Composer · só mostra quando janela aberta · senão substitui por botão template */}
              {!waGate?.requiresTemplate ? (
                <ChatComposerFull
                  convId={active.id}
                  showPitch={leadResponded}
                  pitch={PITCH_PADRAO}
                  onSent={() => loadMessages(active.id)}
                />
              ) : (
                <div className="p-4 border-t hairline">
                  <button
                    type="button"
                    onClick={() => {
                      if (!waGate.canSendTemplate) {
                        showToast(`Limite de ${TEMPLATE_LIMIT} templates atingido pra esse lead. Aguarde resposta.`);
                        return;
                      }
                      setTemplateModalOpen(true);
                    }}
                    disabled={!waGate.canSendTemplate}
                    className={`w-full inline-flex items-center justify-center gap-2 font-bold uppercase tracking-mono-wide text-sm py-3 px-4 rounded-[6px] transition-colors ${
                      waGate.canSendTemplate
                        ? "bg-gold-400 hover:bg-gold-300 text-app-bg"
                        : "bg-app-subtle/40 text-sand-100/40 cursor-not-allowed border hairline"
                    }`}
                    style={{ minHeight: 48 }}
                  >
                    {waGate.canSendTemplate ? (
                      <>
                        <Send size={14} /> Enviar template oficial Meta
                      </>
                    ) : (
                      <>
                        <Lock size={14} /> Aguardando resposta do lead
                      </>
                    )}
                  </button>
                  <p className="text-[0.65rem] text-sand-100/55 mt-2 text-center">
                    <Lock size={9} className="inline mr-1" />
                    Composer bloqueado até o lead responder ·{" "}
                    {waGate.canSendTemplate
                      ? `${TEMPLATE_LIMIT - waGate.templatesSent} template${TEMPLATE_LIMIT - waGate.templatesSent === 1 ? "" : "s"} restante${TEMPLATE_LIMIT - waGate.templatesSent === 1 ? "" : "s"}`
                      : "limite atingido"}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sand-100/55 text-sm p-6 text-center">
              <div>
                <MessageCircle className="mx-auto mb-3 text-gold-400/40" size={48} />
                Selecione uma conversa à esquerda.
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Modal Nova Venda · pré-preenche com lead vinculado */}
      <NovaVendaModal
        open={vendaModalOpen}
        onClose={() => setVendaModalOpen(false)}
        onSaved={() => { setVendaModalOpen(false); void fetchList(); }}
        prefillPropertyId={active?.lead?.linkedPropertyId ?? null}
        prefillClientName={active?.lead?.name ?? ""}
      />

      {/* Modal Pedir Ajuda · POST /api/conversations/:id/request-assist */}
      {active && assistModalOpen && (
        <RequestAssistModal
          conversationId={active.id}
          leadName={active.lead?.name}
          onClose={() => setAssistModalOpen(false)}
        />
      )}

      {/* Modal Template Meta · reabre janela WhatsApp quando lead não respondeu */}
      {active && (
        <MetaTemplateModal
          open={templateModalOpen}
          onClose={() => setTemplateModalOpen(false)}
          conversationId={active.id}
          leadName={active.lead?.name}
          onSent={() => {
            setTemplateModalOpen(false);
            // Recarrega a lista de mensagens da conversa pra mostrar o template enviado
            void loadMessages(active.id);
            // Atualiza a lista também (lastMessageAt mudou)
            void fetchList();
          }}
        />
      )}

      {/* Sheet mobile · "Mais ações" · só aparece no mobile (md:hidden no overlay) */}
      {mobileActionsOpen && active && (
        <div
          className="fixed inset-0 z-[100] md:hidden calebe-overlay"
          onClick={() => setMobileActionsOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-app-canvas border-t hairline rounded-t-xl p-4 pb-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-sand-100/20 rounded-full mx-auto mb-4" />
            <p className="text-[0.7rem] uppercase tracking-mono-xwide font-bold text-sand-100/55 mb-3 px-1">
              Ações para {active.lead?.name || "este lead"}
            </p>
            <div className="grid gap-2">
              <SheetAction icon={<Phone size={16} />} label="Ligar (Calebe Bridge)" onClick={() => { setMobileActionsOpen(false); void chatLigarParaLead(); }} />
              {activeStatus === "novo" && (
                <SheetAction icon={<UserPlus size={16} />} label="Marcar qualificando" onClick={() => { setMobileActionsOpen(false); chatAcaoQualificar(); }} />
              )}
              <SheetAction icon={<Sparkles size={16} />} label="Agendar estrutura" onClick={() => { setMobileActionsOpen(false); chatAcaoEstrutura(); }} />
              <SheetAction icon={<Home size={16} />} label="Vincular imóvel" onClick={() => { setMobileActionsOpen(false); chatAcaoVincular(); }} />
              <SheetAction icon={<FileCheck2 size={16} />} label="Registrar venda" onClick={() => { setMobileActionsOpen(false); chatAcaoVenda(); }} />
              <SheetAction icon={<Handshake size={16} />} label="Solicitar fechamento" onClick={() => { setMobileActionsOpen(false); chatAcaoFechar(); }} />
              {activeStatus === "fechamento" && (
                <SheetAction icon={<FileCheck2 size={16} />} label="Concluir venda" tone="success" onClick={() => { setMobileActionsOpen(false); chatAcaoConcluirVenda(); }} />
              )}
              <SheetAction icon={<Send size={16} />} label="Enviar template Meta" onClick={() => { setMobileActionsOpen(false); setTemplateModalOpen(true); }} />
              <SheetAction icon={<LifeBuoy size={16} />} label="Pedir ajuda (suporte)" onClick={() => { setMobileActionsOpen(false); setAssistModalOpen(true); }} />
              <SheetAction icon={<XCircle size={16} />} label="Descartar lead" tone="danger" onClick={() => { setMobileActionsOpen(false); chatAcaoDescartar(); }} />
            </div>
            <button
              type="button"
              className="w-full mt-4 py-3 text-sm font-semibold text-sand-100/65 hover:text-sand-50 border-t hairline -mb-2"
              onClick={() => setMobileActionsOpen(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Botão de uma linha do sheet mobile · cinza neutro / danger / success
// Modal · Pedir ajuda do suporte interno (F1 Éder)
// POST /api/conversations/:id/request-assist { type, justification }
// Backend: 201 com { id, assistantName } · 503 se sem suporte disponível
function RequestAssistModal({ conversationId, leadName, onClose }: {
  conversationId: string;
  leadName?: string | null;
  onClose: () => void;
}) {
  const showToast = useUi((s) => s.showToast);
  const [type, setType] = useState<"Avaliação" | "Negociação" | "Apoio" | "Outro">("Apoio");
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (justification.trim().length < 5) { showToast("Justifique o pedido (mín 5 caracteres)"); return; }
    setSaving(true);
    try {
      const r = await api.post<{ assistantName?: string; alreadyExists?: boolean }>(
        `/api/conversations/${conversationId}/request-assist`,
        { type, justification: justification.trim() }
      );
      if (r.alreadyExists) {
        showToast("Já existe pedido em aberto pra esta conversa");
      } else {
        showToast(`Pedido enviado pra ${r.assistantName ?? "o suporte"}`);
      }
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("no_support_available")) {
        showToast("Nenhum suporte disponível no momento");
      } else if (msg.includes("self_request_blocked")) {
        showToast("Você é o suporte interno — não pode pedir pra si mesmo");
      } else {
        showToast(`Erro: ${msg}`);
      }
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] calebe-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-app-canvas border hairline rounded-lg w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b hairline">
          <div>
            <p className="text-xs uppercase tracking-mono-wide font-semibold text-sand-100/55">Suporte interno</p>
            <h2 className="font-bold text-lg flex items-center gap-2">
              <LifeBuoy size={18} className="text-blue-300" /> Pedir ajuda
            </h2>
            {leadName && (
              <p className="text-xs text-sand-100/65 mt-0.5">Conversa com {leadName}</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-sand-100/55 hover:text-sand-50" aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={submit} className="p-5 space-y-3">
          <div>
            <label className="field-label">Tipo de ajuda *</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(["Avaliação", "Negociação", "Apoio", "Outro"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`text-xs font-semibold py-2.5 px-3 rounded border transition-colors ${
                    type === t
                      ? "bg-gold-400/20 border-gold-400/50 text-gold-300"
                      : "bg-app-subtle/40 border-app-subtle text-sand-100/65 hover:text-sand-50"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="field-label">O que está acontecendo? *</label>
            <textarea
              className="field-input text-sm"
              rows={4}
              maxLength={2000}
              minLength={5}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Descreva brevemente. O suporte vai entrar na conversa e te ajudar."
              required
              autoFocus
            />
            <p className="text-[11px] text-sand-100/45 mt-1">{justification.length}/2000</p>
          </div>

          <p className="text-[11px] text-sand-100/55 bg-blue-500/5 border border-blue-500/25 rounded p-2 leading-snug">
            O suporte vai receber alerta imediato. Quando resolver, você é notificado e a conversa volta totalmente pra você.
          </p>

          <div className="flex justify-end gap-2 pt-2 border-t hairline">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" variant="gold" disabled={saving || justification.trim().length < 5}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <LifeBuoy size={14} />}
              {saving ? "Enviando…" : "Pedir ajuda"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SheetAction({ icon, label, onClick, tone }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "danger" | "success";
}) {
  const colorClass =
    tone === "danger"  ? "text-red-300 hover:bg-red-500/10" :
    tone === "success" ? "text-emerald-300 hover:bg-emerald-500/10" :
                         "text-sand-50 hover:bg-app-subtle/60";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border hairline bg-app-subtle/30 text-sm font-medium transition-colors ${colorClass}`}
      style={{ minHeight: 48 }}
    >
      <span className="shrink-0 opacity-80">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// =========================================================================
// Composer · 3 estados (idle / recording / sending) · pitch padrão + coach IA
// =========================================================================

interface ComposerProps {
  convId: string;
  showPitch: boolean;
  pitch: string;
  onSent: () => void;
}

function ChatComposerFull({ convId, showPitch, pitch, onSent }: ComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [sendingAudio, setSendingAudio] = useState(false);
  // Coach IA — polling /api/coach/suggestions?convId= a cada 15s · stub se backend retornar vazio
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [coachSuggestion, setCoachSuggestion] = useState<string>(
    "Confirme rapidamente o perfil (morar/investir) e ofereça 2 opções alinhadas. Reforce que pode mostrar pessoalmente."
  );
  const [coachDica, setCoachDica] = useState<string>("Use a estrutura Calebe (visita acompanhada) como diferencial competitivo.");

  // Polling Coach IA · 15s · pausa em document.hidden · revela painel quando vem sugestão nova
  useEffect(() => {
    if (!convId) return;
    let cancel = false;
    async function fetchCoach() {
      if (document.hidden) return;
      try {
        const r = await api.get<unknown>(`/api/coach/suggestions?convId=${encodeURIComponent(convId)}`);
        if (cancel) return;
        const arr = Array.isArray(r) ? r : ((r as { data?: unknown[] })?.data ?? []);
        const pending = (arr as Array<{ id?: string; texto?: string; text?: string; dica?: string; tip?: string; status?: string }>)
          .find((s) => !s.status || s.status === "pending");
        if (pending) {
          const t = pending.texto || pending.text || "";
          const d = pending.dica  || pending.tip  || "";
          const id = pending.id || null;
          if (t && id !== coachId) {
            setCoachId(id);
            setCoachSuggestion(t);
            if (d) setCoachDica(d);
            setCoachOpen(true);
          }
        }
      } catch { /* silent */ }
    }
    void fetchCoach();
    const tick = window.setInterval(fetchCoach, 15_000);
    const onVis = () => { if (!document.hidden) void fetchCoach(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancel = true; window.clearInterval(tick); document.removeEventListener("visibilitychange", onVis); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  async function coachAction(action: "use" | "dismiss") {
    if (!coachId) { setCoachOpen(false); return; }
    try { await api.patch(`/api/coach/suggestions/${encodeURIComponent(coachId)}`, { action }); }
    catch { /* silent — fechar painel mesmo se PATCH falhar */ }
    setCoachOpen(false);
    setCoachId(null);
  }

  const showToast = useUi((s) => s.showToast);
  const upsertMessage = useConversations((s) => s.upsertMessage);
  const applyMessageError = useConversations((s) => s.applyMessageError);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cleanup timer
  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);

  async function sendText(value: string) {
    const t = value.trim();
    if (!t) return;
    setSending(true);
    setText("");
    // Insere localmente (otimista) com id temp- e flag sending. Se backend OK,
    // o loadMessages depois substitui pela versão real. Se falhar, marca como
    // failed e a bolha fica vermelha PERMANENTE até user agir.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    upsertMessage(convId, {
      id: tempId,
      conversationId: convId,
      direction: "outbound",
      from: "corretor",
      text: t,
      createdAt: new Date().toISOString(),
      sending: true,
    });
    try {
      await api.post(`/api/conversations/${convId}/messages`, { text: t, direction: "OUT" });
      onSent(); // recarrega messages do server · substitui o temp-
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      applyMessageError(convId, tempId, reason);
      showToast(`Falha ao enviar · veja a bolha vermelha no chat`);
    } finally { setSending(false); }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api.post(`/api/conversations/${convId}/media`, fd);
      onSent();
    } catch (err: any) { showToast(`Falha no upload: ${err?.message ?? err}`); }
    finally { setSending(false); e.target.value = ""; }
  }

  async function startRecording() {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (ev) => { if (ev.data.size > 0) chunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setSendingAudio(true);
        try {
          const fd = new FormData();
          fd.append("file", blob, `audio-${Date.now()}.webm`);
          await api.post(`/api/conversations/${convId}/media`, fd);
          onSent();
        } catch (err: any) { showToast(`Falha no áudio: ${err?.message ?? err}`); }
        finally { setSendingAudio(false); }
      };
      mr.start();
      setRecording(true);
      setRecordingMs(0);
      const startTs = Date.now();
      timerRef.current = window.setInterval(() => setRecordingMs(Date.now() - startTs), 200);
    } catch (e: any) { showToast(`Microfone bloqueado: ${e?.message ?? e}`); }
  }

  function stopAndSend() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  function cancelRecording() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    chunksRef.current = [];
    const mr = mediaRecorderRef.current;
    if (mr) {
      mr.onstop = () => mr.stream.getTracks().forEach((t) => t.stop());
      mr.stop();
    }
    setRecording(false);
    setRecordingMs(0);
  }

  function soltarPitchPadrao() {
    setText(pitch);
    inputRef.current?.focus();
  }

  function useCoach() {
    setText(coachSuggestion);
    void coachAction("use");
    inputRef.current?.focus();
  }

  const timerStr = (() => {
    const s = Math.floor(recordingMs / 1000);
    const mm = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  })();

  return (
    <>
      {/* Pitch padrão · só quando lead respondeu e input vazio · desktop-only (ruído no mobile) */}
      {showPitch && !text.trim() && !recording && !sendingAudio && (
        <div className="px-3 pt-2 -mb-1 hidden md:block">
          <button
            onClick={soltarPitchPadrao}
            className="w-full text-[0.72rem] uppercase tracking-mono-wide font-semibold px-3 py-2 rounded-[4px] bg-gold-400/10 hover:bg-gold-400/20 text-gold-300 hover:text-gold-200 border border-gold-400/25 inline-flex items-center justify-center gap-2 transition-colors"
          >
            <Quote size={12} /> Soltar pitch padrão Calebe
          </button>
        </div>
      )}

      {/* Coach IA panel · desktop-only (mobile foca em texto puro) */}
      {coachOpen && (
        <div className="mx-3 mt-2 mb-1 rounded-[4px] border hairline bg-gradient-to-b from-gold-500/10 to-transparent px-3 py-2.5 hidden md:block">
          <div className="flex items-start gap-2">
            <Sparkles size={14} className="text-gold-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-mono-xwide text-gold-400/90 font-medium">
                  Coach IA · sugestão
                </span>
                <button
                  onClick={() => setCoachOpen(false)}
                  className="ml-auto text-sand-100/40 hover:text-sand-100/80"
                  title="Esconder · volta na próxima mensagem do lead"
                >
                  <X size={12} />
                </button>
              </div>
              <p className="text-sm text-sand-50 leading-relaxed mb-2">{coachSuggestion}</p>
              <div className="flex items-start gap-1.5 mb-2 pl-2 border-l-2 border-gold-500/30">
                <Lightbulb size={12} className="text-gold-400/70 mt-0.5 shrink-0" />
                <p className="text-[11px] text-sand-100/70 leading-relaxed italic">{coachDica}</p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={useCoach}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[3px] text-[11px] font-medium bg-gold-400 text-app-canvas hover:bg-gold-300 transition-colors"
                >
                  <Copy size={11} /> Usar
                </button>
                <button
                  onClick={() => void coachAction("dismiss")}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[3px] text-[11px] font-medium text-sand-100/70 hover:text-sand-50 hover:bg-app-elevated transition-colors"
                >
                  <X size={11} /> Dispensar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Input · 3 estados */}
      <div className="p-3 border-t hairline">
        {/* IDLE */}
        {!recording && !sendingAudio && (
          <div className="flex items-center gap-2 bg-app-subtle border hairline rounded-[4px] px-2 py-2">
            <label className="p-2 inline-flex items-center justify-center text-sand-100/70 hover:text-gold-400 transition-colors rounded-[3px] cursor-pointer" title="Anexar">
              <Paperclip size={16} />
              <input type="file" className="hidden" onChange={onPickFile} disabled={sending} />
            </label>
            <button
              className="p-2 inline-flex items-center justify-center text-sand-100/70 hover:text-gold-400 transition-colors rounded-[3px]"
              onClick={startRecording}
              title="Gravar áudio"
              aria-label="Gravar áudio"
            >
              <Mic size={16} />
            </button>
            <input
              ref={inputRef}
              type="text"
              placeholder="Mensagem…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && text.trim()) { e.preventDefault(); void sendText(text); }
              }}
              disabled={sending}
              className="flex-1 bg-transparent outline-none text-sm px-1 text-sand-50 placeholder:text-sand-100/40"
            />
            <button
              className="p-2 inline-flex items-center justify-center text-gold-400 hover:text-gold-300 transition-colors rounded-[3px] disabled:opacity-40"
              onClick={() => void sendText(text)}
              disabled={!text.trim() || sending}
              aria-label="Enviar"
            >
              <Send size={16} />
            </button>
          </div>
        )}

        {/* RECORDING */}
        {recording && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/40 rounded-[4px] px-3 py-2.5" style={{ minHeight: 46 }}>
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
            <span className="text-sm font-semibold text-red-300 shrink-0">Gravando</span>
            <span className="text-sm font-mono text-sand-50 tabular-nums shrink-0">{timerStr}</span>
            <div className="flex-1 flex items-end gap-[3px] h-[14px] overflow-hidden">
              {[0, .1, .2, .3, .4, .5, .6, .45, .3, .15].map((d, i) => (
                <span key={i} className="audio-wave" style={{ ["--d" as any]: `${d}s` }} />
              ))}
            </div>
            <button
              className="text-sand-100/65 hover:text-red-300 transition-colors shrink-0"
              onClick={cancelRecording}
              title="Cancelar gravação"
            >
              <X size={16} />
            </button>
            <button
              className="text-emerald-300 hover:text-emerald-200 transition-colors shrink-0"
              onClick={stopAndSend}
              title="Parar e enviar"
            >
              <Send size={16} />
            </button>
          </div>
        )}

        {/* SENDING áudio */}
        {sendingAudio && (
          <div className="flex items-center gap-3 bg-app-subtle border hairline rounded-[4px] px-3 py-2.5" style={{ minHeight: 46 }}>
            <Loader2 size={16} className="text-gold-400 animate-spin shrink-0" />
            <span className="text-sm text-sand-100/85">Enviando áudio…</span>
          </div>
        )}

        <p className="text-[0.65rem] text-sand-100/45 mt-2 text-center flex items-center justify-center gap-1.5">
          <Lock size={10} /> Telefone real só após aprovação do admin · Conversa auditada
        </p>
      </div>
    </>
  );
}
