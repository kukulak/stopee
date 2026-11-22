import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { CloseIcon } from "~/components/ui/Icons";

const HIDDEN_PREFIXES = ["/admin", "/cuenta"];
const COOKIE_NAME = "stopee_exit_seen";

// Zona superior (px desde el borde de la ventana) donde evaluamos la trayectoria,
// ventana de muestras, velocidad mínima hacia arriba (px/ms) y cuánto
// proyectamos adelante (ms).
const TOP_ZONE_PX = 90;
const TRAJECTORY_WINDOW_MS = 150;
const MIN_UPWARD_VELOCITY = 0.6;
const PROJECTION_MS = 80;

type Config = {
  isEnabled: boolean;
  title: string;
  message: string;
  imageUrl: string;
  ctaText: string;
  ctaHref: string;
  showOnHome: boolean;
  showOnTienda: boolean;
  showOnBlog: boolean;
  snoozeDays: number;
};

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setSnoozeCookie(days: number) {
  const expires = new Date(Date.now() + days * 86400000).toUTCString();
  document.cookie = `${COOKIE_NAME}=1; expires=${expires}; path=/; SameSite=Lax`;
}

/** Detecta que alguien está a punto de irse (el cursor sube rápido hacia la barra del navegador) y muestra el popup, como mucho una vez cada `snoozeDays`. En dispositivos sin mouse no se muestra. */
export function ExitIntentPopup({ config }: { config: Config }) {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);

  const scopeAllowsPath =
    (config.showOnHome && pathname === "/") ||
    (config.showOnTienda && pathname.startsWith("/tienda")) ||
    (config.showOnBlog && pathname.startsWith("/blog"));

  const eligible =
    config.isEnabled &&
    Boolean(config.message) &&
    scopeAllowsPath &&
    !HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  useEffect(() => {
    if (!eligible) return;
    if (getCookie(COOKIE_NAME)) return;

    let shown = false;
    const trigger = () => {
      if (shown) return;
      shown = true;
      setVisible(true);
      setSnoozeCookie(config.snoozeDays);
    };

    // Solo con mouse: sin cursor no hay una señal confiable de "se va a ir",
    // y disparar por scroll interrumpe a quien está leyendo.
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    // Trayectoria del cursor: guardamos las últimas posiciones (~150 ms) y
    // disparamos solo si va subiendo rápido hacia el borde superior, que es
    // por donde se llega a la barra de pestañas/direcciones. Extrapolamos
    // unos ms hacia adelante para anticiparnos a que cruce el borde; así,
    // quien sube a un link del menú y frena antes del borde no lo activa.
    let samples: { y: number; t: number }[] = [];

    const onMouseMove = (e: MouseEvent) => {
      const now = performance.now();
      samples.push({ y: e.clientY, t: now });
      samples = samples.filter((s) => now - s.t <= TRAJECTORY_WINDOW_MS);
      if (samples.length < 3 || e.clientY > TOP_ZONE_PX) return;

      const first = samples[0];
      const elapsed = now - first.t;
      if (elapsed <= 0) return;
      const velocityY = (e.clientY - first.y) / elapsed; // px/ms, negativo = subiendo
      const projectedY = e.clientY + velocityY * PROJECTION_MS;
      if (velocityY <= -MIN_UPWARD_VELOCITY && projectedY <= 0) trigger();
    };

    // Respaldo: el cursor ya salió por arriba de la ventana (p. ej. un movimiento
    // tan rápido que no alcanzó a registrar muestras suficientes).
    const onMouseOut = (e: MouseEvent) => {
      if (e.clientY <= 0 && !e.relatedTarget) trigger();
    };

    document.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseout", onMouseOut);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseout", onMouseOut);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, pathname]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-carbon/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={() => setVisible(false)}
    >
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Cerrar"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-carbon shadow"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
        {config.imageUrl && (
          <img src={config.imageUrl} alt="" className="h-40 w-full object-cover" loading="lazy" decoding="async" />
        )}
        <div className="p-6 text-center">
          {config.title && (
            <p className="font-display text-xl font-black text-carbon">{config.title}</p>
          )}
          <p className="mt-2 text-sm text-carbon/70">{config.message}</p>
          {config.ctaText && (
            <a
              href={config.ctaHref}
              className="mt-5 inline-block min-h-11 rounded-full bg-lima px-7 py-2.5 text-sm font-bold text-carbon transition-transform hover:scale-105"
            >
              {config.ctaText}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
