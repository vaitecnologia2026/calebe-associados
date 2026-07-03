// Capacitor Preferences wrapper — fallback nativo pro localStorage.
//
// Por que existe: o localStorage do WebView Capacitor (Android WebView + iOS
// WKWebView) é tecnicamente "scoped" pela origem (https://app.calebe.tech) e
// deveria persistir entre kills do app. Na prática, há casos reportados de
// limpeza silenciosa (ex: Android limpa data do WebView se ficar sem memória,
// iOS pode descartar storage em background pressure, app entra em "saved
// state" e perde DOM storage). Isso causava ~5.5 logins por user em 4 dias
// (analisado em 29/06 — 119 corretores, intervalo mediano 30-100min entre
// re-logins consecutivos).
//
// Solução: dual write. Toda escrita em localStorage é também espelhada em
// Capacitor Preferences (storage nativo: SharedPreferences no Android,
// UserDefaults no iOS). Esses NUNCA são limpos pelo sistema enquanto o app
// estiver instalado.
//
// No boot: se localStorage vazio MAS Preferences tem dados, re-hidrata. O
// próximo restoreSession() encontra o auth e segue sem pedir login.
//
// No-op em browser comum (sem Capacitor). Best-effort: erros são engolidos
// pra não derrubar o fluxo síncrono do localStorage.

interface CapBridge {
  isNativePlatform?: () => boolean;
  Plugins?: {
    Preferences?: {
      get: (opts: { key: string }) => Promise<{ value: string | null }>;
      set: (opts: { key: string; value: string }) => Promise<void>;
      remove: (opts: { key: string }) => Promise<void>;
    };
  };
}

function getPreferences() {
  const c = (window as unknown as { Capacitor?: CapBridge }).Capacitor;
  if (!c?.isNativePlatform || !c.isNativePlatform()) return null;
  return c.Plugins?.Preferences ?? null;
}

export function isCapacitorNative(): boolean {
  return getPreferences() !== null;
}

export async function capStorageGet(key: string): Promise<string | null> {
  const p = getPreferences();
  if (!p) return null;
  try {
    const { value } = await p.get({ key });
    return value ?? null;
  } catch {
    return null;
  }
}

export function capStorageSet(key: string, value: string): void {
  const p = getPreferences();
  if (!p) return;
  // Fire-and-forget. Erros são engolidos: localStorage já foi escrito sync.
  p.set({ key, value }).catch(() => {});
}

export function capStorageRemove(key: string): void {
  const p = getPreferences();
  if (!p) return;
  p.remove({ key }).catch(() => {});
}
