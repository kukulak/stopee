import { Link } from "react-router";
import type { HeroBanner } from "~/lib/heroBanner.server";
import { trackEvent } from "~/lib/trackClient";

/**
 * Banner de la portada, editable en /admin/banners (banners marcados para «Inicio»). Ocupa todo el
 * ancho de la pantalla; se ve muy distinto del carrusel de /tienda, más pequeño y con esquinas
 * redondeadas. Aquí van mensajes de beneficios e identidad; en /tienda, productos, paquetes y promos.
 *
 * Hay cuatro tipos de banner y el alto se ajusta a cada uno:
 *  - Solo imagen: la imagen ES el diseño. No se le pone nada encima (ni oscurecido ni texto).
 *  - Imagen con texto o botón: la imagen va al fondo tal cual; el texto y el botón van encima. Quien
 *    sube la imagen decide si la oscurece, porque el sitio ya no le agrega ningún filtro.
 *  - Solo texto y botón: sobre el fondo oscuro de la marca con un resplandor lima.
 *
 * Alto: con imagen, 400 px en el celular (más alto recortaría los lados de una imagen horizontal) y
 * la mitad de la pantalla en escritorio. Sin imagen, el celular no necesita tanto espacio vacío.
 * La imagen se centra al recortar, así que lo importante del diseño debe quedar en el centro.
 */
export function HeroBannerSection({ banner }: { banner: HeroBanner }) {
  const hasImage = Boolean(banner.imageUrl);
  const hasContent = Boolean(banner.text || banner.subtitle || banner.ctaText);

  return (
    <section
      className={`relative flex w-full items-center overflow-hidden bg-carbon sm:min-h-[max(22rem,50svh)] ${
        hasImage ? "min-h-[400px]" : "min-h-72"
      }`}
    >
      {hasImage ? (
        <img
          src={banner.imageUrl ?? ""}
          alt="" // El texto alternativo, si no hay texto visible, va en el título oculto de abajo.
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 120% at 85% 15%, rgba(181,211,52,0.22) 0%, rgba(181,211,52,0) 60%), radial-gradient(60% 100% at 0% 100%, rgba(62,83,29,0.55) 0%, rgba(62,83,29,0) 70%)",
          }}
        />
      )}

      {hasContent ? (
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
      ) : (
        // Banner de solo imagen: sin texto visible, pero la página necesita su título principal
        // para buscadores y lectores de pantalla.
        banner.imageAlt && <h1 className="sr-only">{banner.imageAlt}</h1>
      )}
    </section>
  );
}
