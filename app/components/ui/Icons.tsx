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

export type ArrowDirection = "right" | "left" | "down" | "up" | "external";

const ARROW_PATH: Record<ArrowDirection, string> = {
  right: "M5 12h14M13 6l6 6-6 6",
  left: "M19 12H5M11 6l-6 6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  up: "M12 19V5M6 11l6-6 6 6",
  external: "M7 17 17 7M9 7h8v8",
};

// Pequeño desplazamiento al pasar el cursor por el enlace (el padre debe llevar `group`).
const ARROW_NUDGE: Record<ArrowDirection, string> = {
  right: "group-hover:translate-x-0.5",
  left: "group-hover:-translate-x-0.5",
  down: "group-hover:translate-y-0.5",
  up: "group-hover:-translate-y-0.5",
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

export function TrashIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v6M14 11v6" {...STROKE} />
    </Svg>
  );
}

export function PackageIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9" {...STROKE} />
    </Svg>
  );
}

export function RepeatIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M17 3l4 4-4 4M21 7H8a4 4 0 0 0-4 4v1M7 21l-4-4 4-4M3 17h13a4 4 0 0 0 4-4v-1" {...STROKE} />
    </Svg>
  );
}

export function MapPinIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" {...STROKE} />
    </Svg>
  );
}

export function ReceiptIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6" {...STROKE} />
    </Svg>
  );
}

export function MailIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 6h16v12H4zM4 7l8 6 8-6" {...STROKE} />
    </Svg>
  );
}

export function StoreIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6" {...STROKE} />
    </Svg>
  );
}

export function PawIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="6.5" cy="10.5" r="1.7" {...STROKE} />
      <circle cx="10" cy="6.5" r="1.7" {...STROKE} />
      <circle cx="14" cy="6.5" r="1.7" {...STROKE} />
      <circle cx="17.5" cy="10.5" r="1.7" {...STROKE} />
      <path d="M12 12.5c-2.8 0-5 2.3-5 4.4 0 1.5 1.1 2.4 2.5 2.4 1 0 1.6-.4 2.5-.4s1.5.4 2.5.4c1.4 0 2.5-.9 2.5-2.4 0-2.1-2.2-4.4-5-4.4z" {...STROKE} />
    </Svg>
  );
}

export function UserIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" {...STROKE} />
    </Svg>
  );
}
