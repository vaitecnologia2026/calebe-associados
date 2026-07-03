// Stream de mensagens · WhatsApp-style com:
//  - divisor de data (HOJE/ONTEM/12 DE MAIO)
//  - agrupamento por sender (cauda só na 1ª)
//  - W13: cap em 200 msgs visíveis + botão "Carregar histórico"
//  - auto-scroll pro fim em novas msgs
//
// Substitui o stream._lastFp + manual innerHTML do monólito (linha 18173+)

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { dayKey, formatChatDateLabel } from "@/lib/format";
import type { Message } from "@/types/conversation";

interface Props {
  messages: Message[];
  emptyLabel?: string;
  /** Retry de mensagem com erro de envio · só aplicável às bolhas com id temp- */
  onRetry?: (msg: Message) => void;
}

const VISIBLE_DEFAULT = 200;

export function ChatStream({ messages, emptyLabel = "Selecione uma conversa à esquerda.", onRetry }: Props) {
  const [showAll, setShowAll] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  // Track quem é o usuário "ancorado" no final da lista pra decidir auto-scroll.
  // Se o usuário está rolando pra cima lendo histórico, NÃO arranca ele de volta.
  const stickyToBottomRef = useRef(true);
  const prevLenRef = useRef(0);
  const prevLastIdRef = useRef<string | null>(null);
  const [hasNewBelow, setHasNewBelow] = useState(false);

  // "Janela WhatsApp fechada" = conversa nunca teve inbound do lead.
  const hasAnyInbound = useMemo(
    () => messages.some((m) => m.direction === "inbound" || m.from === "lead"),
    [messages],
  );

  // Reset cap ao trocar conjunto de mensagens
  const firstId = messages[0]?.id ?? messages[0]?.createdAt ?? "";
  useEffect(() => { setShowAll(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [firstId]);

  const visible = showAll || messages.length <= VISIBLE_DEFAULT
    ? messages
    : messages.slice(-VISIBLE_DEFAULT);
  const hidden = messages.length - visible.length;

  // Detecta se user está "perto do fim" (threshold 120px). Atualiza sticky.
  function isNearBottom(el: HTMLDivElement): boolean {
    return (el.scrollHeight - el.scrollTop - el.clientHeight) < 120;
  }

  function onScroll() {
    const el = streamRef.current;
    if (!el) return;
    stickyToBottomRef.current = isNearBottom(el);
    if (stickyToBottomRef.current) setHasNewBelow(false);
  }

  // Auto-scroll inteligente
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const lastId = messages.length ? (messages[messages.length - 1].id ?? "") : "";
    const lengthChanged = messages.length !== prevLenRef.current;
    const lastIdChanged = lastId !== prevLastIdRef.current;
    const hasNewMessage = lengthChanged || (lastIdChanged && lastId !== "");

    if (!hasNewMessage) return; // status update etc · não scroll
    prevLenRef.current = messages.length;
    prevLastIdRef.current = lastId;

    const lastMsg = messages[messages.length - 1];
    const lastIsMine = lastMsg && (lastMsg.direction === "outbound" || lastMsg.from === "corretor");

    // Se o user mandou, sempre rola pro fim (ele acabou de digitar).
    // Se o lead mandou, só rola se já estava no fim — senão mostra pill "nova msg".
    if (lastIsMine || stickyToBottomRef.current) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: lengthChanged && prevLenRef.current - messages.length === -1 ? "smooth" : "auto" });
      });
      setHasNewBelow(false);
    } else {
      setHasNewBelow(true);
    }
  }, [messages]);

  function scrollToBottomNow() {
    const el = streamRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setHasNewBelow(false);
  }

  if (!messages.length) {
    return (
      <div className="chat-stream items-center justify-center text-sm text-sand-100/55">
        {emptyLabel}
      </div>
    );
  }

  let prevDay: string | null = null;
  let prevFrom: string | null = null;

  return (
    <div ref={streamRef} className="chat-stream" onScroll={onScroll}>
      {hidden > 0 && (
        <div className="self-center my-2">
          <button
            type="button"
            className="btn-base btn-outline text-xs"
            style={{ padding: ".5rem 1.1rem" }}
            onClick={() => setShowAll(true)}
          >
            <ChevronUp size={14} /> Carregar histórico ({hidden} mensagens anteriores)
          </button>
        </div>
      )}
      {hasNewBelow && (
        <button
          type="button"
          onClick={scrollToBottomNow}
          className="sticky bottom-2 self-center z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gold-400 text-app-canvas font-semibold text-xs shadow-lg hover:bg-gold-300 transition-colors"
        >
          <ChevronUp size={12} className="rotate-180" /> nova mensagem
        </button>
      )}
      {visible.map((m, idx) => {
        const iso = m.createdAt ?? new Date().toISOString();
        const day = dayKey(iso);
        const showDateDivider = day !== prevDay;
        if (showDateDivider) { prevDay = day; prevFrom = null; }

        const sender = m.from ?? (m.direction === "outbound" ? "corretor" : "lead");
        const grouped = sender === prevFrom;
        const isFirst = !grouped;
        prevFrom = sender;

        // Key estável · prefere whatsappMessageId (não muda entre temp → real),
        // depois id, depois fallback. Evita remount de bolhas durante o swap
        // optimistic → real, que era a causa do "flicker" ao mandar mensagem.
        const stableKey = m.whatsappMessageId
          ?? m.id
          ?? `${m.text ?? ""}::${iso}::${m.direction}::${idx}`;
        return (
          <div key={stableKey} className="contents">
            {showDateDivider && (
              <div className="chat-date-divider">{formatChatDateLabel(iso)}</div>
            )}
            <MessageBubble
              msg={m}
              grouped={grouped}
              isFirstFromSender={isFirst}
              /* Template Meta chega mesmo sem inbound prévio (é o objetivo do template).
                 Só marca "não entregue" pra outbound de TEXTO LIVRE em conv sem inbound. */
              unreachable={
                !hasAnyInbound &&
                (m.direction === "outbound" || m.from === "corretor") &&
                !m.templateName
              }
              onRetry={onRetry}
            />
          </div>
        );
      })}
    </div>
  );
}
