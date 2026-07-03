// Tracking lazy · GA4 + Facebook Pixel + GTM
// Portado de linhas 38-68 do index.html · só carrega se IDs configurados via env

interface TrackingConfig {
  gaId?: string;
  fbPixelId?: string;
  gtmId?: string;
}

let _initialized = false;

export function initTracking(): void {
  if (_initialized) return;
  _initialized = true;

  const cfg: TrackingConfig = {
    gaId: import.meta.env.VITE_GA_ID as string | undefined,
    fbPixelId: import.meta.env.VITE_FB_PIXEL_ID as string | undefined,
    gtmId: import.meta.env.VITE_GTM_ID as string | undefined,
  };

  if (cfg.gaId) loadGa4(cfg.gaId);
  if (cfg.fbPixelId) loadFbPixel(cfg.fbPixelId);
  if (cfg.gtmId) loadGtm(cfg.gtmId);
}

function loadGa4(id: string): void {
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + id;
  document.head.appendChild(s);
  (window as any).dataLayer = (window as any).dataLayer ?? [];
  (window as any).gtag = function (...args: unknown[]) { (window as any).dataLayer.push(args); };
  (window as any).gtag("js", new Date());
  (window as any).gtag("config", id);
}

function loadFbPixel(id: string): void {
  // Snippet oficial Meta (linha 59 do monólito)
  /* eslint-disable */
  // @ts-ignore
  (function(f:any,b:any,e:any,v:any,n?:any,t?:any,s?:any){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)})(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  // @ts-ignore
  (window as any).fbq("init", id);
  // @ts-ignore
  (window as any).fbq("track", "PageView");
  /* eslint-enable */
}

function loadGtm(id: string): void {
  /* eslint-disable */
  // @ts-ignore
  (function(w:any,d:any,s:any,l:any,i:any){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',id);
  /* eslint-enable */
}

/**
 * Wrapper genérico de evento. Envia pra todos os providers ativos.
 */
export function track(event: string, props?: Record<string, unknown>): void {
  if ((window as any).gtag) {
    (window as any).gtag("event", event, props ?? {});
  }
  if ((window as any).fbq) {
    (window as any).fbq("trackCustom", event, props ?? {});
  }
}
