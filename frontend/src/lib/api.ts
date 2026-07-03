// API client · portado de window.API do index.html monolítico (linhas 8991-9049)
//   - Bearer JWT injetado automaticamente
//   - Auto-refresh em 401 (1 tentativa, via cookie httpOnly `rt` + fallback body)
//   - Persistência em localStorage["calebe_auth"] (inclui refreshToken como fallback)
//   - Retorna JSON parseado; lança ApiError em status ≥ 400
//
// Decisões mantidas do monólito:
//   - credentials:"include" em TODAS as chamadas (refresh cookie precisa)
//   - Mesmo helper serve para FormData (não seta Content-Type, browser cuida)
//
// 2026-06-25 · Estratégia para "nunca pedir senha de novo":
//   1. Access JWT dura 7 dias (vinha de 8h). Cobre uma semana de uso sem refresh.
//   2. Refresh token persistido EM AMBOS cookie httpOnly E localStorage. Quando o
//      cookie é dropado (Safari ITP, WKWebView, PWA standalone), o body do refresh
//      cobre. Trade-off conhecido: refresh em localStorage é vulnerável a XSS —
//      aceitamos pois o accessToken já está no mesmo lugar.
//   3. Boot proativo: se o JWT já expirou ou expira em <2min ao carregar a página,
//      faz refresh ANTES da primeira chamada, evitando 401 visível.

import { ApiError } from "@/types/api";
import type { AuthResponse } from "@/types/auth";
import { capStorageGet, capStorageRemove, capStorageSet, isCapacitorNative } from "./capStorage";

// Resolução de API_BASE: em dev usa VITE_API_BASE; em prod (build) usa "" → same-origin (nginx proxy /api/*)
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(window.location.hostname) ? "http://localhost:4000" : "");

const AUTH_KEY = "calebe_auth";

// Estado in-module (privado). Acesso via getAuth/setAuth/clearAuth.
let _auth: AuthResponse | null = loadAuthFromStorage();

