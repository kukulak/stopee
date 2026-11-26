import { useEffect, useRef, useState } from "react";
import { ChevronIcon } from "~/components/ui/Icons";
import { HeroBannerSection } from "~/components/ecommerce/HeroBannerSection";
import type { HeroBanner } from "~/lib/heroBanner";

const AUTO_ADVANCE_MS = 6500;

/**
 * Los banners de la portada. Con uno solo se muestra fijo; con varios rotan, cada uno con su propia
 * comunicación (y, si es solo imagen, la imagen entera es el enlace).
 *
 * Todas las láminas se apilan en la misma celda y solo cambia cuál se ve: así la altura no salta
 * al pasar de un banner a otro, y las láminas ocultas no reciben foco ni las lee un lector de pantalla.
 * Se detiene al pasar el cursor o enfocar un control, y no avanza sola con «reducir movimiento».
 */
export function HomeBannerCarousel({ banners }: { banners: HeroBanner[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (banners.length < 2 || paused || reducedMotion.current) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % banners.length), AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [banners.length, paused]);

  if (banners.length === 1) return <HeroBannerSection banner={banners[0]} />;

  const current = Math.min(index, banners.length - 1);
  const go = (next: number) => setIndex((next + banners.length) % banners.length);

  return (
    <div
      role="region"
      aria-roledescription="carrusel"
      aria-label="Banners destacados"
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="grid">
        {banners.map((banner, i) => (
          <div
            key={`${banner.imageUrl ?? ""}-${banner.text}-${i}`}
            aria-hidden={i !== current}
            aria-roledescription="lámina"
            aria-label={`${i + 1} de ${banners.length}`}
            className={`col-start-1 row-start-1 flex flex-col transition-opacity duration-500 motion-reduce:transition-none ${
              i === current ? "opacity-100" : "invisible opacity-0"
            }`}
          >
            <HeroBannerSection banner={banner} headingTag={i === 0 ? "h1" : "h2"} className="flex-1" />
          </div>
        ))}
      </div>

      <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center rounded-full bg-carbon/45 px-1 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => go(current - 1)}
          aria-label="Banner anterior"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-hueso hover:bg-hueso/10"
        >
          <ChevronIcon direction="left" className="h-5 w-5" />
        </button>
        {banners.map((banner, i) => (
          <button
            key={`dot-${banner.imageUrl ?? ""}-${i}`}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Ir al banner ${i + 1} de ${banners.length}`}
            aria-current={i === current}
            className="flex min-h-11 min-w-8 items-center justify-center"
          >
            <span className={`h-2 rounded-full transition-all ${i === current ? "w-5 bg-lima" : "w-2 bg-hueso/60"}`} />
          </button>
        ))}
        <button
          type="button"
          onClick={() => go(current + 1)}
          aria-label="Siguiente banner"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-hueso hover:bg-hueso/10"
        >
          <ChevronIcon direction="right" className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
