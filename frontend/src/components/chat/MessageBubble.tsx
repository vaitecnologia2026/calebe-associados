// Bolha de mensagem · WhatsApp-style com word-break responsivo (W13)
// Suporta: text, image, video, audio, document
// + estado FALHA persistente (envio errado · janela fechada · binding ausente)

import { maskPhoneText, formatTime, buildAudioSources } from "@/lib/format";
import { resolveBackendUrl } from "@/lib/media";
import type { Message } from "@/types/conversation";

interface Props {
  msg: Message;
  grouped: boolean;
  isFirstFromSender: boolean;
  /** True quando outbound foi mandado em conversa sem nenhum inbound prévio (binding ausente).
   *  Indica "não entregue silenciosamente" mesmo sem messageStatus=failed do backend. */
  unreachable?: boolean;
  /** Callback opcional pra retentar envio · só faz sentido em msgs locais com erro de envio. */
  onRetry?: (msg: Message) => void;
}

export function MessageBubble({ msg, grouped, unreachable, onRetry }: Props) {
  const side = msg.from === "lead" || msg.direction === "inbound" ? "msg-in" : "msg-out";
  const firstCls = grouped
    ? "msg-grouped"
    : (side === "msg-in" ? "msg-first-in" : "msg-first-out");

  const safeText = maskPhoneText(msg.text ?? "");
  const at = msg.at ?? formatTime(msg.createdAt);

  const isAudio = msg.fileUrl && msg.contentType === "audio";
  const isImage = msg.fileUrl && msg.contentType === "image";
  const isVideo = msg.fileUrl && msg.contentType === "video";
  const isDoc = msg.fileUrl && msg.contentType && !["audio", "image", "video", "text"].includes(msg.contentType);
  // URL absoluta · backend pode retornar caminho relativo (/midias/...)
  const fileUrl = msg.fileUrl ? resolveBackendUrl(msg.fileUrl) : undefined;

  const audioCls = isAudio ? "msg-audio" : "";

  // Falha = (1) backend marcou como failed (incluindo errorReason), OU
  //         (2) historicamente: outbound em conv sem inbound prévio (unreachable)
  const isOutbound = side === "msg-out";
  const explicitFail = isOutbound && (
    msg.messageStatus === "failed" ||
    !!msg.errorReason ||
    msg._waStatus === "failed"
  );
  const showFailedBadge = explicitFail || (isOutbound && unreachable);
  const failedCls = showFailedBadge ? "msg-failed" : "";

  return (
    <div className={`msg ${side} ${firstCls} ${audioCls} ${failedCls}`}>
      {isImage && (
        <img
          src={fileUrl}
          loading="lazy"
          decoding="async"
          alt=""
          onClick={() => fileUrl && window.open(fileUrl, "_blank")}
          style={{ maxWidth: "100%", maxHeight: 240, cursor: "pointer", display: "block" }}
          className="rounded"
        />
      )}
      {isVideo && (
        <video
          src={fileUrl}
          controls
          playsInline
          preload="none"
          style={{ maxWidth: "100%", maxHeight: 260, display: "block" }}
          className="rounded"
        />
      )}
      {isAudio && (
        <audio controls preload="metadata" style={{ width: "100%", height: 36, display: "block", outline: "none" }}>
          {buildAudioSources(fileUrl).map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
          Seu navegador não suporta este áudio.
        </audio>
      )}
      {isDoc && (
        <a
          href={fileUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-xs underline hover:no-underline"
        >
          Anexo · {msg.fileName ?? safeText ?? "arquivo"}
        </a>
      )}
      {(safeText || (!isImage && !isVideo && !isAudio && !isDoc)) && (
        <span>{safeText}</span>
      )}
      {showFailedBadge && (
        <div className="msg-failed-badge" role="status" aria-label="Mensagem não entregue">
          <span className="msg-failed-x">✕</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {explicitFail
              ? `Não entregue${msg.errorReason ? ` · ${msg.errorReason}` : ""}`
              : "Não entregue · cliente nunca respondeu, envie um template Meta"}
          </span>
          {onRetry && msg.id?.startsWith("temp-") && (
            <button type="button" className="msg-failed-retry" onClick={() => onRetry(msg)}>
              Tentar de novo
            </button>
          )}
        </div>
      )}
      <MessageMeta msg={msg} at={at} />
    </div>
  );
}

function MessageMeta({ msg, at }: { msg: Message; at?: string }) {
  const ticks = getTicks(msg);
  return (
    <span className="msg-meta">
      {at}
      {ticks && <span dangerouslySetInnerHTML={{ __html: ticks }} />}
    </span>
  );
}

// Portado de _ticks no monólito (linha 18213)
function getTicks(m: Message): string {
  if (m.from !== "corretor" && m.direction !== "outbound") return "";
  if (m.sending) return '<span class="msg-tick" title="enviando">⏱</span>';
  if (m.readAt) return '<span class="msg-tick msg-tick-read" title="lida">✓✓</span>';
  if (m.deliveredAt) return '<span class="msg-tick" title="entregue">✓✓</span>';
  const st = String(m.messageStatus ?? "").toLowerCase();
  if (st === "read") return '<span class="msg-tick msg-tick-read" title="lida">✓✓</span>';
  if (st === "delivered") return '<span class="msg-tick" title="entregue">✓✓</span>';
  if (st === "failed") return '<span class="msg-tick" title="falhou" style="color:#ef4444">✗</span>';
  return '<span class="msg-tick" title="enviada">✓</span>';
}
