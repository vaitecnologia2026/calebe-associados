// Chat Lead v2 — redesign WhatsApp-Web APROVADO, integrado ao app principal.
// Mantém a identidade Calebe (navy + dourado). O menu à esquerda é o do
// CorretorLayout (este componente NÃO traz rail próprio). Sem dados de amostra:
// só dados reais via @/lib/api. Regras Meta (janela 24h, template) preservadas.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  loadConversations, loadMessages, loadTemplates, loadImoveis,
  sendText, sendTemplate, acceptConv, pinConv, setStageApi, createLead, sendAudio, sendFile, mediaKind, audioSources, voiceCall, voiceCallConfirm,
  setLeadStatus, linkProperty, phoneRelease, templateParams, genderFromName,
  csRequestHelp, csActive,
  type Conv, type Imovel, type Template, type TmplBtn, type ChatMsg,
} from "./chat-v2-api";
import { resolveBackendUrl } from "@/lib/media";
import { NovaVendaModal } from "@/features/corretor/components/NovaVendaModal";
import { useAuth } from "@/store/auth";
import { Headphones, Handshake, BadgeCheck, Phone, Home, DollarSign, Trash2, MoreVertical, ChevronUp, ChevronDown, MessageCircle, Smartphone } from "lucide-react";
import "./chat-v2.css";

const STAGES = ["Novo", "Qualificando", "Negociação", "Fechamento", "Ganho", "Perdido"];
const STATUS: Record<string, { label: string; cls: string }> = {
  responded: { label: "Respondeu", cls: "green" },
  new: { label: "Novo lead", cls: "blue" },
  attention: { label: "Precisa atenção", cls: "red" },
  template: { label: "Sem resposta", cls: "yellow" },
  waiting_reply: { label: "Aguardando lead", cls: "gray" },
  discarded: { label: "Descartado", cls: "gray" },
};

const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
const Ico = ({ d, sw = 2, ...p }: any) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} {...p}><path d={d} /></svg>
);

// Link "Falar no WhatsApp" (wa.me) — abre conversa direta com o lead quando o
// contato está liberado. Garante DDI 55 (Brasil) se vier sem.
function waDigits(phone: any): string {
  let d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 11 && !d.startsWith("55")) d = "55" + d;
  return d;
}
function waLink(phone: any): string { const d = waDigits(phone); return d ? `https://wa.me/${d}` : ""; }

function errMsg(e: any, fallback: string): string {
  const m = (String(e?.message || "") + " " + JSON.stringify(e?.data ?? "")).toLowerCase();
  const status = e?.status;
  if (status === 401 || m.includes("no_auth") || m.includes("unauthorized") || m.includes("token"))
    return "Sessão expirada — entre de novo no app e recarregue a página.";
  if (m.includes("phone_already_exists")) {
    // Backend retorna ownerName + ownedByMe pra dar contexto operacional.
    const owner = e?.data?.ownerName;
    if (e?.data?.ownedByMe) return "Esse telefone já está cadastrado — o lead já está com você.";
    if (owner) return `Esse telefone já está cadastrado com ${owner}.`;
    return "Esse telefone já está cadastrado no sistema.";
  }
  if (m.includes("max_pins")) return "Máximo de 5 conversas fixadas. Desafixe uma para fixar outra.";
  if (m.includes("template_bloqueado")) return "Esse template foi desativado. Recarregue a página (F5) e escolha um dos templates atuais.";
  if (m.includes("not_an_associate") || status === 403) return "Sem permissão — entre como corretor (não admin).";
  if (m.includes("janela_24h_fechada")) return "O cliente ainda não respondeu. Use um template de reabordagem para iniciar a conversa.";
  if (m.includes("lead_blacklisted_131049") || m.includes("131049_temp")) return "Lead em pausa de qualidade — aguarde o cliente responder ou tente novamente em alguns dias.";
  if (m.includes("lead_invalid_number") || m.includes("invalid_number")) return "Número sem WhatsApp — não é possível enviar mensagens para este contato.";
  if (m.includes("lead_opted_out") || m.includes("opted_out")) return "Este contato optou por não receber mensagens de marketing.";
  if (m.includes("lead_blocked")) return "Envio bloqueado para este lead.";
  if (m.includes("131047") || m.includes("reengagement")) return "A janela de 24h fechou — envie um template aprovado para reabrir a conversa.";
  if (m.includes("132000") || m.includes("param")) return "Faltava um parâmetro do template (ex.: nome) — corrigi, tente de novo.";
  // Erros de NÃO-ENTREGA da Meta (throttle 131049 / opt-out 131050 / sem WhatsApp 131026 /
  // experimento 130472 / genérico) → mensagem única, sem culpar o app nem o corretor (2026-06-16).
  if (m.includes("131049") || m.includes("131050") || m.includes("131026") || m.includes("130472") || m.includes("131000") || m.includes("not delivered") || m.includes("undeliverable") || m.includes("ecosystem"))
    return "O WhatsApp não entregou esta mensagem. Se o cliente respondeu recentemente, aguarde e tente novamente.";
  const r = m.match(/"reason":"([^"]+)"/); if (r) return "Erro Meta: " + r[1].slice(0, 80);
  if (status === 400) return "Dados inválidos — confira os campos.";
  return fallback;
}

// Meta só aceita imagem JPEG/PNG. Foto de iPhone é HEIC → converte pra JPEG no
// navegador (canvas) antes de enviar. Se já for jpeg/png ou não for imagem, passa direto.
async function toSendableImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/jpeg" || file.type === "image/png") return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b as Blob), "image/jpeg", 0.9));
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { return file; }
}