// 2026-06-29 · Rehidratação async: se rodando em Capacitor nativo (Android
// WebView / iOS WKWebView) E o localStorage está vazio (= WebView limpou
// silenciosamente entre kills do app), tenta restaurar do storage nativo
// (SharedPreferences / UserDefaults). callers async (call, restoreSession)
// devem aguardar _hydrating antes de tomar decisões sobre o estado de auth.
let _hydrating: Promise<void> | null = null;
if (!_auth && isCapacitorNative()) {
  _hydrating = (async () => {
    try {
      const raw = await capStorageGet(AUTH_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AuthResponse;
        if (parsed?.accessToken) {
          _auth = parsed;
          // Re-popula o localStorage local pra próximos boots não precisarem rehidratação.
          try { localStorage.setItem(AUTH_KEY, raw); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    _hydrating = null;
  })();
}

// 2026-06-25 · Boot proativo: se o JWT já está perto de expirar (ou expirou),
// dispara refresh ANTES de qualquer chamada. Bloqueia o call() até resolver
// pra evitar requests com 401 e re-tries. _bootRefresh é a promise dessa
// primeira renovação; null quando não precisa esperar.
let _bootRefresh: Promise<void> | null = null;
function maybeScheduleBootRefresh() {
  if (!_auth?.accessToken) return;
  if (isAccessTokenExpiringSoon(_auth.accessToken, 120_000)) {
    _bootRefresh = (async () => {
      try { await refresh(); }
      finally { _bootRefresh = null; }
    })();
  } else {
    setTimeout(() => { if (_auth?.accessToken) scheduleProactiveRefresh(_auth.accessToken); }, 0);
  }
}
maybeScheduleBootRefresh();
// Após rehidratação async (Capacitor), reavalia se precisa refresh.
if (_hydrating) {
  _hydrating.then(() => { if (!_bootRefresh) maybeScheduleBootRefresh(); });
}

/** Aguardar rehidratação Capacitor (se em curso) antes de ler getAuth(). */
export function awaitAuthHydration(): Promise<void> {
  return _hydrating ?? Promise.resolve();
}

function loadAuthFromStorage(): AuthResponse | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as AuthResponse) : null;
  } catch {
    return null;
  }
}

export function getAuth(): AuthResponse | null {
  return _auth;
}

export function setAuth(auth: AuthResponse): void {
  // 2026-06-25 · Backend opcionalmente devolve novo refreshToken (rotação) no
  // body do /login e /refresh. Mantemos o anterior se o backend não devolveu
  // — assim quem fizer só `setAuth({ accessToken, user })` em outros lugares
  // não perde o refresh já existente.
  const merged: AuthResponse = {
    ...auth,
    refreshToken: auth.refreshToken ?? _auth?.refreshToken,
  };
  _auth = merged;
  const serialized = JSON.stringify(merged);
  try { localStorage.setItem(AUTH_KEY, serialized); } catch { /* quota cheia, ignore */ }
  // 2026-06-29 · Espelha no storage nativo (Capacitor Preferences) — único
  // storage que sobrevive a kill do app Android/iOS de forma confiável.
  capStorageSet(AUTH_KEY, serialized);
  scheduleProactiveRefresh(merged.accessToken);
}

export function clearAuth(): void {
  _auth = null;
  try { localStorage.removeItem(AUTH_KEY); } catch { /* ignore */ }
  capStorageRemove(AUTH_KEY);
  stopProactiveRefresh();
}

// True se o JWT já expirou OU expira em <thresholdMs. Fail-safe (true) em token malformado.
function isAccessTokenExpiringSoon(accessToken: string, thresholdMs: number): boolean {
  try {
    const payload = JSON.parse(atob(accessToken.split(".")[1])) as { exp?: number };
    if (!payload?.exp) return true;
    return payload.exp * 1000 - Date.now() < thresholdMs;
  } catch { return true; }
}

// 2026-06-08 · Refresh pró-ativo. Lê o `exp` do JWT atual e dispara um refresh
// 2 minutos ANTES de expirar — assim o usuário nunca pega um 401 enquanto
// estiver de aba aberta. Resolve a queixa "tenho que logar de novo toda vez".
// Se o refresh falhar (cookie dropped por Safari ITP, etc), o próximo request
// ainda cai no fluxo legacy de auto-refresh em 401.
let _proactiveTimer: ReturnType<typeof setTimeout> | null = null;
function stopProactiveRefresh(): void {
  if (_proactiveTimer) { clearTimeout(_proactiveTimer); _proactiveTimer = null; }
}
function scheduleProactiveRefresh(accessToken: string): void {
  stopProactiveRefresh();
  try {
    const payload = JSON.parse(atob(accessToken.split(".")[1])) as { exp?: number };
    if (!payload?.exp) return;
    const msUntilExpire = payload.exp * 1000 - Date.now();
    // refresca 2min antes; mínimo 30s pra evitar loop tight
    const delay = Math.max(msUntilExpire - 120_000, 30_000);
    _proactiveTimer = setTimeout(() => { void refresh(); }, delay);
  } catch { /* token malformado · ignora */ }
}

// Refresh deduplication: chamadas concorrentes em 401 compartilham a mesma promise.
//
// 2026-06-29 · Resultado do refresh é tipado pra distinguir falha REAL (401 =
// refresh token foi revogado/expirou — deve derrubar a sessão) de falha
// TRANSIENTE (network error, 5xx, timeout — NÃO deve derrubar a sessão).
// Antes, qualquer erro virava `null` e o caller chamava clearAuth(), causando
// relogins frequentes em conexão flaky (iOS WKWebView troca de rede,
// background/foreground). 119 corretores com média 5.5 logins em 4 dias
// (2026-06-25 a 2026-06-29) — confirmamos via auditEvent.
type RefreshResult =
  | { kind: "ok"; accessToken: string }
  | { kind: "invalid_refresh" } // 401/403 do /refresh — sessão acabou de verdade
  | { kind: "transient_error" }; // 5xx, network error, timeout — NÃO derrubar sessão

let _refreshing: Promise<RefreshResult> | null = null;

async function refresh(): Promise<RefreshResult> {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    try {
      // Sempre envia refreshToken do localStorage no body. Backend prefere o
      // cookie httpOnly `rt` se vier; usa o body como fallback quando o cookie
      // foi dropado (Safari ITP, WKWebView, modo privado, PWA).
      const fallbackToken = _auth?.refreshToken ?? null;
      const r = await fetch(API_BASE + "/api/auth/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackToken ? { refreshToken: fallbackToken } : {}),
      });
      if (r.ok) {
        const j = (await r.json()) as AuthResponse;
        setAuth(j);
        return { kind: "ok", accessToken: j.accessToken } as const;
      }
      // 401/403 = refresh token de fato inválido (revogado/expirado). Resto = transiente.
      if (r.status === 401 || r.status === 403) {
        return { kind: "invalid_refresh" } as const;
      }
      return { kind: "transient_error" } as const;
    } catch {
      // Network error / timeout / CORS — sempre transiente.
      return { kind: "transient_error" } as const;
    } finally {
      // Libera lock no próximo tick pra suportar requests concorrentes
      setTimeout(() => { _refreshing = null; }, 0);
    }
  })();
  return _refreshing;
}

