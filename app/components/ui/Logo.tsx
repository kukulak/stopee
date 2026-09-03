/**
 * Wordmark basado en la etiqueta oficial: blob oscuro redondeado con
 * "STOPee" en verde lima, ligeramente inclinado, y tagline opcional.
 */
export function Logo({
  className = "",
  withTagline = false,
}: {
  className?: string;
  withTagline?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 220 90"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="STOPee"
    >
      <ellipse
        cx="110"
        cy="42"
        rx="104"
        ry="34"
        fill="#181C14"
        transform="rotate(-4 110 42)"
      />
      <text
        x="110"
        y="53"
        textAnchor="middle"
        fontFamily="Outfit, sans-serif"
        fontWeight="900"
        fontSize="38"
        fill="#B5D334"
        transform="rotate(-4 110 42)"
        letterSpacing="-1"
      >
        STOP<tspan fill="#B5D334" fontSize="44">ee</tspan>
      </text>
      {withTagline && (
        <text
          x="110"
          y="82"
          textAnchor="middle"
          fontFamily="'Plus Jakarta Sans', sans-serif"
          fontWeight="700"
          fontSize="8"
          letterSpacing="1.5"
          fill="#7A9330"
        >
          CONCENTRADO BIOTECNOLÓGICO DE HIGIENE URBANA
        </text>
      )}
    </svg>
  );
}