export function CorretorChatV2() {
  const { convId } = useParams<{ convId?: string }>();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"atendendo" | "pendente">("atendendo");
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ win: boolean; chat: ChatMsg[]; phone?: string; lastInbound?: number } | null>(null);
  // Ajuda Comercial: estado do apoio do time Calebe NESTA conversa (tarja verde).
  const [csState, setCsState] = useState<{ active: boolean; status: string | null; atuando: boolean } | null>(null);
  const [csConfirm, setCsConfirm] = useState<Conv | null>(null); // modal de confirmação da ajuda comercial
  const [addOpen, setAddOpen] = useState(false);
  const [call, setCall] = useState<{ name: string; leadId?: string; convId?: string; status: "confirm" | "waiting_client" | "client_ready" | "calling" | "placed" | "error"; sentAt?: string; msg?: string } | null>(null);
  const [vendaCtx, setVendaCtx] = useState<Conv | null>(null);
  const [actionModal, setActionModal] = useState<{ type: "vincular" | "fechamento" | "descartar"; conv: Conv } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [imoveis, setImoveis] = useState<Imovel[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [toast, setToast] = useState<{ m: string; ok: boolean } | null>(null);
  const flash = (m: string, ok = true) => { setToast({ m, ok }); setTimeout(() => setToast(null), 4500); };
  const deepOpened = useRef(false);
  const me = useAuth((s) => s.user); // corretor logado (p/ preencher {{nome do corretor}} em templates)

  // --- ordenação estilo WhatsApp Web + não-lidas (sem reordenar à toa) ---
  const activeIdRef = useRef<string | null>(null);          // espelho de activeId p/ os polls
  const seenTsRef = useRef<Map<string, number>>(new Map()); // quando o corretor VIU cada conversa
  const bumpRef = useRef<Map<string, number>>(new Map());   // "iniciar atendimento" joga pro topo
  // Aplica estado local sobre a lista do backend, preservando ordem/não-lidas entre os polls:
  // - unread: zera se a conversa está ABERTA ou foi VISTA depois do último inbound do cliente.
  // - sortTs: atividade real (ts) OU bump local de aceite/envio (sobe só quando deve).
  function decorate(list: Conv[]): Conv[] {
    return list.map((c) => {
      const seen = seenTsRef.current.get(c.id) ?? 0;
      const isActive = c.id === activeIdRef.current;
      const unread = (isActive || (c.lastInbound || 0) <= seen) ? 0 : (c.unread || 0);
      const sortTs = Math.max(c.ts || 0, bumpRef.current.get(c.id) || 0);
      return { ...c, unread, sortTs };
    });
  }

  async function reload() {
    try {
      const list = await loadConversations();
      setConvs(decorate(list)); setErr(null);
    } catch (e: any) {
      setErr(errMsg(e, "Não consegui carregar as conversas. Tente recarregar."));
    } finally { setLoading(false); }
  }

  useEffect(() => {
    reload();
    loadImoveis().then(setImoveis).catch(() => {});
    loadTemplates().then((t) => setTemplates(t || [])).catch(() => {});
    return () => { document.body.classList.remove("cv2-viewing"); };
  }, []);

  // Tempo real (polling): lista 25s, conversa aberta 15s.
  // PAUSA quando a aba está em segundo plano (document.hidden) — aba minimizada
  // não precisa martelar o backend; corta a maior parte da carga inútil.
  useEffect(() => {
    const iv = setInterval(() => { if (document.hidden) return; loadConversations().then((l) => { setConvs(decorate(l)); setErr(null); setLoading(false); }).catch(() => {}); }, 25000);
    return () => clearInterval(iv);
  }, []);
  // Atualiza a lista IMEDIATAMENTE ao voltar pro primeiro plano (abrir/desminimizar o app).
  // Sem isso, o corretor reabre o app e vê a lista velha até o próximo poll (25s) →
  // sensação de "meu lead novo não aparece". Resolve a queixa nº1 do suporte.
  useEffect(() => {
    const onFocus = () => { if (document.hidden) return; loadConversations().then((l) => { setConvs(decorate(l)); setErr(null); setLoading(false); }).catch(() => {}); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => { document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); };
  }, []);
  useEffect(() => {
    if (!activeId) return;
    const iv = setInterval(() => {
      if (document.hidden) return;
      seenTsRef.current.set(activeId, Date.now()); // conversa aberta = continua "vista" (não acumula não-lidas)
      loadMessages(activeId).then((d) =>
        setDetail((cur) => (!cur || d.chat.length !== cur.chat.length || d.win !== cur.win || d.lastInbound !== cur.lastInbound) ? d : cur)
      ).catch(() => {});
      csActive(activeId).then(setCsState).catch(() => {});
    }, 12000);
    return () => clearInterval(iv);
  }, [activeId]);
  // Conversa ABERTA · recarrega NA HORA ao voltar pro primeiro plano. No celular o
  // corretor sai pro WhatsApp, lê a resposta do cliente e volta — sem isto a janela
  // (e o histórico) só atualizava no próximo tick de 12s, mantendo "exige template"
  // por segundos após o cliente já ter respondido. Espelha o refresh da lista (foco).
  useEffect(() => {
    if (!activeId) return;
    const onFocus = () => {
      if (document.hidden) return;
      loadMessages(activeId).then((d) =>
        setDetail((cur) => (!cur || d.chat.length !== cur.chat.length || d.win !== cur.win || d.lastInbound !== cur.lastInbound) ? d : cur)
      ).catch(() => {});
      csActive(activeId).then(setCsState).catch(() => {});
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => { document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); };
  }, [activeId]);

  // Deep-link: /corretor/chat/conv/:convId abre a conversa automaticamente.
  useEffect(() => {
    if (deepOpened.current || !convId || !convs.length) return;
    const c = convs.find((x) => x.id === convId);
    if (c) { deepOpened.current = true; openChat(c); }
  }, [convId, convs]);

  // Polling enquanto aguarda cliente confirmar a chamada:
  // a cada 6s carrega mensagens da conversa; se houver inbound após sentAt → cliente respondeu.
  useEffect(() => {
    if (call?.status !== "waiting_client" || !call.convId || !call.sentAt) return;
    const sentTs = new Date(call.sentAt).getTime();
    const iv = setInterval(async () => {
      try {
        const d = await loadMessages(call.convId!);
        const replied = (d.chat || []).some(
          (m: ChatMsg) => m.direction === "inbound" && new Date(m.ts || 0).getTime() > sentTs
        );
        if (replied) setCall((c) => c ? { ...c, status: "client_ready" } : c);
      } catch { /* ignora erros de poll */ }
    }, 6000);
    return () => clearInterval(iv);
  }, [call?.status, call?.convId, call?.sentAt]);

  const active = convs.find((c) => c.id === activeId) || null;
  // 2026-06-12 · Lead DESCARTADO (status LOST) sai das abas ativas. Antes ficava preso
  // em "Pendente" cinza com botão "Aceitar" — confundia o corretor (lead morto pedindo aceite).
  const inTab = (c: Conv) => c.st === "discarded" ? false : (tab === "atendendo" ? c.accepted : !c.accepted);
  const visible = useMemo(() =>
    convs.filter(inTab)
      .filter((c) => !q || c.n.toLowerCase().includes(q.toLowerCase()) || (c.phone || "").includes(q))
      .sort((a, b) => {
        // 2026-06-13 · fixadas sempre no topo (estilo WhatsApp); entre fixadas, a mais recente primeiro
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        if (a.pinned && b.pinned) return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
        return (b.sortTs ?? b.ts) - (a.sortTs ?? a.ts);
      }),
    [convs, tab, q]);
  const nPend = convs.filter((c) => !c.accepted && c.st !== "discarded").length;
  const nAtend = convs.filter((c) => c.accepted && c.st !== "discarded").length;

  async function openChat(c: Conv) {
    activeIdRef.current = c.id;
    seenTsRef.current.set(c.id, Date.now());     // marca como vista -> zera não-lidas
    setActiveId(c.id); setMenuOpen(false);
    document.body.classList.add("cv2-viewing");
    setConvs((cs) => cs.map((x) => x.id === c.id ? { ...x, unread: 0 } : x)); // zera não-lidas ao abrir
    setDetail({ win: c.win, chat: c.chat, lastInbound: c.lastInbound });
    setCsState(null); csActive(c.id).then(setCsState).catch(() => {});
    // Carrega o histórico COMPLETO. Se falhar (token/rede), tenta 1x de novo —
    // sem isso uma falha transitória deixava só a prévia de 1 msg ("perdi o
    // histórico, o cliente tem que reenviar tudo"). O poll/foco também recarrega.
    try { setDetail(await loadMessages(c.id)); }
    catch { try { setDetail(await loadMessages(c.id)); } catch { /* mantém prévia; poll/foco recarrega */ } }
  }
  // Corretor pede apoio comercial — valida a REGRA e abre a confirmação.
  function commercialHelp(c: Conv | null) {
    if (!c) return;
    setMenuOpen(false);
    if (csState?.active) { flash("Já existe uma solicitação de ajuda comercial em andamento neste lead.", false); return; }
    setCsConfirm(c); // abre o modal de confirmação (funcional p/ qualquer lead em atendimento)
  }
  // Envio real (após confirmar no modal).
  async function doCommercialHelp(c: Conv | null) {
    if (!c) return;
    setCsConfirm(null);
    try {
      const r: any = await csRequestHelp(c.id);
      setCsState({ active: true, status: "SOLICITADO", atuando: false });
      flash(r?.message || "Pronto! O time Calebe foi acionado e vai te apoiar nessa negociação.");
    } catch (e: any) {
      const em = String(e?.message || "").toLowerCase();
      if (e?.status === 409 || em.includes("already_active")) {
        setCsState({ active: true, status: "SOLICITADO", atuando: false });
        flash("Já existe uma solicitação de ajuda comercial em andamento neste lead.", false);
      } else if (e?.status === 422 || em.includes("no_conversation")) {
        flash("Esse lead ainda não tem conversa com o cliente — fale com ele antes de pedir ajuda.", false);
      } else flash(errMsg(e, "Falhou ao solicitar ajuda comercial"), false);
    }
  }
  function closeChat() { document.body.classList.remove("cv2-viewing"); activeIdRef.current = null; setActiveId(null); }

  async function aceitar(c: Conv) {
    bumpRef.current.set(c.id, Date.now());       // iniciar atendimento -> topo da aba Atendendo (não afunda)
    setConvs((cs) => cs.map((x) => x.id === c.id ? { ...x, accepted: true, sortTs: Date.now() } : x));
    setTab("atendendo"); openChat({ ...c, accepted: true });
    try { await acceptConv(c.id); flash("Lead aceito ✓"); reload(); }
    catch (e) { flash(errMsg(e, "Falhou ao aceitar o lead"), false); }
  }

  // 2026-06-13 · fixar/desafixar conversa no topo (estilo WhatsApp, máx 5). Otimista + reverte no erro.
  async function togglePin(c: Conv, e: any) {
    e.stopPropagation();
    const next = !c.pinned;
    setConvs((cs) => cs.map((x) => x.id === c.id ? { ...x, pinned: next, pinnedAt: next ? Date.now() : undefined } : x));
    try { await pinConv(c.id, next); flash(next ? "Conversa fixada 📌" : "Conversa desafixada"); }
    catch (err) {
      setConvs((cs) => cs.map((x) => x.id === c.id ? { ...x, pinned: c.pinned, pinnedAt: c.pinnedAt } : x));
      flash(errMsg(err, "Não consegui fixar a conversa"), false);
    }
  }
  async function setStage(c: Conv, st: string) {
    setConvs((cs) => cs.map((x) => x.id === c.id ? { ...x, stage: st } : x));
    if (c.leadId) { try { await setStageApi(c.leadId, st); flash(`Estágio: ${st}`); } catch (e) { flash(errMsg(e, "Falhou ao salvar estágio"), false); } }
  }
  async function doSend(text: string) {
    if (!active) return;
    bumpRef.current.set(active.id, Date.now()); // conversa em atendimento permanece no topo
    setDetail((d) => ({ win: d?.win ?? true, phone: d?.phone, lastInbound: d?.lastInbound, chat: [...(d?.chat || []), ["out", text, "agora", "sent"]] }));
    try { await sendText(active.id, text); } catch (e) { flash(errMsg(e, "Falhou ao enviar"), false); }
  }
  async function doAudio(blob: Blob | null, errText?: string) {
    if (errText) { flash(errText, false); return; }
    if (!active || !blob) return;
    bumpRef.current.set(active.id, Date.now());
    setDetail((d) => ({ win: d?.win ?? true, phone: d?.phone, lastInbound: d?.lastInbound, chat: [...(d?.chat || []), ["audio", "", "agora", "sent", "", "out"]] }));
    try { await sendAudio(active.id, blob); flash("Áudio enviado 🎤"); } catch (e) { flash(errMsg(e, "Falhou ao enviar áudio"), false); }
  }
  async function doMedia(fileIn: File) {
    if (!active || !fileIn) return;
    bumpRef.current.set(active.id, Date.now());
    const file = await toSendableImage(fileIn);
    const kind = mediaKind(file);
    const localUrl = URL.createObjectURL(file);
    setDetail((d) => ({ win: d?.win ?? true, phone: d?.phone, lastInbound: d?.lastInbound, chat: [...(d?.chat || []), [kind, file.name, "agora", "sent", localUrl, "out"]] }));
    try { await sendFile(active.id, file); flash(kind === "image" ? "Imagem enviada ✓" : kind === "video" ? "Vídeo enviado ✓" : "Arquivo enviado ✓"); }
    catch (e) { flash(errMsg(e, "Falhou ao enviar arquivo"), false); }
  }
  async function doTemplate(t: Template) {
    if (!active) return;
    // mesma lógica de params do preview (envio 100% fiel ao que o corretor viu)
    const bodyParams = templateParams(t, active.n, me?.name);
    try { await sendTemplate(active.id, t.name, t.language, bodyParams); flash(`Template enviado: ${t.name}`); }
    catch (e) {
      flash(errMsg(e, "Falhou ao enviar template"), false);
      // Template bloqueado = lista velha em cache. Limpa e recarrega a lista atual na hora.
      const em = (String((e as any)?.message || "") + JSON.stringify((e as any)?.data ?? "")).toLowerCase();
      if (em.includes("template_bloqueado")) {
        try { localStorage.removeItem("CALEBE_TPL_CACHE_V2"); } catch { /* */ }
        loadTemplates().then((t2) => setTemplates(t2 || [])).catch(() => {});
      }
    }
  }
  async function doCreateLead(data: any) {
    try { await createLead(data); flash("Lead criado ✓"); setAddOpen(false); reload(); }
    catch (e) { flash(errMsg(e, "Falhou ao criar lead"), false); }
  }
  // 1º passo: só ABRE a confirmação. Nada é enviado/ligado até o corretor confirmar.
  function doCall(c: Conv) {
    if (!c?.leadId) { flash("Lead sem vínculo para ligar.", false); return; }
    setCall({ name: c.n, leadId: c.leadId, convId: c.id, status: "confirm" });
  }
  // 2º passo: envia template de aviso e aguarda cliente confirmar.
  async function confirmCall() {
    const c = call; if (!c?.leadId) return;
    setCall({ ...c, status: "calling" });
    try {
      const r: any = await voiceCall(c.leadId);
      if (r?.status === "pending_confirm") {
        setCall({ ...c, status: "waiting_client", sentAt: r.sentAt });
      } else {
        setCall({ ...c, status: "placed" });
      }
    } catch (e: any) {
      const m = (String(e?.message || "") + " " + JSON.stringify(e?.data ?? "")).toLowerCase();
      let msg = "Não consegui iniciar a chamada. Tente de novo.";
      if (m.includes("twilio_not_configured")) msg = "Telefonia não configurada — avise o suporte.";
      else if (m.includes("no_corretor_phone")) msg = "Você não tem telefone no seu perfil. Cadastre em Meu Perfil para poder ligar.";
      else if (m.includes("not_lead_owner")) msg = "Esse lead não está na sua carteira.";
      else if (m.includes("phone_decrypt") || m.includes("no_phone")) msg = "Lead sem telefone válido.";
      setCall({ ...c, status: "error", msg });
    }
  }
  // 3º passo: coloca a chamada Twilio após cliente confirmar (ou corretor forçar).
  async function placeCall() {
    const c = call; if (!c?.leadId) return;
    setCall({ ...c, status: "calling" });
    try {
      await voiceCallConfirm(c.leadId);
      setCall({ ...c, status: "placed" });
    } catch (e: any) {
      const m = (String(e?.message || "") + " " + JSON.stringify(e?.data ?? "")).toLowerCase();
      let msg = "Não consegui iniciar a chamada. Tente de novo.";
      if (m.includes("twilio_not_configured")) msg = "Telefonia não configurada — avise o suporte.";
      else if (m.includes("no_corretor_phone")) msg = "Você não tem telefone no seu perfil. Cadastre em Meu Perfil para poder ligar.";
      else if (m.includes("not_lead_owner")) msg = "Esse lead não está na sua carteira.";
      setCall({ ...c, status: "error", msg });
    }
  }
  // ===== Ações do menu ⋮ — abrem o PROCESSO CERTO (modais reais) =====
  function doSale(c: Conv) { setMenuOpen(false); setVendaCtx(c); }                              // formulário de venda real
  function doLink(c: Conv) { setMenuOpen(false); setActionModal({ type: "vincular", conv: c }); }   // picker de imóvel
  function doRequestClose(c: Conv) { setMenuOpen(false); setActionModal({ type: "fechamento", conv: c }); } // libera telefone
  function doDiscard(c: Conv) { setMenuOpen(false); setActionModal({ type: "descartar", conv: c }); }  // motivo → Perdido

  return (
    <div className="cv2">
      <div className="app">
        {toast && <div style={{
          position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 99,
          background: toast.ok ? "var(--green)" : "var(--red)", color: toast.ok ? "#04101F" : "#fff",
          padding: "10px 18px", borderRadius: 12, fontWeight: 700, fontSize: 13.5, boxShadow: "0 8px 30px rgba(0,0,0,.5)",
        }}>{toast.m}</div>}

        <aside className="list">
          <div className="list-head">
            <div className="brand">
              <div className="av" style={{ width: 34, height: 34, fontSize: 15 }}>C</div>
              <div><b>Chat com leads</b><br /><span>{loading ? "carregando…" : `${convs.length} conversas`}</span></div>
            </div>
            <div className="search">
              <Ico d="M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" />
              <input placeholder="Buscar por nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="tabs">
            <button className={"tab" + (tab === "atendendo" ? " on" : "")} onClick={() => setTab("atendendo")}>Atendendo <span className="n">{nAtend}</span></button>
            <button className={"tab pend" + (tab === "pendente" ? " on" : "")} onClick={() => setTab("pendente")}>Pendente <span className="n">{nPend}</span></button>
          </div>
          {err && <div className="err-bar"><span>{err}</span><button onClick={() => window.location.reload()}>Recarregar</button></div>}
          <div className="scroll">
            {!loading && visible.length === 0 && <div style={{ padding: 34, textAlign: "center", color: "var(--muted)" }}>Nada em <b>{tab}</b> 🎉</div>}
            {visible.map((c, idx) => {
              const s = STATUS[c.st] || STATUS.new;
              // 2026-06-09 · badge de risco de redistribuição
              // Aviso quando: nunca contatado + assignedAt há mais de 18h (75% de 24h)
              const MAX_REDIST = 3;
              const INACTIVITY_MS = 24 * 60 * 60 * 1000; // 24h (padrão do sistema)
              const WARN_THRESHOLD_MS = INACTIVITY_MS * 0.75; // aviso ao atingir 75% (6h restantes)
              const redistRisk = !c.firstContactAt
                && c.assignedAt
                && (c.redistributionCount ?? 0) < MAX_REDIST
                && c.st !== "discarded"
                && (Date.now() - c.assignedAt) >= WARN_THRESHOLD_MS;
              const hoursLeft = redistRisk && c.assignedAt
                ? Math.max(0, Math.ceil((INACTIVITY_MS - (Date.now() - c.assignedAt)) / 3600000))
                : null;
              const showPinSep = !c.pinned && idx > 0 && visible[idx - 1] && visible[idx - 1].pinned;
              return (
                <Fragment key={c.id}>
                {showPinSep && (
                  <div style={{ padding: "5px 16px", fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--muted)", borderBottom: "1px solid #0c2438", background: "rgba(255,255,255,.015)" }}>Demais conversas</div>
                )}
                <div className={"item" + (c.st === "discarded" ? " disc" : "") + (activeId === c.id ? " active" : "") + (redistRisk ? " redist-risk" : "")} onClick={() => openChat(c)}>
                  <span className={"strip bg-" + (redistRisk ? "red" : s.cls)} />
                  <div className="av" translate="no">{initials(c.n)}<span className="wa">🟢</span></div>
                  <div className="it-body">
                    <div className="it-top"><span className="it-name">{c.pinned ? "📌 " : ""}{c.n}</span><button type="button" title={c.pinned ? "Desafixar" : "Fixar no topo"} onClick={(e) => togglePin(c, e)} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", fontSize: 13, lineHeight: 1, opacity: c.pinned ? 1 : 0.32, filter: c.pinned ? "none" : "grayscale(1)", flex: "none" }}>📌</button><span className={"it-time" + (c.unread ? " green" : "")}>{c.t}</span></div>
                    <div className="it-prev"><span className={"it-msg" + (c.unread ? " unread" : "")}>{c.last}</span>{c.unread ? <span className="unreadn">{c.unread}</span> : null}</div>
                    <div className="it-meta"><span className="tag">{c.org}</span><span className={"st c-" + s.cls}><i className={"dot bg-" + s.cls} />{s.label}</span><span className="msgs">· {c.msgs} msg</span>{c.phone ? <span className="msgs">· 📞 {c.phone}</span> : null}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <WindowBadge open={c.win} ms={c.lastInbound} />
                      {redistRisk && (
                        <span title="Esse lead será redistribuído para outro corretor se não for respondido"
                          style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 700,
                            color: hoursLeft === 0 ? "#ff4444" : "#f97316",
                            background: hoursLeft === 0 ? "rgba(255,68,68,.14)" : "rgba(249,115,22,.14)",
                            border: `1px solid ${hoursLeft === 0 ? "rgba(255,68,68,.4)" : "rgba(249,115,22,.4)"}`,
                            borderRadius: 5, padding: "2px 6px", whiteSpace: "nowrap" }}>
                          ⚠ {hoursLeft !== null && hoursLeft > 0 ? `redistribui em ${hoursLeft}h` : "redistribui em breve!"}
                        </span>
                      )}
                    </div>
                  </div>
                  {!c.accepted && <button className="it-accept" onClick={(e) => { e.stopPropagation(); aceitar(c); }}><Ico d="M20 6L9 17l-5-5" sw={3} />Aceitar</button>}
                </div>
                </Fragment>
              );
            })}
          </div>
          <button className="addbtn" onClick={() => setAddOpen(true)}><Ico d="M12 5v14M5 12h14" sw={2.4} />Adicionar lead manual</button>
        </aside>

        <main className="chat">
          {!active && <div className="empty"><div><div className="big">💬</div>Selecione uma conversa para atender</div></div>}
          {active && <ChatView c={active} detail={detail} menuOpen={menuOpen} setMenuOpen={setMenuOpen} imoveis={imoveis} templates={templates} meName={me?.name}
            onBack={closeChat} onAccept={() => aceitar(active)} onStage={(st) => setStage(active, st)} onSend={doSend} onTemplate={doTemplate} onAudio={doAudio} onMedia={doMedia} onCall={() => doCall(active)}
            onDiscard={() => doDiscard(active)} onSale={() => doSale(active)} onLink={() => doLink(active)} onRequestClose={() => doRequestClose(active)} flash={flash}
            csState={csState} onCommercialHelp={() => commercialHelp(active)} />}
        </main>

        {addOpen && <AddLeadModal onClose={() => setAddOpen(false)} onSubmit={doCreateLead} />}
        {call && <CallModal call={call} onConfirm={confirmCall} onPlace={placeCall} onClose={() => setCall(null)} />}
        <NovaVendaModal open={!!vendaCtx} onClose={() => setVendaCtx(null)}
          onSaved={() => { setVendaCtx(null); flash("Venda registrada ✓"); reload(); }}
          prefillClientName={vendaCtx?.n} />
        {actionModal && <ActionModal type={actionModal.type} conv={actionModal.conv} imoveis={imoveis}
          flash={flash} reload={reload} onClose={() => setActionModal(null)} />}
        {csConfirm && <CommercialHelpModal name={csConfirm.n} onConfirm={() => doCommercialHelp(csConfirm)} onClose={() => setCsConfirm(null)} />}
      </div>
    </div>
  );
}

