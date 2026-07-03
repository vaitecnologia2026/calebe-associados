// Store de autenticação · Zustand
// Substitui o `window.__AUTH` mutável global do monólito

import { create } from "zustand";
import { api, awaitAuthHydration, clearAuth, getAuth, setAuth } from "@/lib/api";
import { sseBus } from "@/lib/sse";
import { setupNativePush, teardownNativePush } from "@/lib/nativePush";
import type { AuthResponse, BackendRole, User, RoleMapEntry } from "@/types/auth";
import { ROLE_MAP } from "@/types/auth";
import { ApiError } from "@/types/api";

// Heartbeat presence · POST /api/auth/heartbeat a cada 2min enquanto aba visível.
// Marca User.lastSeenAt = NOW() pra admin ver "online agora" (threshold 5min).
let _heartbeatTimer: number | null = null;
let _visListener: (() => void) | null = null;

function startHeartbeat(): void {
  if (_heartbeatTimer != null) return;
  const ping = () => {
    if (document.hidden) return;
    void fetch((import.meta.env.VITE_API_BASE ?? "") + "/api/auth/heartbeat", {
      method: "POST",
      credentials: "include",
      headers: getAuth()?.accessToken ? { Authorization: "Bearer " + getAuth()!.accessToken } : {},
    }).catch(() => { /* silent */ });
  };
  ping(); // dispara já no login
  _heartbeatTimer = window.setInterval(ping, 120_000);
  _visListener = () => { if (!document.hidden) ping(); };
  document.addEventListener("visibilitychange", _visListener);
}

function stopHeartbeat(): void {
  if (_heartbeatTimer != null) { window.clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  if (_visListener) { document.removeEventListener("visibilitychange", _visListener); _visListener = null; }
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  roleEntry: RoleMapEntry | null;
  bootStatus: "idle" | "restoring" | "ready" | "unauth";
  loginError: string | null;
  loginLoading: boolean;

  login: (email: string, password: string) => Promise<{ ok: boolean; persona?: string }>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  clearLoginError: () => void;
  updateUser: (patch: Partial<User>) => void;
}

function mapRole(role: BackendRole): RoleMapEntry {
  return ROLE_MAP[role] ?? { role: "admin", label: role, persona: "admin" };
}

export const useAuth = create<AuthState>((set) => ({
  user: getAuth()?.user ?? null,
  accessToken: getAuth()?.accessToken ?? null,
  roleEntry: getAuth()?.user ? mapRole(getAuth()!.user.role) : null,
  bootStatus: "idle",
  loginError: null,
  loginLoading: false,

  async login(email, password) {
    set({ loginLoading: true, loginError: null });
    try {
      const data = await api.post<AuthResponse>(
        "/api/auth/login",
        { email: email.trim().toLowerCase(), password },
        { skipAuth: true },
      );
      setAuth(data);
      const roleEntry = mapRole(data.user.role);
      set({ user: data.user, accessToken: data.accessToken, roleEntry, bootStatus: "ready" });
      sseBus.start();
      startHeartbeat();
      void setupNativePush();
      return { ok: true, persona: roleEntry.persona };
    } catch (err) {
      let msg = "E-mail ou senha inválidos.";
      if (err instanceof ApiError) {
        if (err.status === undefined) msg = `Não foi possível conectar à API (${err.message}).`;
        else if ((err.data as { error?: string })?.error === "validation") msg = "Preencha e-mail e senha válidos.";
        else if ((err.data as { error?: string })?.error && (err.data as { error?: string }).error !== "invalid_credentials") {
          msg = `Falha: ${(err.data as { error?: string }).error}`;
        }
      }
      set({ loginError: msg });
      return { ok: false };
    } finally {
      set({ loginLoading: false });
    }
  },

  async logout() {
    sseBus.stop();
    stopHeartbeat();
    void teardownNativePush();
    try {
      // 2026-06-25 · Envia refreshToken no body como fallback ao cookie httpOnly.
      // Garante revogação server-side mesmo quando o cookie foi dropado (iOS ITP).
      const rt = getAuth()?.refreshToken;
      await fetch((import.meta.env.VITE_API_BASE ?? "") + "/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rt ? { refreshToken: rt } : {}),
      });
    } catch { /* ignore */ }
    clearAuth();
    set({ user: null, accessToken: null, roleEntry: null, bootStatus: "unauth" });
  },

  async restoreSession() {
    // 2026-06-29 · Aguarda rehidratação async do storage nativo (Capacitor
    // Preferences) antes de checar getAuth(). Sem isso, em Android/iOS WebView
    // a chamada inicial pode encontrar localStorage vazio enquanto o
    // Preferences ainda está sendo lido, e marcaria como "unauth" indevidamente.
    await awaitAuthHydration();
    const current = getAuth();
    if (!current?.accessToken) {
      set({ bootStatus: "unauth" });
      return;
    }
    set({ bootStatus: "restoring" });
    try {
      const u = await api.me<User>();
      const roleEntry = mapRole(u.role);
      // Mantém token salvo · só atualiza user a partir da fonte da verdade
      setAuth({ ...current, user: u });
      set({ user: u, accessToken: current.accessToken, roleEntry, bootStatus: "ready" });
      sseBus.start();
      startHeartbeat();
      void setupNativePush();
    } catch (err) {
      // 2026-06-29 · Antes: qualquer erro virava clearAuth() → relogin forçado em
      // network flaky / 5xx. Agora só derruba sessão se for 401 (token inválido
      // confirmado pelo backend). Em network error/5xx/timeout, restaura a
      // sessão a partir do localStorage e segue como "ready"; chamadas
      // subsequentes podem renovar o token quando o servidor voltar.
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        clearAuth();
        set({ user: null, accessToken: null, roleEntry: null, bootStatus: "unauth" });
      } else {
        // Erro transiente: confia no que está no storage e segue.
        const cachedUser = current.user;
        const roleEntry = cachedUser ? mapRole(cachedUser.role) : null;
        set({ user: cachedUser, accessToken: current.accessToken, roleEntry, bootStatus: "ready" });
        sseBus.start();
        startHeartbeat();
        void setupNativePush();
      }
    }
  },

  updateUser(patch: Partial<User>) {
    const current = getAuth();
    if (!current) return;
    const updated: User = { ...current.user, ...patch };
    setAuth({ ...current, user: updated });
    set({ user: updated });
  },

  clearLoginError() { set({ loginError: null }); },
}));
