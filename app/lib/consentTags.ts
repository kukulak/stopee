/**
 * Carga de Google Analytics y del píxel de Meta, solo en el navegador y solo con permiso.
 *
 * Antes estos códigos iban dentro del HTML para todos los visitantes. Ahora se cargan desde aquí,
 * después de que la página ya arrancó, y únicamente si la persona aceptó la categoría que les toca.
 * Se hace con código propio (no con un bloque de texto en el HTML) para no depender de scripts en
 * línea y para no tocar el <head> mientras React lo está armando.
 */

type GtagFn = (...args: unknown[]) => void;
type FbqFn = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  loaded: boolean;
  version: string;
  push: unknown;
};

type TtqStub = unknown[] & {
  [key: string]: unknown;
  _i?: Record<string, unknown[] & { _u?: string }>;
  _t?: Record<string, number>;
  _o?: Record<string, unknown>;
};

declare global {
  interface Window {
    ttq?: TtqStub;
    TiktokAnalyticsObject?: string;
    dataLayer?: unknown[];
    gtag?: GtagFn;
    fbq?: FbqFn;
    _fbq?: FbqFn;
  }
}

function appendScript(src: string, marker: string) {
  if (document.querySelector(`script[data-stopee-tag="${marker}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  script.dataset.stopeeTag = marker;
  document.head.appendChild(script);
}

/** Google Analytics. Si también hay permiso de marketing se le avisa para que lo use en publicidad. */
export function loadGoogleTag(measurementId: string, { marketing }: { marketing: boolean }) {
  const adState = marketing ? "granted" : "denied";

  if (window.gtag) {
    window.gtag("consent", "update", { ad_storage: adState, ad_user_data: adState, ad_personalization: adState });
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: adState,
    ad_user_data: adState,
    ad_personalization: adState,
  });
  window.gtag("js", new Date());
  window.gtag("config", measurementId);
  appendScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`, "google");
}

/** Píxel de Meta (Facebook e Instagram). */
export function loadMetaPixel(pixelId: string) {
  if (window.fbq) return;

  const fbq = function (...args: unknown[]) {
    const self = window.fbq as FbqFn;
    if (self.callMethod) self.callMethod(...args);
    else self.queue.push(args);
  } as unknown as FbqFn;
  window.fbq = fbq;
  if (!window._fbq) window._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];

  fbq("init", pixelId);
  fbq("track", "PageView");
  appendScript("https://connect.facebook.net/en_US/fbevents.js", "meta");
}

const TIKTOK_METHODS = [
  "page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group",
  "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent",
];

/** Píxel de TikTok. Misma estructura que el código oficial: una cola que se vacía cuando carga su script. */
export function loadTikTokPixel(pixelId: string) {
  if (window.ttq) return;

  const scriptUrl = "https://analytics.tiktok.com/i18n/pixel/events.js";
  const ttq = [] as unknown as TtqStub;
  window.TiktokAnalyticsObject = "ttq";
  window.ttq = ttq;

  const defer = (target: Record<string, unknown> & unknown[], method: string) => {
    target[method] = (...args: unknown[]) => {
      target.push([method, ...args]);
    };
  };
  for (const method of TIKTOK_METHODS) defer(ttq, method);

  ttq.instance = (id: string) => {
    const instance = (ttq._i?.[id] ?? []) as unknown[] & Record<string, unknown>;
    for (const method of TIKTOK_METHODS) defer(instance, method);
    return instance;
  };
  ttq.load = (id: string, options?: unknown) => {
    ttq._i = ttq._i || {};
    ttq._i[id] = [];
    ttq._i[id]._u = scriptUrl;
    ttq._t = ttq._t || {};
    ttq._t[id] = Date.now();
    ttq._o = ttq._o || {};
    ttq._o[id] = options || {};
  };

  (ttq.load as (id: string) => void)(pixelId);
  (ttq.page as () => void)();
  appendScript(`${scriptUrl}?sdkid=${encodeURIComponent(pixelId)}&lib=ttq`, "tiktok");
}

/**
 * Borra las cookies que Google, Meta y TikTok dejaron en este sitio (_ga, _ga_XXXX, _gid, _gat, _fbp, _fbc, _ttp, _tt_*).
 * Un navegador solo deja borrar una cookie si se indica el mismo dominio con el que se creó, y
 * Google la crea en el dominio principal, así que se intentan todas las variantes.
 */
export function clearThirdPartyCookies() {
  const names = document.cookie
    .split(";")
    .map((part) => part.split("=")[0].trim())
    .filter((name) => /^(_ga|_gid|_gat|_gcl_|_fbp$|_fbc$|_ttp$|_tt_|ttclid$)/.test(name));
  if (names.length === 0) return;

  const labels = location.hostname.split(".");
  const domains: (string | undefined)[] = [undefined];
  for (let i = 0; i < labels.length - 1; i++) domains.push(`.${labels.slice(i).join(".")}`);

  for (const name of names) {
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT${domain ? `; Domain=${domain}` : ""}`;
    }
  }
}
