import { Link } from "react-router";
import type { HeroBanner } from "~/lib/heroBanner.server";
import { trackEvent } from "~/lib/trackClient";

/**
 * Banner de la portada, editable en /admin/banners (banners marcados para «Inicio»). Ocupa todo el
 * ancho de la pantalla y cerca de la mitad de su alto, para que se vea muy distinto del carrusel de
 * /tienda, más pequeño y con esquinas redondeadas. Aquí van mensajes de beneficios e identidad; en
 * /tienda, productos, paquetes y promociones.
 *
 * Sin imagen, queda sobre el fondo oscuro de la marca con un resplandor lima, para que un banner
 * solo de texto no se vea vacío.
 */
export function HeroBannerSection({ banner }: { banner: HeroBanner }) {
  return (
    <section className="relative flex min-h-[max(22rem,50svh)] w-full items-center overflow-hidden bg-carbon">
      {banner.imageUrl ? (
        <>
          <img
            src={banner.imageUrl}
            alt={banner.text ? "" : banner.imageAlt}
            fetchPriority="high"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Oscurece el lado del texto para que se lea sobre cualquier foto. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(90deg, rgba(24,28,20,0.9) 0%, rgba(24,28,20,0.55) 55%, rgba(24,28,20,0.2) 100%)",
            }}
          />
        </>
      ) : (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 120% at 85% 15%, rgba(181,211,52,0.22) 0%, rgba(181,211,52,0) 60%), radial-gradient(60% 100% at 0% 100%, rgba(62,83,29,0.55) 0%, rgba(62,83,29,0) 70%)",
          }}
        />
      )}

      <div className="relative mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <div className="max-w-2xl">
          {banner.text && (
            <h1 className="text-balance font-display text-4xl font-black leading-[1.05] text-hueso sm:text-6xl">
              {banner.text}
            </h1>
          )}
          {banner.subtitle && (
            <p className="mt-4 max-w-xl text-lg text-hueso/85 sm:text-xl">{banner.subtitle}</p>
          )}
          {banner.ctaText && (
            <Link
              to={banner.ctaHref}
              onClick={() => trackEvent("banner_click")}
              className="mt-8 inline-block min-h-12 rounded-full bg-lima px-8 py-3.5 text-base font-bold text-carbon transition-transform hover:scale-105 active:scale-95"
            >
              {banner.ctaText}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
