// Portado de adaptConversation + adaptMsgFromApi do index.html (linhas 10393-10489)

export type LeadOrigin = "FACEBOOK" | "GOOGLE" | "WEBSITE" | "MANUAL" | "WHATSAPP" | string;
export type LeadStatus = "NEW" | "QUALIFYING" | "NEGOTIATING" | "CLOSING" | "CLOSED" | "LOST";
export type ChatStatus = "novo" | "qualificando" | "negociando" | "fechamento" | "fechado" | "perdido" | "descartado";

export type MessageDirection = "inbound" | "outbound" | "IN" | "OUT";
export type FromRole = "lead" | "associate" | "system";
export type ContentType = "text" | "image" | "audio" | "video" | "document" | "file" | "sticker" | "gif";
export type MessageStatus = "sent" | "delivered" | "read" | "failed" | "accepted" | null;

export interface Lead {
  id: string;
  name: string;
  phoneMasked?: string;
  phoneEncrypted?: string;
  phone?: string;
  origin?: LeadOrigin;
  segment?: string;
  status?: LeadStatus;
  source?: string;
  linkedPropertyId?: string | null;
  phoneReleasedAt?: string | null;
  assignedAt?: string | null;
  firstContactAt?: string | null;
  redistributionCount?: number;
}

export interface Message {
  id?: string;
  conversationId?: string;
  direction: MessageDirection;
  fromRole?: FromRole;
  from?: "lead" | "corretor"; // forma adaptada local
  text: string;
  contentType?: ContentType;
  createdAt?: string | null;
  at?: string;
  deliveredAt?: string | null;
  readAt?: string | null;
  messageStatus?: MessageStatus;
  fileUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number;
  provider?: "vai" | "whatsapp_cloud";
  templateName?: string | null;
  whatsappMessageId?: string | null;
  errorReason?: string | null;
  sending?: boolean;
  _waMessageId?: string;
  _waStatus?: MessageStatus;
}

export interface Conversation {
  id: string;
  leadId: string;
  associateId: string;
  status?: ChatStatus;
  createdAt?: string;
  lastMessageAt?: string;
  manualFree?: boolean;
  phoneReleased?: boolean;
  lead?: Lead;
  associate?: {
    id: string;
    phone?: string;
    whatsapp?: string;
    user?: { id: string; name: string; email?: string; lastSeenAt?: string };
  };
  messages?: Message[];
  lastMessage?: {
    text: string;
    direction: MessageDirection;
    contentType?: ContentType;
    at?: string;
    createdAt?: string;
  };
  _count?: { messages: number };
  // estado local
  unread?: number;
}

// Mapeamentos (linha 10396, 10398)
export const CONV_STATUS_MAP: Record<string, ChatStatus> = {
  OPEN: "qualificando",
  PAUSED: "qualificando",
  CLOSED: "descartado",
};

export const LEAD_TO_CHAT_STATUS: Record<LeadStatus, ChatStatus> = {
  NEW: "novo",
  QUALIFYING: "qualificando",
  NEGOTIATING: "negociando",
  CLOSING: "fechamento",
  CLOSED: "fechado",
  LOST: "perdido",
};

// Status visual (linha 7438)
export interface ChatStatusVisual {
  label: string;
  color: string;
  bg: string;
  order: number;
}

export const CHAT_STATUS: Record<ChatStatus, ChatStatusVisual> = {
  novo:         { label: "Novo lead",                       color: "#9FD6FF", bg: "rgba(159,214,255,.12)", order: 1 },
  qualificando: { label: "Qualificando",                    color: "#DEB96D", bg: "rgba(222,185,109,.14)", order: 2 },
  negociando:   { label: "Negociando",                      color: "#5FD1A8", bg: "rgba(95,209,168,.14)",  order: 3 },
  fechamento:   { label: "Negociação em fechamento",        color: "#F5A524", bg: "rgba(245,165,36,.16)",  order: 4 },
  fechado:      { label: "Fechado",                         color: "#8EE6B5", bg: "rgba(95,209,168,.22)",  order: 5 },
  perdido:      { label: "Perdido",                         color: "#E89494", bg: "rgba(239,68,68,.14)",   order: 6 },
  descartado:   { label: "Descartado",                      color: "#E89494", bg: "rgba(239,68,68,.10)",   order: 7 },
};

export const DESCARTE_MOTIVOS = [
  "Sem condição financeira",
  "Quer comprar no futuro",
  "Precisa vender outro imóvel",
  "Não respondeu",
  "Outros",
] as const;