// Confirmação de Ajuda Comercial · texto aprovado pelo Elison (2026-06-18).
function CommercialHelpModal({ name, onConfirm, onClose }: any) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#0e2238", border: "1px solid #1c344f", borderRadius: 14, maxWidth: 430, width: "100%", padding: "22px 22px 18px", color: "#e8eef5", boxShadow: "0 24px 60px rgba(0,0,0,.55)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 26 }}>🤝</span>
          <div style={{ fontSize: 16.5, fontWeight: 800 }}>Compartilhar com o time comercial Calebe</div>
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: "#c7d6e6", margin: 0 }}>
          Essa conversa será <b style={{ color: "#fff" }}>compartilhada com o time da Calebe</b> e eles vão te ajudar a negociar com <b style={{ color: "#fff" }}>{name || "esse cliente"}</b>! Fique atento — eles podem te chamar no seu <b style={{ color: "#25D366" }}>WhatsApp</b> para tirar dúvidas.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid #2a4763", color: "#c7d6e6", fontWeight: 700, fontSize: 13.5, padding: "9px 16px", borderRadius: 9, cursor: "pointer" }}>Cancelar</button>
          <button onClick={onConfirm} style={{ background: "#DEB96D", color: "#04101F", border: "none", fontWeight: 800, fontSize: 13.5, padding: "9px 18px", borderRadius: 9, cursor: "pointer" }}>Compartilhar com o time</button>
        </div>
      </div>
    </div>
  );
}

