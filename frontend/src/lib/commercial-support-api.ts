// API do módulo Ajuda Comercial Calebe (lado ADM). Usa o cliente compartilhado @/lib/api.
import { api } from "@/lib/api";

export type CsStatus = "SOLICITADO" | "EM_ANALISE" | "ATUANDO" | "FINALIZADO" | "CANCELADO";

export interface CsListItem {
  id: string; status: CsStatus; conversationId: string; leadId?: string;
  clientName: string; clientPhone: string; brokerName: string; brokerPhone: string;
  origin?: string | null; requestedAt: string; acceptedAt?: string | null;
  assignedCalebe?: string | null; requestedBy: string; waitingMin: number;
}
export interface CsCounts { SOLICITADO: number; EM_ANALISE: number; ATUANDO: number; FINALIZADO: number; CANCELADO: number; }
export interface CsListResp { data: CsListItem[]; counts: CsCounts; total: number; }
export interface CsNote { id: string; note: string; author: string; createdAt: string; }
export interface CsLog { action: string; actorEmail?: string | null; createdAt: string; }
export interface CsDetail extends CsListItem {
  justification: string; inAnalysisAt?: string | null; finishedAt?: string | null;
  assignedCalebeUserId?: string | null; notes: CsNote[]; logs: CsLog[];
}

const B = "/api/commercial-support";
export const csList = (qs = "") => api.get<CsListResp>(`${B}${qs ? "?" + qs : ""}`);
export const csDetail = (id: string) => api.get<CsDetail>(`${B}/${id}`);
export const csInAnalysis = (id: string) => api.patch(`${B}/${id}/in-analysis`);
export const csAccept = (id: string) => api.patch(`${B}/${id}/accept`);
export const csFinish = (id: string) => api.patch(`${B}/${id}/finish`);
export const csCancel = (id: string) => api.patch(`${B}/${id}/cancel`);
export const csAddNote = (id: string, note: string) => api.post<CsNote>(`${B}/${id}/notes`, { note });
export const csLogAction = (id: string, action: string) => api.post(`${B}/${id}/log`, { action });
