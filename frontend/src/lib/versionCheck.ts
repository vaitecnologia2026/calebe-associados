// versionCheck.ts · 2026-07-02 · Fim do "manda o corretor dar F5"
//
// Compara o bundle carregado com o bundle publicado (index.html é no-cache no
// nginx). Quando sai deploy novo: banner fixo "Nova versão disponível" com
// botão Atualizar. Sem auto-reload (não perder mensagem sendo digitada).
// Checa: a cada 4min + ao voltar o foco/visibilidade (throttle 60s).
// QA: window.__vchkTest() força o banner.

let _current: string | null = null;
let _lastCheck = 0;
let _shown = false;

function currentBundle(): string | null {
  const s = document.querySelector('script[src*="/assets/index-"]');
  const src = s?.getAttribute("src") || "";
  const m = src.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
  return m ? m[1] : null;
}

async function publishedBundle(): Promise<string | null> {
  try {
    const r = await fetch(`/index.html?vchk=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function showBanner(): void {
  if (_shown) return;
  _shown = true;
  const el = document.createElement("div");
  el.id = "vchk-banner";
  el.setAttribute("role", "status");
  el.style.cssText = [
    "position:fixed", "left:12px", "right:12px",
    "bottom:calc(12px + env(safe-area-inset-bottom, 0px))",
    "z-index:99999", "display:flex", "align-items:center", "gap:12px",
    "background:#0f172a", "border:1px solid rgba(201,162,75,.6)",
    "border-radius:14px", "padding:12px 16px",
    "box-shadow:0 8px 30px rgba(0,0,0,.45)",
    "font-family:inherit", "color:#f5efe0", "font-size:14px",
  ].join(";");
  el.innerHTML =
    '<span style="flex:1;min-width:0">✨ Nova versão do app disponível</span>' +
    '<button id="vchk-go" style="flex:none;background:#C9A24B;color:#1a1206;border:0;border-radius:10px;padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer">Atualizar</button>';
  document.body.appendChild(el);
  document.getElementById("vchk-go")?.addEventListener("click", async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
    } catch { /* best-effort */ }
    location.reload();
  });
}

async function check(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - _lastCheck < 60_000) return; // throttle
  _lastCheck = now;
  if (!_current) _current = currentBundle();
  if (!_current) return; // não conseguiu identificar (dev?) — não incomoda
  const pub = await publishedBundle();
  if (pub && pub !== _current) showBanner();
}

export function initVersionCheck(): void {
  if ((window as any).__vchkInit) return;
  (window as any).__vchkInit = true;
  _current = currentBundle();
  setInterval(() => { if (!document.hidden) void check(); }, 4 * 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void check(); });
  window.addEventListener("focus", () => void check());
  (window as any).__vchkTest = showBanner; // QA manual
}
