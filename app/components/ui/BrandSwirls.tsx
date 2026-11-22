import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";

export type SwirlPlacement = {
  src: string;
  /** Desde qué borde vertical se mide vOffset — "top" por default. */
  vAnchor?: "top" | "bottom";
  vOffset: number;
  hAnchor: "left" | "right";
  hOffset: number;
  /** Multiplicador sobre `width` — 1 = tamaño de referencia, 1.5 = 50% más grande, etc. */
  scale?: number;
  /** Ancho de referencia en pantallas grandes (px) — en pantallas angostas se reduce con clamp() para no recortar la forma en una franja irreconocible. */
  width: number;
  /** Multiplicador de paralax: valores más altos se mueven más al hacer scroll (capas "traseras" cerca de 0 se mueven poco, capas "frontales" con valores altos se mueven más — dan la sensación de profundidad). Positivo o negativo según la dirección deseada. */
  speed: number;
  rotate?: number;
  opacity?: number;
};

const MIN_WIDTH_PX = 170;
const VIEWPORT_SHARE = 42; // vw

// hOffset es un porcentaje del ancho del contenedor (que ocupa el 100% del
// viewport) — sin tope, ese porcentaje crece sin límite en pantallas muy
// anchas, alejando el remolino cada vez más del borde real hasta perderse
// de vista. Convertimos el porcentaje a un valor en px acotado con
// clamp(): hasta este ancho de referencia se comporta exactamente igual
// que el porcentaje puro (pegado a la orilla, como en pantallas normales);
// más allá, el sangrado se "congela" en vez de seguir creciendo.
const REFERENCE_VIEWPORT_PX = 1600;

// Recorrido en px del parallax para una capa de speed=1, a lo largo de TODO
// el trayecto en que ESE remolino cruza el viewport (no de toda la página
// — ver nota en SwirlLayer sobre por qué antes era imperceptible).
const PARALLAX_RANGE_PX = 440;

function SwirlLayer({ swirl, active }: { swirl: SwirlPlacement; active: boolean }) {
  // Cada remolino mide el scroll relativo a SU PROPIO recorrido por el
  // viewport (offset "start end" → "end start": desde que entra por abajo
  // hasta que sale por arriba). Antes se medía relativo al contenedor de
  // TODA la página (miles de px de alto), así que el progreso 0→1 tardaba
  // toda la página en completarse y el desplazamiento resultante en
  // cualquier scroll normal era de unos pocos píxeles — técnicamente
  // animaba, pero invisible en la práctica. Al acotarlo al propio tránsito
  // del remolino, el mismo rango de movimiento ocurre en ~1 pantalla de
  // scroll, así que se nota de verdad.
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  const scale = swirl.scale ?? 1;
  const referenceBleedPx = (swirl.hOffset / 100) * REFERENCE_VIEWPORT_PX;
  const minBleedPx = Math.min(0, referenceBleedPx);
  const maxBleedPx = Math.max(0, referenceBleedPx);
  const range = active ? (swirl.speed ?? 0) * PARALLAX_RANGE_PX : 0;
  const y = useTransform(scrollYProgress, [0, 1], [-range, range]);

  return (
    <motion.div
      ref={ref}
      className="absolute"
      style={{
        [swirl.vAnchor ?? "top"]: `${swirl.vOffset}%`,
        [swirl.hAnchor]: `clamp(${minBleedPx.toFixed(1)}px, ${swirl.hOffset}%, ${maxBleedPx.toFixed(1)}px)`,
        width: `clamp(${MIN_WIDTH_PX}px, ${(VIEWPORT_SHARE * scale).toFixed(1)}vw, ${Math.round(swirl.width * scale)}px)`,
        opacity: swirl.opacity ?? 0.95,
        rotate: swirl.rotate ?? 0,
        y,
        willChange: "transform",
      }}
    >
      <img src={swirl.src} alt="" className="h-auto w-full select-none" draggable={false} loading="lazy" />
    </motion.div>
  );
}

