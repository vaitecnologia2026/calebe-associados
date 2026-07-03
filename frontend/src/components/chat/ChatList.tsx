// Lista de conversas (sidebar do chat)
// Reativa a SSE via store · reordena (lead esperando primeiro, mais recente depois)

import { useMemo } from "react";
import { formatTime } from "@/lib/format";
import type { Conversation } from "@/types/conversation";
import { CHAT_STATUS } from "@/types/conversation";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  filterQuery?: string;
}

export function ChatList({ conversations, activeId, onSelect, filterQuery = "" }: Props) {
  const sorted = useMemo(() => {
    const q = filterQuery.toLowerCase().trim();
    const arr = conversations.filter((c) => {
      const status = c.status;
      if (status === "perdido" || status === "fechado" || status === "descartado") return false;
      if (!q) return true;
      return (c.lead?.name ?? "").toLowerCase().includes(q);
    });

    return arr.slice().sort((a, b) => {
      const aWait = a.lastMessage?.direction === "inbound" ? 1 : 0;
      const bWait = b.lastMessage?.direction === "inbound" ? 1 : 0;
      if (aWait !== bWait) return bWait - aWait;
      const aTs = new Date(a.lastMessageAt ?? a.createdAt ?? 0).getTime();
      const bTs = new Date(b.lastMessageAt ?? b.createdAt ?? 0).getTime();
      return bTs - aTs;
    });
  }, [conversations, filterQuery]);

  if (!sorted.length) {
    return (
      <div className="p-6 text-center text-sand-100/55 text-sm">
        Nenhuma conversa.
      </div>
    );
  }

  return (
    <ul className="divide-y hairline">
      {sorted.map((c) => {
        const isActive = c.id === activeId;
        const status = c.status ? CHAT_STATUS[c.status] : null;
        const previewText = c.lastMessage?.text ?? "";
        const previewIcon =
          c.lastMessage?.contentType === "image" ? "[foto]"
          : c.lastMessage?.contentType === "audio" ? "[áudio]"
          : c.lastMessage?.contentType === "video" ? "[vídeo]"
          : c.lastMessage?.contentType === "document" ? "[documento]"
          : "";
        const preview = previewText ? previewText.slice(0, 60) + (previewText.length > 60 ? "…" : "")
          : previewIcon || c.lead?.origin || "";
        const initial = (c.lead?.name?.[0] ?? "—").toUpperCase();
        return (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              className={`w-full text-left p-3 flex items-start gap-3 transition-colors ${
                isActive ? "bg-gold-400/10" : "hover:bg-app-subtle/40"
              }`}
            >
              <div className="h-10 w-10 rounded-full bg-gold-400/15 flex items-center justify-center text-gold-400 font-bold text-sm shrink-0">
                {initial}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <p className="text-sm font-semibold truncate">{c.lead?.name ?? "—"}</p>
                  {status && (
                    <span
                      className="text-[0.58rem] uppercase tracking-mono-wide font-bold px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: status.bg, color: status.color }}
                    >
                      {status.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-sand-100/55 truncate">
                  {c.lastMessage?.direction === "outbound" ? "→ " : ""}{preview}
                </p>
                <p className="text-[0.62rem] text-sand-100/45 mt-1">
                  {formatTime(c.lastMessageAt)}
                </p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