function ChatView({ c, detail, menuOpen, setMenuOpen, imoveis, templates, meName, onBack, onAccept, onStage, onSend, onTemplate, onAudio, onMedia, onCall, onDiscard, onSale, onLink, onRequestClose, csState, onCommercialHelp }: any) {
  const s = STATUS[c.st] || STATUS.new;
  const chat: ChatMsg[] = detail?.chat || c.chat || [];
  // JANELA 24h · à prova de estado velho. O bug nº1 do suporte ("cliente já
  // respondeu mas o sistema ainda exige template") vinha de um `detail.win=false`
  // velho (carregado ao abrir / fetch que falhou) SOBREPONDO o sinal fresco da
  // lista (c.win, atualizado a cada 25s + no foco a partir do lastInboundAt real).
  // Agora recalculamos AO VIVO do inbound mais recente que conhecemos e abrimos
  // se QUALQUER fonte indicar janela aberta — nunca travamos quem já respondeu.
  // (re-render a cada 1s pelo `tick`, então flipa sozinho assim que chega inbound).
  const liMs = Math.max(detail?.lastInbound || 0, c.lastInbound || 0);
  const win = (liMs > 0 && Date.now() - liMs < 86400000) || !!detail?.win || !!c.win;
  const phone = detail?.phone || c.phone || "";
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = wrapRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chat.length]);
  // Ações rápidas recolhíveis — o corretor pode fechar a barra pra ganhar tela.
  // Escolha persiste (localStorage) e vale pra todas as conversas.
  const [quickOpen, setQuickOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("cv2-quick-open") !== "0"; } catch { return true; }
  });
  const toggleQuick = () => setQuickOpen((v) => {
    const n = !v;
    try { localStorage.setItem("cv2-quick-open", n ? "1" : "0"); } catch { /* ignora */ }
    return n;
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="chat-head">
        {/* Row 1: back + avatar + nome/status + menu ⋮ */}
        <div className="ch-row">
          <button className="back" onClick={onBack} aria-label="Voltar"><Ico d="M15 18l-6-6 6-6" /></button>
          <div className="av" translate="no">{initials(c.n)}</div>
          <div className="ch-info">
            <div className="ch-name">
              <span className="ch-name-txt">{c.n}</span>
              <span className={"st c-" + s.cls}><i className={"dot bg-" + s.cls} />{s.label}</span>
            </div>
            <div className="ch-sub">
              <span className="ch-org"><Smartphone size={12} /> {c.org}</span>
              <span>·</span>
              <span>{c.msgs} msg{c.msgs === 1 ? "" : "s"}</span>
            </div>
          </div>
          {(c.accepted || phone) && (
            <div className="menu">
              <button className="btn-ico" onClick={() => setMenuOpen(!menuOpen)} aria-label="Ações"><MoreVertical size={18} /></button>
              {menuOpen && (
                <div className="menu-pop">
                  {phone ? (
                    <a href={waLink(phone)} target="_blank" rel="noreferrer" className="wa" onClick={() => setMenuOpen(false)}>
                      <MessageCircle size={16} /> Falar no WhatsApp
                    </a>
                  ) : null}
                  {c.accepted && (c.leadId ? (
                    <button onClick={() => { setMenuOpen(false); onCall(); }}><Phone size={16} /> Ligar (pela Calebe)</button>
                  ) : (
                    <button disabled title="Sem lead vinculado"><Phone size={16} /> Ligar (sem lead)</button>
                  ))}
                  {c.accepted && <hr />}
                  {c.accepted && <button className="danger" onClick={onDiscard}><Trash2 size={16} /> Descartar lead</button>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Row 2: badge de janela WhatsApp (24h Meta) + toggle das ações rápidas */}
        {c.accepted && (
          <div className="ch-window-row">
            <WindowBadge open={win} ms={c.lastInbound} big />
            <button
              className="quick-toggle"
              onClick={toggleQuick}
              aria-expanded={quickOpen}
              aria-label={quickOpen ? "Recolher ações rápidas" : "Mostrar ações rápidas"}
              title={quickOpen ? "Recolher ações rápidas" : "Mostrar ações rápidas"}
            >
              <span className="quick-toggle-lbl">{quickOpen ? "Recolher" : "Ações"}</span>
              {quickOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        )}

        {/* Row 3: ações rápidas — ícones grandes, label embaixo, sem emoji (recolhível) */}
        {c.accepted && quickOpen && (
          <div className="ch-quick">
            <button
              className="quick-btn"
              onClick={() => { setMenuOpen(false); window.location.href = "/corretor/suporte"; }}
              title="Ajuda técnica (suporte)"
              aria-label="Suporte técnico"
            >
              <span className="quick-ico" data-tone="blue"><Headphones size={18} /></span>
              <span className="quick-lbl">Suporte</span>
            </button>
            <button
              className="quick-btn"
              onClick={onCommercialHelp}
              disabled={!!csState?.active}
              title={csState?.active ? "Ajuda comercial já solicitada — o time Calebe foi acionado" : "Pedir apoio do time comercial Calebe"}
              aria-label="Ajuda comercial"
            >
              <span className="quick-ico" data-tone={csState?.active ? "green" : "gold"}><Handshake size={18} /></span>
              <span className="quick-lbl">{csState?.active ? "Solicitada" : "Comercial"}</span>
            </button>
            <button className="quick-btn" onClick={onRequestClose} title="Solicitar fechamento" aria-label="Solicitar fechamento">
              <span className="quick-ico"><BadgeCheck size={18} /></span>
              <span className="quick-lbl">Fechar</span>
            </button>
            <button className="quick-btn" onClick={onLink} title="Vincular imóvel" aria-label="Vincular imóvel">
              <span className="quick-ico"><Home size={18} /></span>
              <span className="quick-lbl">Imóvel</span>
            </button>
            <button className="quick-btn" onClick={onSale} title="Registrar venda" aria-label="Registrar venda">
              <span className="quick-ico"><DollarSign size={18} /></span>
              <span className="quick-lbl">Venda</span>
            </button>
          </div>
        )}

        {/* Row 4: estágios (scroll horizontal em mobile) */}
        {c.accepted && (
          <div className="stages">
            <span className="lbl">Estágio</span>
            {STAGES.map((st) => (
              <button key={st} className={"stage" + (c.stage === st ? " on" : "")} onClick={() => onStage(st)}>{st}</button>
            ))}
          </div>
        )}
      </div>
      {csState?.active && (
        <div style={{ background: csState.atuando ? "#dcfce7" : "#fef9c3", borderBottom: `2px solid ${csState.atuando ? "#16a34a" : "#ca8a04"}`, color: csState.atuando ? "#14532d" : "#854d0e", padding: "9px 16px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 17 }}>🤝</span>
          {csState.atuando
            ? "Time Calebe está apoiando esta negociação com você."
            : "Ajuda comercial solicitada — o time Calebe vai analisar e te apoiar no fechamento."}
        </div>
      )}
      <div className="msgs-wrap" ref={wrapRef}>
        <div className="daysep">Hoje</div>
        {chat.map((m, i) => {
          const [type, a, b, stt, fileUrl, dir] = m as any;
          if (type === "sys") return <div key={i} className="sysline">— {a} —</div>;
          const isMedia = type === "audio" || type === "image" || type === "video" || type === "document";
          const side = isMedia ? (dir === "out" ? "out" : "in") : type;
          const url = fileUrl ? resolveBackendUrl(fileUrl) : "";
          let tick: any = null;
          if (side === "out") {
            // 2026-06-10 · Corretor reclamou "Mensagem aparece como não entregue,
            // e cliente respondeu!". Se há QUALQUER inbound depois dessa msg, o
            // status `failed` é stale (Meta entregou mas webhook se perdeu — comum
            // em downtime). Suprime o "✗ não entregue" e mostra ✓✓ normal.
            const hasLaterInbound = (chat as any[]).slice(i + 1)
              .some((later: any) => (later[0] === "in" || later[5] === "in"));
            if (stt === "failed" && !hasLaterInbound) tick = <span title="Meta reportou falha na entrega desta mensagem (throttle ou restrição temporária). Se o cliente respondeu depois, a janela de 24h está aberta normalmente — você pode enviar mensagens livres." style={{ color: "#E8836B", fontWeight: 700 }}> ✗ não entregue</span>;
            else if (stt === "read") tick = <span style={{ color: "#53d36a" }}> ✓✓</span>;
            else if (stt === "delivered" || (stt === "failed" && hasLaterInbound)) tick = <span className="ck"> ✓✓</span>;
            else tick = <span style={{ color: "var(--muted)" }}> ✓</span>;
          }
          return (
            <div key={i} className={"bub " + side + (isMedia ? " media" : "")}>
              {type === "audio" && (url
                ? <audio controls preload="metadata" style={{ width: 250, maxWidth: "100%", height: 38, display: "block" }}>
                    {audioSources(url).map((s) => <source key={s.src} src={s.src} type={s.type} />)}
                    Seu navegador não suporta este áudio.
                  </audio>
                : <span>🎤 Áudio enviado…</span>)}
              {type === "image" && <img src={url} alt="" loading="lazy" onClick={() => url && window.open(url, "_blank")} style={{ maxWidth: "100%", maxHeight: 240, borderRadius: 8, cursor: "pointer", display: "block" }} />}
              {type === "video" && <video src={url} controls playsInline preload="none" style={{ maxWidth: "100%", maxHeight: 260, borderRadius: 8, display: "block" }} />}
              {type === "document" && <DocCard url={url} name={a} />}
              {!isMedia && a}
              <span className="t">{b}{tick}</span>
            </div>
          );
        })}
      </div>
      {!c.accepted ? <AcceptBar onAccept={onAccept} /> : (win ? <ComposerOpen name={c.n} imoveis={imoveis} onSend={onSend} onAudio={onAudio} onMedia={onMedia} /> : <ComposerClosed templates={templates} onTemplate={onTemplate} leadName={c.n} meName={meName} />)}
    </div>
  );
}

function DocCard({ url, name }: any) {
  const fname = (name || (url || "").split("/").pop() || "Documento").split("?")[0];
  const ext = (fname.split(".").pop() || "DOC").toUpperCase().slice(0, 4);
  return (
    <a href={url} target="_blank" rel="noreferrer" className="doccard" title={fname}>
      <span className="docicon">{ext}</span>
      <span className="docinfo"><b className="docname">{fname}</b><span className="docmeta">Documento · toque para abrir</span></span>
      <span className="docdl"><Ico d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" sw={2} /></span>
    </a>
  );
}

function AcceptBar({ onAccept }: any) {
  return <div className="composer"><div className="wbanner" style={{ borderColor: "rgba(74,163,255,.4)", background: "rgba(74,163,255,.08)" }}>
    <div className="ic" style={{ background: "rgba(74,163,255,.18)", color: "var(--blue)" }}><Ico d="M11 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" /></div>
    <div className="tx"><b style={{ color: "var(--blue)" }}>Lead novo · aceite para responder</b><p>Toque em <b>Aceitar</b> para abrir o atendimento e liberar o envio de mensagens, áudio e anexos.</p></div>
    {onAccept && <button className="btn btn-gold" onClick={onAccept} style={{ flex: "none", alignSelf: "center" }}><Ico d="M20 6L9 17l-5-5" sw={3} />Aceitar lead</button>}
  </div></div>;
}

// Selo da JANELA DE 24h da Meta · verde delicado + contagem regressiva ao vivo.
// Regra Meta: a janela abre/zera a cada mensagem do CLIENTE (inbound) e dura 24h.
//   • dentro da janela → pode mandar mensagem livre (Liberado)
//   • fora (>24h sem inbound) → só template (Janela fechada)
//   • cliente responde de novo → reabre +24h (recalcula de lastInbound automaticamente)
// Reflete c.win (fonte do backend) e conta a partir de lastInbound+24h.
function WindowBadge({ open, ms, big }: { open?: boolean; ms?: number; big?: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => { const iv = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(iv); }, []);
  const cls = "winbadge" + (big ? " big" : "");
  if (!ms) return <span className={cls + " none"}>Sem resposta · envie um template pra iniciar</span>;
  if (!open) return <span className={cls + " closed"}>Janela 24h fechada · envie um template</span>;
  const rem = Math.max(0, ms + 86400000 - Date.now());
  const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000), s = Math.floor((rem % 60000) / 1000);
  const txt = h > 0 ? `${h}h ${String(m).padStart(2, "0")}min` : `${m}:${String(s).padStart(2, "0")}`;
  return <span className={cls + " open"}>Liberado · fecha em {txt}</span>;
}

// 2026-06-11 · Respostas rápidas (texto livre, dentro da janela 24h) — pedido admin.
const QUICK_REPLIES = [
  "Tudo bem meu amigo, vamos negociar???",
  "Tudo bem! Vamos negociar seu novo apartamento na praia???",
  "Já comprou seu ap na praia?? Que horas posso te ligar?",
  "Boaaa tardeee!!!",
  "BOM diaaaaa!!",
  "Me fala qual valor você quer investir!!",
  "Não quero ficar perturbando você! Me diz uma coisa: você tem real interesse em investir em imóveis na praia?",
  "Vou te ligar às 19 horas, ok?",
  "Vamos negociar, agora é a hora!!!",
];

function ComposerOpen({ name, imoveis, onSend, onAudio, onMedia }: any) {
  const [val, setVal] = useState("");
  const [recSecs, setRecSecs] = useState(-1);
  const recRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const open = val.startsWith("/");
  const f = imoveis.filter((im: Imovel) => im.n.toLowerCase().includes(val.slice(1).toLowerCase()) || (im.loc || "").toLowerCase().includes(val.slice(1).toLowerCase()));
  const send = () => { const t = val.trim(); if (!t) return; onSend(t); setVal(""); };
  async function toggleRec() {
    if (recRef.current) { try { recRef.current.recorder.stop(); } catch { /* */ } return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { onAudio(null, "Seu navegador não suporta gravar áudio."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      // iOS Safari: precisa de mimeType suportado + start(timeslice) senao nao captura dados.
      let mime = "";
      for (const m of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]) {
        try { if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) { mime = m; break; } } catch { /* */ }
      }
      const recOpts: MediaRecorderOptions = { audioBitsPerSecond: 24000 };
      if (mime) recOpts.mimeType = mime;
      const recorder = new MediaRecorder(stream, recOpts);
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        clearInterval(recRef.current?.iv);
        stream.getTracks().forEach((t) => t.stop());
        recRef.current = null; setRecSecs(-1);
        const blob = new Blob(chunks, { type: mime || (chunks[0] as Blob)?.type || "audio/webm" });
        if (blob.size > 200) onAudio(blob);
        else onAudio(null, "Nao consegui capturar o audio. Segure 1-2s e tente de novo.");
      };
      const t0 = Date.now();
      const iv = setInterval(() => {
        const sec = Math.floor((Date.now() - t0) / 1000);
        setRecSecs(sec);
        if (sec >= 300) { try { recRef.current?.recorder.stop(); } catch { /* */ } }
      }, 300);
      recRef.current = { recorder, iv };
      setRecSecs(0);
      recorder.start(250);
    } catch { onAudio(null, "Permita o microfone do navegador pra gravar áudio."); }
  }
  function cancelRec() {
    if (!recRef.current) return;
    const r = recRef.current; clearInterval(r.iv);
    try { r.recorder.onstop = () => { r.recorder.stream?.getTracks?.().forEach((t: any) => t.stop()); }; r.recorder.stop(); } catch { /* */ }
    recRef.current = null; setRecSecs(-1);
  }
  const recording = recSecs >= 0;
  const mmss = `${Math.floor(recSecs / 60)}:${String(Math.max(recSecs, 0) % 60).padStart(2, "0")}`;
  return (
    <div className="composer">
      {!open && !recording && val.trim() === "" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", padding: "6px 8px 2px", overflowX: "auto", minWidth: 0, maxWidth: "100%" }}>
          {QUICK_REPLIES.map((q, i) => (
            <button key={i} type="button" onClick={() => setVal(q)} title={q}
              style={{ flex: "0 0 auto", background: "#13233b", color: "#cfe0f5", border: "1px solid #2a4a6a", borderRadius: 14, padding: "5px 10px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
              {q.length > 26 ? q.slice(0, 25) + "\u2026" : q}
            </button>
          ))}
        </div>
      )}
      {open && !recording && <div className="picker">
        <div className="ph">🏠 Imóveis disponíveis <span className="esc">digite p/ filtrar · Esc fecha</span></div>
        <div className="pl">{f.map((im: Imovel, k: number) => (
          <div key={k} className="pitem" onClick={() => setVal(`🏠 *${im.n}* — ${im.loc}\n💰 ${im.price}\n🔗 https://app.calebe.tech/imovel/${im.code}`)}>
            <div className="pic">{im.ic || "🏠"}</div><div className="pinfo"><b>{im.n}</b><span>{im.loc}</span></div><div className="pprice">{im.price}</div></div>
        ))}{f.length === 0 && <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>Nenhum imóvel</div>}</div>
      </div>}
      <div className="cbox">
        {recording ? (<>
          <span title="Cancelar" className="cico" style={{ cursor: "pointer", color: "var(--red)" }} onClick={cancelRec}><Ico d="M18 6L6 18M6 6l12 12" /></span>
          <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 9, color: "#E8836B", fontWeight: 700, fontSize: 14.5, padding: "0 6px" }}>
            <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#E8836B", display: "inline-block" }} /> Gravando… {mmss}
          </span>
          <button className="cic" title="Parar e enviar" onClick={toggleRec}><Ico d="M22 2L11 13M22 2l-7 20-4-9-9-4z" sw={2.2} /></button>
        </>) : (<>
          <span className="cico" onClick={() => fileRef.current?.click()} title="Anexar foto, vídeo ou documento" style={{ cursor: "pointer" }}><Ico d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></span>
          <input ref={fileRef} type="file" accept="image/*,video/mp4,video/3gpp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onMedia(f); e.currentTarget.value = ""; }} />
          <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setVal(""); if (e.key === "Enter" && !open) send(); }} placeholder={`Mensagem para ${name}…  (digite / para imóveis)`} />
          {val.trim()
            ? <button className="cic" onClick={send} title="Enviar"><Ico d="M22 2L11 13M22 2l-7 20-4-9-9-4z" sw={2.2} /></button>
            : <span className="cico" onClick={toggleRec} title="Gravar áudio" style={{ cursor: "pointer", color: "var(--gold)" }}><Ico d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3" /></span>}
        </>)}
      </div>
      <div className="hint">{recording ? "🎤 Gravando… toque no avião pra enviar, ou no X pra cancelar." : <>💡 <b>/</b> imóveis · <b>Enter</b> envia · 🎤 áudio · 📎 anexa foto/vídeo/PDF</>}</div>
    </div>
  );
}

// --- Render estilo WhatsApp: quebras de linha + *negrito* _itálico_ ~tachado~ ---
function parseInline(s: string): any {
  const out: any[] = []; let last = 0, key = 0; const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0], inner = tok.slice(1, -1);
    if (tok[0] === "*") out.push(<strong key={key++}>{inner}</strong>);
    else if (tok[0] === "_") out.push(<em key={key++}>{inner}</em>);
    else out.push(<s key={key++}>{inner}</s>);
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
function renderWa(text: string): any {
  return String(text || "").split("\n").map((line, i) => <span key={i}>{i > 0 && <br />}{parseInline(line)}</span>);
}

// Preview FIEL ao WhatsApp do cliente: cabeçalho da empresa + bolha de entrada, variáveis
// já substituídas por dados reais, emojis, quebras, *negrito*, botões e mídia. Confirma antes de enviar.
function TemplatePreview({ t, leadName, meName, onSend, onClose }: any) {
  const g = genderFromName(leadName);
  const params = templateParams(t, leadName, meName);
  let body = t.body || "";
  params.forEach((p: string, i: number) => { body = body.split(`{{${i + 1}}}`).join(p); });
  const hf = (t.headerFormat || "TEXT").toUpperCase();
  const gLabel = g === "f" ? "feminino" : g === "m" ? "masculino" : "neutro";
  const leadFirst = (leadName || "").trim().split(/\s+/)[0] || "cliente";
  const now = new Date().toTimeString().slice(0, 5);
  return (
    <div className="modal" onClick={(e: any) => { if (e.target.classList.contains("modal")) onClose(); }}>
      <div className="wa-card">
        <div className="wa-top"><b>Prévia — como {leadFirst} vê no WhatsApp</b><button className="x" onClick={onClose}>✕</button></div>
        <div className="wa-phone">
          <div className="wa-head">
            <span className="wa-back">‹</span>
            <span className="wa-av">C</span>
            <div className="wa-id"><b>Calebe Investimentos</b><span>conta comercial</span></div>
          </div>
          <div className="wa-screen">
            <div className="wa-bubble">
              {hf === "IMAGE" && <div className="wa-media">🖼️ Imagem</div>}
              {hf === "VIDEO" && <div className="wa-media">🎬 Vídeo</div>}
              {hf === "DOCUMENT" && <div className="wa-media">📄 Documento</div>}
              {hf === "TEXT" && t.headerText ? <div className="wa-htext">{renderWa(t.headerText)}</div> : null}
              <div className="wa-text">{renderWa(body)}</div>
              <span className="wa-time">{now} ✓✓</span>
            </div>
            {t.buttons && t.buttons.length > 0 && (
              <div className="wa-btns">
                {t.buttons.map((b: TmplBtn, k: number) => (
                  <div key={k} className="wa-btn">{b.type === "URL" ? "🔗 " : b.type === "PHONE_NUMBER" ? "📞 " : "↩︎ "}{b.text}</div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="wa-foot">
          <div className="wa-meta">✓ Variáveis preenchidas com dados reais · gênero detectado pelo nome: <b>{gLabel}</b></div>
          <div className="wa-actions">
            <button className="btn btn-ghost" onClick={onClose}>Voltar</button>
            <button className="btn btn-gold" onClick={onSend}>Enviar para {leadFirst}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComposerClosed({ templates, onTemplate, leadName, meName }: any) {
  const [pick, setPick] = useState(false);
  const [prev, setPrev] = useState<Template | null>(null);
  return <div className="composer">
    {prev && <TemplatePreview t={prev} leadName={leadName} meName={meName} onClose={() => setPrev(null)} onSend={() => { onTemplate(prev); setPrev(null); setPick(false); }} />}
    {pick && templates.length > 0 && <div className="picker">
      <div className="ph">📋 Templates liberados <span className="esc">toque p/ pré-visualizar</span></div>
      <div className="pl">{templates.map((t: Template, k: number) => (
        <div key={k} className="pitem" onClick={() => setPrev(t)} style={t.recommended ? { border: "1px solid #5FD1A8", borderRadius: 8 } : undefined}>
          <div className="pic">{t.recommended ? "✅" : "📋"}</div><div className="pinfo"><b>{t.name}{t.recommended ? <span style={{ color: "#5FD1A8", fontWeight: 700, marginLeft: 6 }}>· Recomendado</span> : null}</b><span>{(t.body || "").replace(/\n/g, " ").slice(0, 60)}</span></div></div>
      ))}</div>
    </div>}
    <div className="wbanner">
      <div className="ic"><Ico d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" /></div>
      <div className="tx"><b style={{ color: "var(--amber)" }}>Janela de 24h encerrada</b><p>O cliente não responde há mais de 24h. Envie um <b>template aprovado</b> — o chat reabre quando ele responder.</p></div>
      <button className="btn btn-gold" onClick={() => setPick(!pick)} disabled={templates.length === 0}>
        <Ico d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" /> {templates.length ? "Escolher template" : "Nenhum template liberado"}</button>
    </div>
    <div className="cbox locked"><input disabled placeholder="Janela de 24h fechada. Envie um template para continuar." /></div>
  </div>;
}

function AddLeadModal({ onClose, onSubmit }: any) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [source, setSource] = useState("Indicação direta");
  const ok = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 10;
  return <div className="modal" onClick={(e: any) => { if (e.target.classList.contains("modal")) onClose(); }}>
    <div className="mcard">
      <div className="mhead"><div className="av" style={{ width: 30, height: 30, fontSize: 15 }}>+</div><b>Adicionar lead manual</b><button className="x" onClick={onClose}>✕</button></div>
      <div className="mbody">
        <div className="fld"><label>Nome do lead</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João Silva" /></div>
        <div className="fld"><label>WhatsApp</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 9 9999-9999" /></div>
        <div className="fld"><label>Origem</label><select value={source} onChange={(e) => setSource(e.target.value)}><option>Indicação direta</option><option>Site</option><option>Ligação</option><option>Outro</option></select></div>
        <div className="mnote">📌 Lead manual entra direto na sua carteira e <b>libera mensagem livre</b>. Aparece na aba <b>Pendente</b> pra você iniciar a abordagem.</div>
      </div>
      <div className="mfoot"><button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-gold" disabled={!ok} onClick={() => onSubmit({ name: name.trim(), phone, source })}>Adicionar lead</button></div>
    </div>
  </div>;
}

function CallModal({ call, onConfirm, onPlace, onClose }: any) {
  const phoneIco = "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z";
  const isWaiting = call.status === "waiting_client";
  const isReady = call.status === "client_ready";
  const phaseClass = isWaiting ? "waiting" : isReady ? "client_ready" : call.status === "confirm" ? "confirm" : call.status;
  const canClose = call.status !== "calling";
  return (
    <div className="modal" onClick={(e: any) => { if (e.target.classList.contains("modal") && canClose) onClose(); }}>
      <div className="mcard callcard">
        <div className={"callphone " + phaseClass}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d={phoneIco} /></svg>
        </div>
        {call.status === "confirm" && <>
          <b className="callttl">Ligar para {call.name}?</b>
          <p className="callsub">Ao confirmar, avisamos o cliente no WhatsApp. Quando ele responder, você liga com um clique.</p>
          <div className="callnote">O cliente vê um número da Calebe — o seu fica protegido · a chamada é gravada</div>
          <div className="mfoot" style={{ borderTop: "none", padding: "6px 0 0", justifyContent: "center", gap: 10 }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-gold" onClick={onConfirm}>Avisar cliente</button>
          </div>
        </>}
        {isWaiting && <>
          <b className="callttl">Aguardando {call.name}…</b>
          <p className="callsub">Enviamos um aviso no WhatsApp. Quando o cliente responder, o botão de ligar libera automaticamente.</p>
          <div className="mfoot" style={{ borderTop: "none", padding: "6px 0 0", justifyContent: "center", gap: 10 }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-ghost" onClick={onPlace}>Ligar direto</button>
          </div>
        </>}
        {isReady && <>
          <b className="callttl" style={{ color: "var(--green)" }}>{call.name} está disponível!</b>
          <p className="callsub">O cliente respondeu no WhatsApp. Ligue agora para conectar.</p>
          <div className="mfoot" style={{ borderTop: "none", padding: "6px 0 0", justifyContent: "center", gap: 10 }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-gold" onClick={onPlace}>Ligar agora</button>
          </div>
        </>}
        {call.status === "calling" && <><b className="callttl">Iniciando chamada…</b><p className="callsub">Conectando você com <b>{call.name}</b></p></>}
        {call.status === "placed" && <><b className="callttl" style={{ color: "var(--green)" }}>Atenda seu telefone</b><p className="callsub">Vamos te ligar agora. Ao atender, conectamos você com <b>{call.name}</b>.</p>
          <button className="btn btn-gold" style={{ marginTop: 4, minWidth: 130 }} onClick={onClose}>Ok, entendi</button></>}
        {call.status === "error" && <><b className="callttl" style={{ color: "var(--red)" }}>Não deu pra ligar</b><p className="callsub">{call.msg}</p>
          <button className="btn btn-gold" style={{ marginTop: 4, minWidth: 130 }} onClick={onClose}>Fechar</button></>}
      </div>
    </div>
  );
}

function ActionModal({ type, conv, imoveis, flash, reload, onClose }: any) {
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [motivo, setMotivo] = useState("Sem condição financeira");
  const [justif, setJustif] = useState("");
  async function run(fn: () => Promise<any>, okMsg: string) {
    setBusy(true);
    try { await fn(); flash(okMsg); onClose(); reload?.(); }
    catch (e: any) {
      const m = (String(e?.message || "") + JSON.stringify(e?.data ?? "")).toLowerCase();
      if (m.includes("already_pending")) flash("Já existe uma solicitação pendente pra esse lead", false);
      else if (m.includes("already_released")) flash("Telefone já está liberado", false);
      else flash(errMsg(e, "Não consegui concluir a ação"), false);
      setBusy(false);
    }
  }
  const title = type === "vincular" ? "🏠 Vincular imóvel" : type === "fechamento" ? "🤝 Solicitar fechamento" : "🗑️ Descartar lead";
  const f: Imovel[] = (imoveis || []).filter((im: Imovel) => !q || im.n.toLowerCase().includes(q.toLowerCase()) || (im.loc || "").toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="modal" onClick={(e: any) => { if (e.target.classList.contains("modal") && !busy) onClose(); }}>
      <div className="mcard">
        <div className="mhead"><b>{title}</b> <span style={{ flex: 1 }} /><button className="x" onClick={onClose}>✕</button></div>
        <div className="mbody">
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: -4 }}>Lead: <b style={{ color: "var(--cream)" }}>{conv.n}</b></div>
          {type === "vincular" && <>
            <div className="search"><Ico d="M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" /><input placeholder="Buscar imóvel" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
            <div className="picklist">
              {f.length === 0 && <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>Nenhum imóvel encontrado</div>}
              {f.map((im) => (
                <div key={im.id} className="pitem" onClick={() => !busy && run(() => linkProperty(conv.leadId, im.id), `Imóvel vinculado: ${im.n}`)}>
                  <div className="pic">🏠</div><div className="pinfo"><b>{im.n}</b><span>{im.loc}</span></div><div className="pprice">{im.price}</div>
                </div>
              ))}
            </div>
            <div className="mnote">Toque num imóvel pra vincular ao lead (avança pra Negociação).</div>
          </>}
          {type === "fechamento" && <div className="fld"><label>Justificativa (o admin aprova e libera o telefone real do cliente)</label>
            <textarea value={justif} onChange={(e) => setJustif(e.target.value)} rows={4} placeholder="Ex.: cliente confirmou interesse, falta só acertar condições de pagamento…"
              style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px", color: "var(--cream)", fontSize: 14, fontFamily: "inherit", outline: "none", resize: "vertical" }} /></div>}
          {type === "descartar" && <><div className="fld"><label>Motivo do descarte</label>
            <select value={motivo} onChange={(e) => { setMotivo(e.target.value); setJustif(""); }}>
              <option>Sem condição financeira</option><option>Quer comprar no futuro</option><option>Precisa vender outro imóvel</option><option>Não respondeu</option><option>Outros</option>
            </select>
            {motivo === "Outros" && <textarea value={justif} onChange={(e) => setJustif(e.target.value)} rows={3} placeholder="Descreva o motivo..." autoFocus
              style={{ width: "100%", marginTop: 8, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px", color: "var(--cream)", fontSize: 14, fontFamily: "inherit", outline: "none", resize: "vertical" }} />}
            </div><div className="mnote">O lead sai da carteira ativa (marcado como <b>Perdido</b>).</div></>}
        </div>
        {type !== "vincular" && <div className="mfoot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          {type === "fechamento" && <button className="btn btn-gold" disabled={busy || justif.trim().length < 5} onClick={() => run(() => phoneRelease(conv.id, justif.trim()), "Solicitação enviada ao admin ✓")}>{busy ? "Enviando…" : "Solicitar"}</button>}
          {type === "descartar" && <button className="btn btn-gold" disabled={busy || (motivo === "Outros" && justif.trim().length < 3)} onClick={() => run(() => setLeadStatus(conv.leadId, "LOST", motivo === "Outros" ? justif.trim() : motivo), "Lead descartado")}>{busy ? "…" : "Descartar"}</button>}
        </div>}
      </div>
    </div>
  );
}
