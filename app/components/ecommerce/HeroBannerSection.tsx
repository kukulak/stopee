import { Link } from "react-router";
import type { HeroBanner } from "~/lib/heroBanner.server";
import { trackEvent } from "~/lib/trackClient";

/**
 * Hero grande y editable desde el admin (promoción con banner o banner
 * personalizado en /admin/banners) — se muestra arriba de la animación de
 * modo de uso solo cuando hay uno activo; si no, el home se ve igual que
 * siempre (el propio hero de ScrollytellingSection sigue siendo el default).
 */
export function HeroBannerSection({ banner }: { banner: HeroBanner }) {
  return (
    <section className="relative flex min-h-[420px] items-center overflow-hidden bg-carbon sm:min-h-[520px]">
      {banner.imageUrl && (
        <img
          src={banner.imageUrl}
          alt={banner.text ? "" : banner.imageAlt}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(24,28,20,0.92) 0%, rgba(24,28,20,0.55) 55%, rgba(24,28,20,0.25) 100%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="max-w-xl">
          {banner.text && (
            <h1 className="font-display text-3xl font-black leading-tight text-hueso sm:text-5xl">
              {banner.text}
            </h1>
          )}
          {banner.ctaText && (
            <Link
              to={banner.ctaHref}
              onClick={() => trackEvent("banner_click")}
              className="mt-7 inline-block min-h-11 rounded-full bg-lima px-7 py-3 text-sm font-bold text-carbon transition-transform hover:scale-105 active:scale-95"
            >
              {banner.ctaText}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