interface CallOptions {
  headers?: Record<string, string>;
  skipAuth?: boolean;
  signal?: AbortSignal;
  _retried?: boolean;
}

async function call<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts: CallOptions = {},
): Promise<T> {
  // 2026-06-29 · Espera rehidratação async do storage nativo (Capacitor)
  // antes de qualquer decisão. Sem isso, a primeira chamada pode rodar como
  // "deslogado" enquanto o Preferences ainda está sendo lido — derrubaria a
  // sessão no boot do app nativo.
  if (_hydrating && !opts.skipAuth) {
    await _hydrating;
  }
  // 2026-06-25 · Se o boot detectou JWT expirado/expirando, espera o refresh
  // proativo antes de fazer a primeira chamada. Evita 401 + retry visível.
  if (_bootRefresh && !opts.skipAuth) {
    await _bootRefresh.catch(() => null);
  }

  const url = path.startsWith("http") ? path : API_BASE + path;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers ?? {}),
  };

  let bodyOut: BodyInit | undefined;
  if (body instanceof FormData) {
    bodyOut = body;
    // Não setar Content-Type · browser cria boundary multipart
  } else if (body != null) {
    headers["Content-Type"] = "application/json";
    bodyOut = JSON.stringify(body);
  }

  if (_auth?.accessToken && !opts.skipAuth) {
    headers.Authorization = "Bearer " + _auth.accessToken;
  }

  let res = await fetch(url, {
    method,
    headers,
    credentials: "include",
    body: bodyOut,
    signal: opts.signal,
  });

  // Auto-refresh 401 (1 tentativa)
  if (res.status === 401 && !opts.skipAuth && !opts._retried) {
    const r2 = await refresh();
    if (r2.kind === "ok") {
      headers.Authorization = "Bearer " + r2.accessToken;
      res = await fetch(url, {
        method,
        headers,
        credentials: "include",
        body: bodyOut,
        signal: opts.signal,
      });
    } else if (r2.kind === "invalid_refresh") {
      // Refresh token de fato inválido (revogado/expirado). Sessão acabou.
      clearAuth();
    } else {
      // Erro transiente (network/5xx/timeout). NÃO derruba sessão — o caller
      // recebe o 401 e pode mostrar erro, o user pode tentar de novo. Próxima
      // chamada pode bater num servidor saudável e renovar.
    }
  }

  const ct = res.headers.get("content-type") ?? "";
  let data: unknown = null;
  if (ct.includes("application/json")) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => "");
  }

  if (!res.ok) {
    const msg = (data as { error?: string; message?: string })?.error
      ?? (data as { error?: string; message?: string })?.message
      ?? `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, data);
  }

  return data as T;
}

export const api = {
  get:   <T = unknown>(p: string, opts?: CallOptions) => call<T>("GET",    p, undefined, opts),
  post:  <T = unknown>(p: string, b?: unknown, opts?: CallOptions) => call<T>("POST",   p, b, opts),
  patch: <T = unknown>(p: string, b?: unknown, opts?: CallOptions) => call<T>("PATCH",  p, b, opts),
  put:   <T = unknown>(p: string, b?: unknown, opts?: CallOptions) => call<T>("PUT",    p, b, opts),
  del:   <T = unknown>(p: string, opts?: CallOptions) => call<T>("DELETE", p, undefined, opts),
  refresh,
  isAuthed: () => !!_auth?.accessToken,
  me:    <T = unknown>() => call<T>("GET", "/api/auth/me"),
};

export type ApiClient = typeof api;
