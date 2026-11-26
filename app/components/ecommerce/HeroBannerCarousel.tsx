import { Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import { trackEvent } from "~/lib/trackClient";
import { ChevronIcon } from "~/components/ui/Icons";

type Slide = {
  text: string;
  imageUrl: string | null;
  imageAlt: string;
  ctaText: string;
  ctaHref: string;
};

const AUTO_ADVANCE_MS = 5500;

/**
 * Hero de /tienda: como una tienda física tiene pósters y anuncios, aquí
 * rotan los banners de /admin/banners junto con las promociones que tengan
 * su banner activado — cada uno con su propio botón opcional (puede ir
 * directo a un producto, a una categoría o a ningún lado). Con un solo
 * banner activo se muestra fijo, sin controles de carrusel de más.
 */
export function HeroBannerCarousel({ slides }: { slides: Slide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    prefersReducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (slides.length < 2 || paused || prefersReducedMotion.current) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [slides.length, paused]);

  if (slides.length === 0) return null;

  const slide = slides[Math.min(index, slides.length - 1)];

  return (
    <div
      className={`relative h-[420px] w-full overflow-hidden rounded-3xl bg-gradient-to-t from-bosque via-carbon to-carbon text-hueso`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {slide.imageUrl && (
        <img
          key={slide.imageUrl}
          src={slide.imageUrl}
          alt={slide.text ? "" : slide.imageAlt || ""}
          className={`absolute inset-0 h-full w-full object-cover ${slide.text || slide.ctaText ? "opacity-60" : ""}`}
        />
      )}
      {!slide.text && !slide.ctaText && slide.imageUrl && slide.ctaHref && (
        // Banner solo imagen con destino: toda la imagen es el enlace (las flechas quedan por encima).
        <Link
          to={slide.ctaHref}
          onClick={() => trackEvent("banner_click")}
          aria-label={slide.imageAlt || "Ver más"}
          className="absolute inset-0 z-10 focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-lima"
        />
      )}
      <div
        // Texto arriba y botón abajo, centrados; el degradado de fondo es
        // vertical (oscuro arriba, verde abajo). Más padding lateral cuando hay
        // flechas para que no se encimen con el contenido.
        className={`relative mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-6 py-6 text-center ${slides.length > 1 ? "px-14" : "px-6"} sm:px-16`}
        aria-live="polite"
      >
        {slide.text && <p className="font-display text-lg font-bold leading-snug drop-shadow sm:text-xl">{slide.text}</p>}
        {slide.ctaText && (
          <Link
            to={slide.ctaHref}
            onClick={() => trackEvent("banner_click")}
            className="min-h-11 shrink-0 rounded-full bg-lima px-6 py-2.5 text-sm font-bold text-carbon transition-transform hover:scale-105"
          >
            {slide.ctaText}
          </Link>
        )}
      </div>

      {slides.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
            aria-label="Banner anterior"
            className="absolute left-2 top-1/2 z-20 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-carbon/30 text-hueso hover:bg-carbon/50"
          >
            <ChevronIcon direction="left" className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => (i + 1) % slides.length)}
            aria-label="Siguiente banner"
            className="absolute right-2 top-1/2 z-20 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-carbon/30 text-hueso hover:bg-carbon/50"
          >
            <ChevronIcon direction="right" className="h-5 w-5" />
          </button>
          <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-1.5">
            {slides.map((s, i) => (
              <button
                key={`${s.imageUrl ?? ""}-${i}`}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Ir al banner ${i + 1} de ${slides.length}`}
                aria-current={i === index}
                className={`h-2 rounded-full transition-all ${i === index ? "w-5 bg-lima" : "w-2 bg-hueso/50"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
