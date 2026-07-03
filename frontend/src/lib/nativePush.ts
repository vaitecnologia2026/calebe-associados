// Push nativo (Capacitor iOS/Android) — registra o token FCM no backend.
//
// O app nativo carrega este mesmo PWA remoto (app.calebe.tech). O runtime do
// Capacitor injeta `window.Capacitor` e os plugins nativos (PushNotifications,
// Preferences) na WebView. Em browser comum, window.Capacitor nao existe e
// tudo aqui vira no-op.
//
// Fluxo iOS (ver AppDelegate.swift do calebe-mobile):
//   register() -> APNs registra -> AppDelegate salva o FCM token em
//   UserDefaults sob "CapacitorStorage.fcmToken" -> aqui lemos via Preferences
//   e mandamos pro backend (POST /api/push/register-fcm), porque o token cru
//   que o plugin entrega no iOS e o APNs hex (rejeitado pelo firebase-admin).

import { api } from "./api";

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    PushNotifications?: any;
    Preferences?: any;
  };
}

function cap(): CapacitorBridge | null {
  const c = (window as any).Capacitor as CapacitorBridge | undefined;
  if (!c || !c.isNativePlatform || !c.isNativePlatform()) return null;
  return c;
}

let _started = false;

async function readFcmTokenFromPreferences(Preferences: any): Promise<string | null> {
  // O FCM token chega no AppDelegate alguns ms depois do registration do APNs.
  // Faz polling por ate ~5s.
  for (let i = 0; i < 12; i++) {
    try {
      const { value } = await Preferences.get({ key: "fcmToken" });
      if (value && typeof value === "string" && value.length > 80) return value;
    } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 450));
  }
  return null;
}

async function registerToken(token: string, platform: string): Promise<void> {
  try {
    await api.post("/api/push/register-fcm", { token, platform });
  } catch { /* best-effort */ }
}

/**
 * Idempotente: roda uma vez por sessao nativa. No-op em browser.
 * Chamar apos o usuario estar autenticado (api injeta o Bearer JWT).
 */
export async function setupNativePush(): Promise<void> {
  const c = cap();
  if (!c) return;
  // Push nativo SÓ no iOS. No Android o app inclui o plugin PushNotifications
  // mas NÃO tem google-services.json — chamar register() dispara, na thread
  // NATIVA (fora do try/catch), "Default FirebaseApp is not initialized" e
  // CRASHA o app em loop ao entrar. Mesmo guard do calebe-native-push.js.
  // NÃO remover sem antes adicionar Firebase (google-services.json) ao Android.
  const platform = c.getPlatform ? c.getPlatform() : "ios";
  if (platform !== "ios") return;
  if (_started) return;
  _started = true;

  const PushNotifications = c.Plugins?.PushNotifications;
  const Preferences = c.Plugins?.Preferences;
  if (!PushNotifications) { _started = false; return; }

  try {
    const perm = await PushNotifications.requestPermissions();
    if (perm?.receive !== "granted") return;

    // Listeners ANTES de register() — o evento 'registration' pode disparar
    // imediatamente; sem listener pronto o token se perde.
    await PushNotifications.addListener("registration", async (token: { value: string }) => {
      let actual = token?.value || "";
      if (platform === "ios" && Preferences) {
        const fcm = await readFcmTokenFromPreferences(Preferences);
        if (fcm) actual = fcm;
      }
      if (actual) await registerToken(actual, platform);
    });

    await PushNotifications.addListener("registrationError", () => { /* silent */ });

    await PushNotifications.addListener(
      "pushNotificationActionPerformed",
      (action: any) => {
        const url = action?.notification?.data?.url;
        if (url && typeof url === "string") window.location.href = url;
      },
    );

    await PushNotifications.register();
  } catch {
    _started = false;
  }
}

/** Remove o token desta instalacao no logout. Best-effort. */
export async function teardownNativePush(): Promise<void> {
  const c = cap();
  if (!c) return;
  _started = false;
  const Preferences = c.Plugins?.Preferences;
  try {
    let token: string | null = null;
    if (Preferences) {
      const { value } = await Preferences.get({ key: "fcmToken" });
      token = value || null;
    }
    await api.post("/api/push/unregister-fcm", token ? { token } : {});
  } catch { /* best-effort */ }
}
