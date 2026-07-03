/*!
 * calebe-native-push.js — registro de push nativo (Capacitor iOS/Android).
 *
 * POR QUE STANDALONE (e nao dentro do bundle React):
 *   O app.calebe.tech serve um build Vite (assets/index-*.js) cujo SOURCE EXATO
 *   nao e reproduzivel a partir do repositorio (o bundle em producao foi gerado
 *   com WIP de chat nao commitado). Recompilar arriscaria reverter logica viva.
 *   Este modulo e ADITIVO: injeta SO a logica de push, sem tocar no bundle.
 *
 * NO-OP EM BROWSER: se window.Capacitor.isNativePlatform() for falso, nada roda.
 *
 * FLUXO iOS (ver AppDelegate.swift do calebe-mobile, commit bdb5beb):
 *   register() -> APNs -> AppDelegate grava o FCM token em
 *   UserDefaults["CapacitorStorage.fcmToken"] -> aqui lemos via plugin
 *   Preferences e mandamos pro backend. O token cru que o plugin entrega no iOS
 *   e o APNs hex (rejeitado pelo firebase-admin); por isso usamos o FCM.
 *
 * AUTENTICACAO: o app guarda a sessao em localStorage["calebe_auth"] (JSON com
 *   .accessToken). Lemos de la o Bearer JWT pra autenticar o POST. Como o React
 *   roda no MESMO documento, dividimos o mesmo localStorage.
 *
 * CONTRATO BACKEND (src/routes/push.js):
 *   POST /api/push/register-fcm  { token, platform }  (requireAuth)
 *   POST /api/push/unregister-fcm { token }           (requireAuth)
 */
(function () {
  "use strict";

  // --- Apple Guideline 2.3.10: dentro do app iOS não pode haver referência a
  // plataformas de terceiros (Google Play). A Landing tem um botão "Baixar app
  // Android" (link play.google.com). Ocultamos esse link SÓ quando rodando no
  // app iOS nativo; no navegador e no Android o botão permanece normal.
  (function hideThirdPartyStoreLinks() {
    try {
      var c = window.Capacitor;
      var isNative = c && typeof c.isNativePlatform === "function" && c.isNativePlatform();
      var platform = c && typeof c.getPlatform === "function" ? c.getPlatform() : "";
      if (!isNative || platform !== "ios") return;
      var css = 'a[href*="play.google.com"]{display:none !important;}';
      var style = document.createElement("style");
      style.setAttribute("data-calebe-ios-hide", "1");
      style.appendChild(document.createTextNode(css));
      (document.head || document.documentElement).appendChild(style);
    } catch (e) { /* no-op */ }
  })();

  var AUTH_KEY = "calebe_auth";
  var started = false;
  var lastAuthedUserId = null;

  function cap() {
    var c = window.Capacitor;
    if (!c || typeof c.isNativePlatform !== "function" || !c.isNativePlatform()) return null;
    return c;
  }

  function bearer() {
    try {
      var raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      var j = JSON.parse(raw);
      return j && j.accessToken ? j.accessToken : null;
    } catch (e) { return null; }
  }

  function userIdFromJwt(tok) {
    try { return JSON.parse(atob(tok.split(".")[1])).sub || null; } catch (e) { return null; }
  }

  function post(path, body) {
    var tok = bearer();
    if (!tok) return Promise.resolve();
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
      body: JSON.stringify(body || {}),
    }).catch(function () { /* best-effort */ });
  }

  // O FCM token chega no AppDelegate alguns ms depois do registration do APNs.
  // Faz polling por ~5s no Preferences (chave "fcmToken").
  function readFcmToken(Preferences) {
    var attempts = 0;
    return new Promise(function (resolve) {
      function tick() {
        attempts++;
        Preferences.get({ key: "fcmToken" }).then(function (r) {
          var v = r && r.value;
          if (v && typeof v === "string" && v.length > 80) return resolve(v);
          if (attempts >= 12) return resolve(null);
          setTimeout(tick, 450);
        }).catch(function () {
          if (attempts >= 12) return resolve(null);
          setTimeout(tick, 450);
        });
      }
      tick();
    });
  }

  function setup() {
    var c = cap();
    if (!c || started) return;
    var Plugins = c.Plugins || {};
    var Push = Plugins.PushNotifications;
    var Preferences = Plugins.Preferences;
    var platform = (typeof c.getPlatform === "function") ? c.getPlatform() : "ios";
    // Push só é suportado no iOS (Firebase/APNs configurados lá). O app Android
    // tem o plugin PushNotifications mas NÃO tem google-services.json, então
    // chamar register() dispara "Default FirebaseApp is not initialized" e o app
    // nativo Android quebra em loop. Registramos push SOMENTE no iOS.
    if (platform !== "ios") return;
    if (!Push) return;
    started = true;

    Push.requestPermissions().then(function (perm) {
      if (!perm || perm.receive !== "granted") { started = false; return; }

      // Listeners ANTES do register() — 'registration' pode disparar na hora.
      Push.addListener("registration", function (token) {
        var actual = (token && token.value) || "";
        var done = function (val) { if (val) post("/api/push/register-fcm", { token: val, platform: platform }); };
        if (platform === "ios" && Preferences) {
          readFcmToken(Preferences).then(function (fcm) { done(fcm || actual); });
        } else {
          done(actual);
        }
      });
      Push.addListener("registrationError", function () { /* silent */ });
      Push.addListener("pushNotificationActionPerformed", function (a) {
        var url = a && a.notification && a.notification.data && a.notification.data.url;
        if (url && typeof url === "string") window.location.href = url;
      });

      Push.register();
    }).catch(function () { started = false; });
  }

  function teardown() {
    var c = cap();
    if (!c) return;
    started = false;
    var Preferences = (c.Plugins || {}).Preferences;
    if (Preferences) {
      Preferences.get({ key: "fcmToken" }).then(function (r) {
        post("/api/push/unregister-fcm", r && r.value ? { token: r.value } : {});
      }).catch(function () { post("/api/push/unregister-fcm", {}); });
    } else {
      post("/api/push/unregister-fcm", {});
    }
  }

  // Sem hooks no bundle React: observamos a sessao via localStorage.
  // - autenticou (apareceu accessToken / mudou de usuario) -> setup()
  // - deslogou (sumiu accessToken) -> teardown()
  function pollAuth() {
    if (!cap()) return; // no-op em browser: nem instala o intervalo abaixo
    var tok = bearer();
    var uid = tok ? userIdFromJwt(tok) : null;
    if (uid && uid !== lastAuthedUserId) {
      lastAuthedUserId = uid;
      setup();
    } else if (!uid && lastAuthedUserId) {
      lastAuthedUserId = null;
      teardown();
    }
  }

  if (cap()) {
    pollAuth();
    setInterval(pollAuth, 2000);
  }
})();
