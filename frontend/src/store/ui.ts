// UI state · filtros, tabs ativas, modais
// Substitui _chatMonitorFilters, _chatMonitorTab, _admImovTab etc do monólito

import { create } from "zustand";

interface UiState {
  // Toast
  toast: { msg: string; visible: boolean; undo?: () => void } | null;
  showToast: (msg: string, opts?: { duration?: number; undo?: () => void }) => void;
  clearToast: () => void;

  // Admin chat monitor (linha 15240-15241)
  admChatTab: "ativas" | "fechadas";
  admChatFilters: { cliente: string; corretor: string; status: string; periodo: string };
  admChatRenderedCount: number; // W11 chunked render
  setAdmChatTab: (tab: "ativas" | "fechadas") => void;
  setAdmChatFilters: (filters: Partial<UiState["admChatFilters"]>) => void;
  resetAdmChatFilters: () => void;
  admChatLoadMore: () => void;

  // Admin imóveis (linha 12285)
  admImovTab: "empreendimentos" | "todos" | "enviados";
  admImovRenderedCount: number;
  setAdmImovTab: (tab: UiState["admImovTab"]) => void;
  admImovLoadMore: () => void;

  // Corretor chat status filter (renderChatList)
  corChatStatusFilter: "all" | "novo" | "qualificando" | "negociando" | "fechamento" | "fechado" | "perdido";
  setCorChatStatusFilter: (s: UiState["corChatStatusFilter"]) => void;
}

const PAGE_SIZE_CHAT = 200;
const PAGE_SIZE_IMOV = 60;

export const useUi = create<UiState>((set) => ({
  toast: null,
  showToast(msg, opts) {
    set({ toast: { msg, visible: true, undo: opts?.undo } });
    const dur = opts?.duration ?? (opts?.undo ? 5000 : 2600);
    setTimeout(() => {
      set((s) => (s.toast?.msg === msg ? { toast: null } : s));
    }, dur);
  },
  clearToast() { set({ toast: null }); },

  admChatTab: "ativas",
  admChatFilters: { cliente: "", corretor: "", status: "", periodo: "todos" },
  admChatRenderedCount: 100,
  setAdmChatTab(tab) { set({ admChatTab: tab, admChatRenderedCount: 100 }); },
  setAdmChatFilters(filters) {
    set((s) => ({
      admChatFilters: { ...s.admChatFilters, ...filters },
      admChatRenderedCount: 100,
    }));
  },
  resetAdmChatFilters() {
    set({
      admChatFilters: { cliente: "", corretor: "", status: "", periodo: "todos" },
      admChatRenderedCount: 100,
    });
  },
  admChatLoadMore() {
    set((s) => ({ admChatRenderedCount: s.admChatRenderedCount + PAGE_SIZE_CHAT }));
  },

  admImovTab: "empreendimentos",
  admImovRenderedCount: 60,
  setAdmImovTab(tab) { set({ admImovTab: tab, admImovRenderedCount: 60 }); },
  admImovLoadMore() {
    set((s) => ({ admImovRenderedCount: s.admImovRenderedCount + PAGE_SIZE_IMOV }));
  },

  corChatStatusFilter: "all",
  setCorChatStatusFilter(s) { set({ corChatStatusFilter: s }); },
}));
