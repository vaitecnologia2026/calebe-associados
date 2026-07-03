// sw.js · 2026-07-02 · Service worker "kill-switch + push"
//
// HISTÓRICO: o app registra /sw.js desde o monólito antigo, mas o arquivo não
// existia mais no deploy — dispositivos com o SW legado instalado ficavam com
// um worker ZUMBI servindo cache velho pra sempre (causa raiz do "corretor
// precisa dar F5 / app velho"). Este worker substitui o zumbi:
//   1. assume imediatamente (skipWaiting + clients.claim)
//   2. APAGA todos os caches legados
//   3. NÃO tem handler de fetch → rede sempre, nunca mais cache stale
//   4. mantém handlers de push/notificação (web push VAPID)

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// --- Web push (VAPID) ---
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Calebe", body: event.data && event.data.text() }; }
  const title = data.title || "Calebe Associados";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/icon-192.png",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { c.navigate(url); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
