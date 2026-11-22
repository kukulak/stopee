/**
 * Íconos de interfaz (SVG) en el mismo trazo delgado que los de redes
 * sociales. Sustituyen a los símbolos de texto (✕ ✓ ★ ‹ › ☰ ▶), que cada
 * sistema operativo dibuja distinto — a veces como emoji a colores.
 */
const STROKE = { stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

type IconProps = { className?: string };

function Svg({ className = "h-5 w-5", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 6l12 12M18 6 6 18" {...STROKE} />
    </Svg>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" {...STROKE} />
    </Svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" {...STROKE} />
    </Svg>
  );
}

export function ChevronIcon({ direction = "right", className }: IconProps & { direction?: "left" | "right" }) {
  return (
    <Svg className={className}>
      <path d={direction === "right" ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7"} {...STROKE} />
    </Svg>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </Svg>
  );
}

/** Calificación de 1 a 5 con estrellas dibujadas (llenas y de contorno). */
export function StarRating({ rating, className = "h-4 w-4" }: { rating: number; className?: string }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${rating} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"
            fill={n <= rating ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
  );
}

export type ArrowDirection = "right" | "left" | "down" | "external";

const ARROW_PATH: Record<ArrowDirection, string> = {
  right: "M5 12h14M13 6l6 6-6 6",
  left: "M19 12H5M11 6l-6 6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  external: "M7 17 17 7M9 7h8v8",
};

// Pequeño desplazamiento al pasar el cursor por el enlace (el padre debe llevar `group`).
const ARROW_NUDGE: Record<ArrowDirection, string> = {
  right: "group-hover:translate-x-0.5",
  left: "group-hover:-translate-x-0.5",
  down: "group-hover:translate-y-0.5",
  external: "group-hover:-translate-y-0.5 group-hover:translate-x-0.5",
};

export function ArrowIcon({ direction = "right", className = "h-4 w-4" }: IconProps & { direction?: ArrowDirection }) {
  return (
    <Svg className={`${className} shrink-0 transition-transform ${ARROW_NUDGE[direction]}`}>
      <path d={ARROW_PATH[direction]} {...STROKE} />
    </Svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 4v11M7 11l5 5 5-5M5 20h14" {...STROKE} />
    </Svg>
  );
}

/** Texto + flecha dibujada: indica que lleva a otro lugar. Úsalo dentro de un enlace con clase `group`. */
export function ArrowLabel({
  children,
  direction = "right",
  className = "",
}: {
  children: React.ReactNode;
  direction?: ArrowDirection;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {direction === "left" && <ArrowIcon direction="left" />}
      {children}
      {direction !== "left" && <ArrowIcon direction={direction} />}
    </span>
  );
}

export function EyeIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" {...STROKE} />
      <circle cx="12" cy="12" r="3" {...STROKE} />
    </Svg>
  );
}

export function EyeOffIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.3 4.2M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6" {...STROKE} />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" {...STROKE} />
    </Svg>
  );
}
