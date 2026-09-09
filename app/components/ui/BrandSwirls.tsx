import { useEffect, useRef } from "react";

export type SwirlPlacement = {
  src: string;
  side: "left" | "right";
  top: string;
  width: number;
  /** Multiplicador de paralax: valores más altos se mueven más al hacer scroll. Positivo o negativo según la dirección deseada. */
  speed: number;
  rotate?: number;
  opacity?: number;
};

/**
 * Elementos decorativos de marca (los remolinos recortados de la etiqueta,
 * en public/elementos-design) esparcidos como fondo de una sección oscura,
 * con un paralax sutil al hacer scroll — eco de la composición de la
 * etiqueta oficial. Puramente decorativo (aria-hidden), no bloquea clics.
 */
export function BrandSwirls({ swirls, className = "" }: { swirls: SwirlPlacement[]; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    let ticking = false;
    let visible = false;

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) update();
      },
      { rootMargin: "200px 0px" },
    );
    if (containerRef.current) io.observe(containerRef.current);

    function update() {
      ticking = false;
      const container = containerRef.current;
      if (!visible || !container) return;
      const rect = container.getBoundingClientRect();
      const vh = window.innerHeight;
      // Progreso 0→1 a lo largo de todo el recorrido de scroll de la sección,
      // centrado para que el desplazamiento sea simétrico arriba/abajo.
      const total = rect.height + vh;
      const progress = Math.min(1, Math.max(0, (vh - rect.top) / total));
      const shift = (progress - 0.5) * 2;

      layerRefs.current.forEach((el, i) => {
        if (!el) return;
        const s = swirls[i];
        const y = shift * (s.speed ?? 0) * 120;
        el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) rotate(${s.rotate ?? 0}deg)`;
      });
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [swirls]);

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      {swirls.map((s, i) => (
        <div
          key={`${s.src}-${i}`}
          ref={(el) => {
            layerRefs.current[i] = el;
          }}
          className="absolute"
          style={{
            top: s.top,
            [s.side]: `${Math.round(s.width * -0.22)}px`,
            width: s.width,
            opacity: s.opacity ?? 1,
            transform: `rotate(${s.rotate ?? 0}deg)`,
            willChange: "transform",
          }}
        >
          <img src={s.src} alt="" className="h-auto w-full select-none" draggable={false} loading="lazy" />
        </div>
      ))}
    </div>
  );
}
