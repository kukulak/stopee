const STROKE = { stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Glyph({ id }: { id: string }) {
  switch (id) {
    case "instagram":
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="5" {...STROKE} />
          <circle cx="12" cy="12" r="4" {...STROKE} />
          <circle cx="17.2" cy="6.8" r="1" fill="currentColor" />
        </>
      );
    case "tiktok":
      return (
        <>
          <path d="M14 3v10.5a3.5 3.5 0 1 1-3.5-3.5c.3 0 .6.02.9.07" {...STROKE} />
          <path d="M14 3c0 2.5 2 4.5 4.5 4.5" {...STROKE} />
        </>
      );
    case "whatsapp":
      return (
        <>
          {/* Globo redondo con la colita abajo a la izquierda */}
          <path d="M3.5 20.5 4.3 15.6A8.5 8.5 0 1 1 7.1 19z" {...STROKE} />
          {/* Auricular (glifo "phone" de 24px, reducido y centrado en el globo) */}
          <g transform="translate(7.3 7.3) scale(0.4)">
            <path
              d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
              {...STROKE}
              strokeWidth={3.75}
            />
          </g>
        </>
      );
    case "facebook":
      return <path d="M14.5 21v-7.5H17l.5-3h-3V8.8c0-.9.4-1.5 1.6-1.5H17.6V4.6C17.2 4.5 16.2 4.4 15.3 4.4c-2.3 0-3.8 1.4-3.8 3.9v2.2H9v3h2.5V21" {...STROKE} />;
    case "youtube":
      return (
        <>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" {...STROKE} />
          <path d="M10 9.2v5.6l4.8-2.8z" {...STROKE} />
        </>
      );
    case "x":
      return (
        <>
          <path d="M4.5 4h3.9l11.1 16h-3.9z" {...STROKE} />
          <path d="M4.8 20l6.2-6.9M13.1 10.4 19 4" {...STROKE} />
        </>
      );
    case "linkedin":
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="4" {...STROKE} />
          <path d="M8 10.5v6M8 7.7v.1M11.5 16.5v-6M11.5 13.2a2.7 2.7 0 0 1 5.4 0v3.3" {...STROKE} />
        </>
      );
    case "discord":
      return (
        <>
          <path d="M8.2 6.2A15 15 0 0 1 12 5.5c1.3 0 2.5.2 3.8.7 1.8 2.5 2.8 5.3 3.2 8.6-1.4 1.1-2.9 1.9-4.6 2.4l-1-1.7M8.2 6.2C6.4 8.7 5.4 11.5 5 14.8c1.4 1.1 2.9 1.9 4.6 2.4l1-1.7M9 16.2c2 .5 4 .5 6 0" {...STROKE} />
          <circle cx="9.3" cy="12" r="1.1" fill="currentColor" />
          <circle cx="14.7" cy="12" r="1.1" fill="currentColor" />
        </>
      );
    case "telegram":
      return (
        <>
          <path d="M20.5 4 3.5 10.8l5.3 2 2 6.2 3.2-3.6 4.8 3.6z" {...STROKE} />
          <path d="m8.8 12.8 8.2-6" {...STROKE} />
        </>
      );
    case "twitch":
      return (
        <>
          <path d="M5 3 3.5 7v12H8v2.5h2.5L13 19h4l3.5-3.5V3z" {...STROKE} />
          <path d="M16 8v4M12 8v4" {...STROKE} />
        </>
      );
    default:
      // "link": cualquier red sin ícono propio.
      return (
        <>
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" {...STROKE} />
          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" {...STROKE} />
        </>
      );
  }
}

/** Ícono de una red social (hereda el color del texto con currentColor). */
export function SocialIcon({ id, className = "h-5 w-5" }: { id: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <Glyph id={id} />
    </svg>
  );
}
