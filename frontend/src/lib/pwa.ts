// PWA · registro do Service Worker + push notifications + diagnose
// Portado de linhas 75-219 do index.html

import { api } from "./api";

interface PwaState {
  evt: BeforeInstallPromptEvent | null;
  registration: ServiceWorkerRegistration | null;
  installed: boolean;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const _state: PwaState = { evt: null, registration: null, installed: false };

export function initPwa(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    _state.evt = e as BeforeInstallPromptEvent;
    document.dispatchEvent(new CustomEvent("pwa:installable"));
  });

  window.addEventListener("appinstalled", () => {
    _state.installed = true;
    _state.evt = null;
    document.dispatchEvent(new CustomEvent("pwa:installed"));
  });

  if ("serviceWorker" in navigator && window.location.protocol === "https:") {
    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        _state.registration = reg;
        document.dispatchEvent(new CustomEvent("pwa:sw-registered", { detail: { scope: reg.scope } }));
      } catch (err) {
        document.dispatchEvent(new CustomEvent("pwa:sw-error", {
          detail: { message: err instanceof Error ? err.message : String(err) },
        }));
      }
    });
  }
}

export async function diagnose() {
  const out = {
    protocol: window.location.protocol,
    isHttps: window.location.protocol === "https:" || window.location.hostname === "localhost",
    isStandalone: window.matchMedia?.("(display-mode: standalone)").matches
      || (navigator as any).standalone === true,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    notificationPermission: "Notification" in window ? Notification.permission : "unsupported",
    manifestLink: !!document.querySelector("link[rel=manifest]"),
    manifestStatus: null as number | string | null,
    swStatus: "n/a" as string,
    swScope: null as string | null,
    swController: !!(navigator.serviceWorker?.controller),
    pushSubscribed: false,
    installPromptAvailable: !!_state.evt,
    ua: navigator.userAgent,
    platform: detectPlatform(),
  };

  try {
    const r = await fetch("/manifest.webmanifest", { cache: "no-store" });
    out.manifestStatus = r.status;
  } catch { out.manifestStatus = "fetch_failed"; }

  if ("serviceWorker" in navigator) {
    try {
      const reg = _state.registration ?? await navigator.serviceWorker.getRegistration("/");
      if (reg) {
        out.swScope = reg.scope;
        if (reg.active) out.swStatus = "active";
        else if (reg.installing) out.swStatus = "installing";
        else if (reg.waiting) out.swStatus = "waiting";
        else out.swStatus = "registered";
        try {
          const sub = await reg.pushManager.getSubscription();
          out.pushSubscribed = !!sub;
        } catch { /* ignore */ }
      } else {
        out.swStatus = "not_registered";
      }
    } catch (e) {
      out.swStatus = "error:" + (e instanceof Error ? e.message : String(e));
    }
  }

  return out;
}

export async function promptInstall(): Promise<{ ok: boolean; outcome?: string; reason?: string }> {
  if (!_state.evt) return { ok: false, reason: "no_event" };
  try {
    await _state.evt.prompt();
    const choice = await _state.evt.userChoice;
    _state.evt = null;
    return { ok: choice.outcome === "accepted", outcome: choice.outcome };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function clearCaches(): Promise<{ ok: boolean; cleared: number }> {
  let cleared = 0;
  if ("caches" in window) {
    const keys = await caches.keys();
    for (const k of keys) { if (await caches.delete(k)) cleared++; }
  }
  if (navigator.serviceWorker) {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) { try { await r.unregister(); } catch { /* ignore */ } }
  }
  return { ok: true, cleared };
}

// Push subscribe · usa VAPID key do backend
export async function subscribePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!("Notification" in window)) return { ok: false, reason: "unsupported" };
  if (Notification.permission === "denied") return { ok: false, reason: "denied" };
  if (Notification.permission !== "granted") {
    const p = await Notification.requestPermission();
    if (p !== "granted") return { ok: false, reason: p };
  }
  const reg = _state.registration ?? await navigator.serviceWorker.getRegistration("/");
  if (!reg) return { ok: false, reason: "no_sw" };

  const keyRes = await fetch("/api/push/vapid-public-key", { cache: "no-store" });
  if (!keyRes.ok) return { ok: false, reason: "no_vapid" };
  const { publicKey } = await keyRes.json();

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });

  await api.post("/api/push/subscribe", sub);
  return { ok: true };
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function detectPlatform(): "android" | "ios" | "macos" | "windows" | "web" {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Macintosh/i.test(ua)) return "macos";
  if (/Windows/i.test(ua)) return "windows";
  return "web";
}