/**
 * Elementos decorativos de marca (los remolinos recortados de la etiqueta,
 * en public/elementos-design) esparcidos como fondo de una sección oscura,
 * con parallax real al hacer scroll (framer-motion `useScroll`/`useTransform`)
 * — cada remolino se desplaza a su propia velocidad (`speed`), dando
 * profundidad tridimensional al conjunto. Puramente decorativo (aria-hidden),
 * no bloquea clics.
 *
 * El parallax solo se activa después de montar en cliente (`mounted`) y se
 * desactiva por completo si el usuario prefiere menos movimiento
 * (`useReducedMotion`) — así el primer render en servidor y en cliente
 * coinciden exactamente (sin salto de hidratación) y el efecto se enciende
 * de forma progresiva.
 *
 * Para reacomodar visualmente en vez de editar estos números a ciegas, ver
 * EditableBrandSwirls (agrega ?editar=1 a la URL en desarrollo).
 */
/**
 * El mismo fondo de remolinos (imágenes, escalas, posiciones y velocidad de
 * paralax) usado en el landing de pre-lanzamiento (PrelaunchLanding) y en el
 * tramo oscuro del home ya lanzado (hero + manifiesto en _index.tsx) — una
 * sola fuente de verdad para que ambos se vean "igualito", como pidió el
 * usuario. vOffset es un porcentaje de la altura de SU contenedor, así que
 * la misma composición se reparte proporcionalmente aunque el contenedor
 * mida distinto en cada página.
 */
export const DEFAULT_PAGE_SWIRLS: SwirlPlacement[] = [
  { src: "/elementos-design/izquierda-02.webp", vAnchor: "top", vOffset: 61, hAnchor: "left", hOffset: -29, scale: 0.95, width: 760, speed: 0.26, rotate: 45, opacity: 1 },
  { src: "/elementos-design/derecha-01.webp", vAnchor: "top", vOffset: 58, hAnchor: "right", hOffset: -17, scale: 0.75, width: 700, speed: -0.22, rotate: 6, opacity: 1 },
  { src: "/elementos-design/izquierda-06.webp", vAnchor: "top", vOffset: 1, hAnchor: "left", hOffset: -18, scale: 1.65, width: 780, speed: 0.32, rotate: -8, opacity: 1 },
  { src: "/elementos-design/derecha-05.webp", vAnchor: "top", vOffset: -5, hAnchor: "right", hOffset: -51, scale: 1.6, width: 780, speed: -0.28, rotate: 5, opacity: 1 },
  { src: "/elementos-design/izquierda-04.webp", vAnchor: "top", vOffset: 88, hAnchor: "left", hOffset: -12, scale: 1, width: 720, speed: 0.24, rotate: 4, opacity: 1 },
  { src: "/elementos-design/izquierda-06.webp", vAnchor: "top", vOffset: 61, hAnchor: "right", hOffset: -87, scale: 3, width: 760, speed: -0.3, rotate: 45, opacity: 1 },
];

/**
 * Misma familia visual que DEFAULT_PAGE_SWIRLS, pero para pantallas de UNA
 * sola vista (sin scroll largo) como /acceso-privado: menos remolinos, más
 * chicos, repartidos parejo en todo el alto — con el arreglo largo, varios
 * vOffset caían en la misma franja (~60%) y uno llegaba a 3x de escala, así
 * que en un contenedor corto se encimaban todos en el centro.
 */
export const COMPACT_PAGE_SWIRLS: SwirlPlacement[] = [
  { src: "/elementos-design/izquierda-06.webp", vAnchor: "top", vOffset: -6, hAnchor: "left", hOffset: -20, scale: 0.85, width: 520, speed: 0.22, rotate: -8, opacity: 1 },
  { src: "/elementos-design/derecha-05.webp", vAnchor: "top", vOffset: 22, hAnchor: "right", hOffset: -24, scale: 0.8, width: 480, speed: -0.2, rotate: 5, opacity: 1 },
  { src: "/elementos-design/izquierda-02.webp", vAnchor: "top", vOffset: 68, hAnchor: "left", hOffset: -22, scale: 0.7, width: 460, speed: 0.24, rotate: 45, opacity: 1 },
  { src: "/elementos-design/derecha-01.webp", vAnchor: "top", vOffset: 92, hAnchor: "right", hOffset: -18, scale: 0.65, width: 440, speed: -0.22, rotate: 6, opacity: 1 },
];

export function BrandSwirls({ swirls, className = "" }: { swirls: SwirlPlacement[]; className?: string }) {
  const [mounted, setMounted] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    setMounted(true);
  }, []);

  const active = mounted && !prefersReducedMotion;

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      {swirls.map((s, i) => (
        <SwirlLayer key={`${s.src}-${i}`} swirl={s} active={active} />
      ))}
    </div>
  );
}
