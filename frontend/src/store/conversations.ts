// Store de conversas · alimentado por loadConversations + SSE inbound/outbound/status
// Substitui o array global `conversations` do monólito (linha 7454)

import { create } from "zustand";
import { api } from "@/lib/api";
import { sseBus } from "@/lib/sse";
import type { Conversation, Message, MessageStatus } from "@/types/conversation";
import type { ConversationsListResponse } from "@/types/api";
import { useAuth } from "./auth";

interface ConversationsState {
  list: Conversation[];
  byId: Map<string, Conversation>;
  isLoading: boolean;
  lastFetchedAt: number | null;
  activeId: string | null;

  fetchList: () => Promise<void>;
  setActive: (id: string | null) => void;
  loadMessages: (convId: string) => Promise<void>;
  upsertMessage: (convId: string, msg: Message, opts?: { incrementUnread?: boolean }) => void;
  applyStatusUpdate: (convId: string, messageId: string, status: MessageStatus, at?: string) => void;
  applyMessageError: (convId: string, messageId: string, reason?: string) => void;
  registerSse: () => () => void; // retorna unsub composto
}

export const useConversations = create<ConversationsState>((set, get) => ({
  list: [],
  byId: new Map(),
  isLoading: false,
  lastFetchedAt: null,
  activeId: null,

  async fetchList() {
    const role = useAuth.getState().user?.role;
    const isAdmin = role === "ADMIN" || role === "LEGAL";
    set({ isLoading: true });
    try {
      // slim=1 para admin · 8.8MB → ~1.1MB sobre o fio (gzip)
      const url = `/api/conversations?limit=10000${isAdmin ? "&slim=1" : ""}`;
      const r = await api.get<ConversationsListResponse>(url);
      const incoming = r.data ?? [];

      // CRÍTICO: a API de listagem NÃO retorna o array messages (só lastMessage preview).
      // Este endpoint é pollado a cada 20s. Se a gente sobrescrever a conv inteira,
      // perde TODO o histórico local que o loadMessages tinha carregado.
      // Por isso fazemos MERGE: campos do servidor sobrescrevem os locais, MAS
      // preservamos `messages` (carregado sob demanda via loadMessages) e marcadores
      // locais (unread incrementado por SSE inbound enquanto offscreen, etc).
      const prevById = get().byId;
      const merged = incoming.map((fresh) => {
        const prev = prevById.get(fresh.id);
        if (!prev) return fresh;
        return {
          ...fresh,
          messages: prev.messages, // preserva histórico local
          // Mantém unread local se o servidor não devolver — evita zerar contadores otimistas
          unread: (fresh as Conversation).unread ?? prev.unread,
        } as Conversation;
      });
      const byId = new Map(merged.map((c) => [c.id, c]));
      set({ list: merged, byId, lastFetchedAt: Date.now() });
    } finally {
      set({ isLoading: false });
    }
  },

  setActive(id) { set({ activeId: id }); },

  async loadMessages(convId) {
    const r = await api.get<{ messages?: Message[]; data?: Message[] }>(
      `/api/conversations/${convId}/messages?limit=2000`,
    );
    const msgs = (r.messages ?? r.data ?? []).filter((m) => !isVaiActivityMsg(m));
    const state = get();
    const conv = state.byId.get(convId);
    if (!conv) return;
    conv.messages = msgs.map(adaptMsg);
    set({ list: [...state.list], byId: new Map(state.byId) });
  },

  upsertMessage(convId, msg, opts) {
    const state = get();
    const conv = state.byId.get(convId);
    if (!conv) return; // conv não carregada · caller deve fazer fetchList()

    if (isVaiActivityMsg(msg)) return;
    const adapted = adaptMsg(msg);
    conv.messages = [...(conv.messages ?? []), adapted];
    const createdAt = adapted.createdAt ?? undefined;
    conv.lastMessage = {
      text: adapted.text,
      direction: adapted.direction,
      contentType: adapted.contentType,
      createdAt,
      at: createdAt,
    };
    conv.lastMessageAt = createdAt ?? new Date().toISOString();
    if (opts?.incrementUnread) conv.unread = (conv.unread ?? 0) + 1;

    set({ list: [...state.list], byId: new Map(state.byId) });
  },

  applyStatusUpdate(convId, messageId, status, at) {
    const state = get();
    const conv = state.byId.get(convId);
    if (!conv?.messages) return;
    const m = conv.messages.find((x) => x.id === messageId || x.whatsappMessageId === messageId);
    if (!m) return;
    m.messageStatus = status;
    if (status === "delivered" && at) m.deliveredAt = at;
    if (status === "read" && at) m.readAt = at;
    set({ list: [...state.list], byId: new Map(state.byId) });
  },

  // Marca uma mensagem local (geralmente otimística com id temp-) como falha de envio.
  // Bubble aparece em vermelho permanente até o usuário recarregar ou tentar de novo.
  applyMessageError(convId, messageId, reason) {
    const state = get();
    const conv = state.byId.get(convId);
    if (!conv?.messages) return;
    const m = conv.messages.find((x) => x.id === messageId);
    if (!m) return;
    m.messageStatus = "failed";
    m.errorReason = reason || "Falha ao enviar";
    m.sending = false;
    set({ list: [...state.list], byId: new Map(state.byId) });
  },

  registerSse() {
    const role = useAuth.getState().user?.role;
    const isAdmin = role === "ADMIN" || role === "LEGAL";

    const unsubs: Array<() => void> = [];

    unsubs.push(sseBus.on<{ conversationId: string; text: string; contentType?: string; fileUrl?: string; mimeType?: string; at?: string }>(
      "message.inbound", (d) => {
        if (!d) return;
        get().upsertMessage(d.conversationId, {
          direction: "inbound",
          fromRole: "lead",
          text: d.text ?? "",
          contentType: (d.contentType as Message["contentType"]) ?? "text",
          fileUrl: d.fileUrl ?? null,
          mimeType: d.mimeType ?? null,
          createdAt: d.at ?? new Date().toISOString(),
        }, { incrementUnread: true });
      }));

    unsubs.push(sseBus.on<{ conversationId: string; text: string; senderName?: string; contentType?: string; fileUrl?: string; at?: string }>(
      "message.outbound", (d) => {
        if (!d || !isAdmin) return; // corretor já sabe local
        get().upsertMessage(d.conversationId, {
          direction: "outbound",
          fromRole: "associate",
          text: d.text ?? "",
          contentType: (d.contentType as Message["contentType"]) ?? "text",
          fileUrl: d.fileUrl ?? null,
          createdAt: d.at ?? new Date().toISOString(),
        });
      }));

    unsubs.push(sseBus.on<{ conversationId: string; messageId: string; status: MessageStatus; at?: string }>(
      "message.status", (d) => {
        if (!d) return;
        get().applyStatusUpdate(d.conversationId, d.messageId, d.status, d.at);
      }));

    // Eventos que mudam composição da lista · refetch (cheap, cache 60s no backend)
    const refetch = () => { void get().fetchList(); };
    unsubs.push(sseBus.on("lead.assigned", refetch));
    unsubs.push(sseBus.on("lead.distributed", refetch));
    unsubs.push(sseBus.on("lead.status_changed", refetch));

    return () => { for (const u of unsubs) u(); };
  },
}));

// =========================================================================
// Helpers internos
// =========================================================================

function adaptMsg(m: Message): Message {
  const direction = m.direction === "OUT" ? "outbound" : m.direction === "IN" ? "inbound" : m.direction;
  return {
    ...m,
    direction,
    from: direction === "outbound" ? "corretor" : "lead",
    text: m.text ?? "",
    contentType: m.contentType ?? "text",
    createdAt: m.createdAt ?? undefined,
  };
}

// Portado de _isVaiActivityMsg do index.html (linha 10464)
function isVaiActivityMsg(m: Partial<Message>): boolean {
  if (!m) return false;
  const ct = String(m.contentType ?? "").toLowerCase();
  if (ct === "activity" || ct === "system" || ct === "event") return true;
  const text = String(m.text ?? "");
  if (!text) return false;
  return /\b(iniciou|encerrou|transferiu|assumiu|finalizou|reabriu)\s+o\s+atendimento\b/i.test(text);
}
