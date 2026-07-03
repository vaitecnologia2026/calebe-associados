// Tema claro/escuro · persiste em localStorage e aplica `html.light` / `html.dark`
// Default: dark (manter coerência visual da marca dourada · linha do tempo do monólito)

import { create } from "zustand";

export type Theme = "light" | "dark";

const STORAGE_KEY = "CALEBE_THEME";

function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch { /* ignore */ }
  // Auto-detect via prefers-color-scheme
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

function applyToHtml(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.setAttribute("data-theme", theme);
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const initial = readStoredTheme();
applyToHtml(initial); // antes do React montar

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initial,
  toggle() {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    applyToHtml(next);
    set({ theme: next });
  },
  setTheme(t) {
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
    applyToHtml(t);
    set({ theme: t });
  },
}));
