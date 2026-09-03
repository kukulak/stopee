/**
 * Ondas orgánicas de marca, inspiradas en los remolinos multicapa de la
 * etiqueta oficial de STOPee (bandas gruesas de verde lima/oliva/bosque
 * envolviéndose sobre un fondo oscuro). Uso ambiental (loop CSS), no
 * depende de scroll. Para ondas sincronizadas con scroll ver ScrollyContainer.
 */
export function FluidWaves({
  className = "",
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  const stroke = tone === "dark" ? "#B5D334" : "#3E531D";

  return (
    <svg
      className={className}
      viewBox="0 0 1200 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g className="animate-[wave-drift_18s_ease-in-out_infinite]" opacity="0.35">
        <path
          d="M-50 220C150 160 250 300 450 240C650 180 750 320 950 240C1100 180 1200 220 1250 200V420H-50V220Z"
          fill="#B5D334"
        />
      </g>
      <g className="animate-[wave-drift_22s_ease-in-out_infinite_reverse]" opacity="0.3">
        <path
          d="M-50 260C200 320 300 180 500 240C700 300 800 160 1000 220C1120 260 1200 240 1250 250V420H-50V260Z"
          fill="#7A9330"
        />
      </g>
      <g className="animate-[wave-drift_26s_ease-in-out_infinite]" opacity="0.5">
        <path
          d="M-50 310C180 280 320 340 520 300C720 260 820 340 1020 300C1140 280 1200 300 1250 300V420H-50V310Z"
          fill="#3E531D"
        />
      </g>
      {/* Remolinos concéntricos, eco de la etiqueta */}
      <g className="animate-[wave-drift_30s_ease-in-out_infinite]" opacity="0.22">
        <path
          d="M120 80C220 40 340 60 360 150C380 240 280 280 210 240C150 206 170 140 220 130C260 122 280 150 270 175"
          stroke={stroke}
          strokeWidth="26"
          strokeLinecap="round"
          fill="none"
        />
      </g>
      <g className="animate-[wave-drift_24s_ease-in-out_infinite_reverse]" opacity="0.18">
        <path
          d="M980 60C1080 30 1160 90 1150 170C1140 250 1050 270 1010 220C976 176 1000 130 1044 126C1080 123 1096 150 1084 170"
          stroke={stroke}
          strokeWidth="22"
          strokeLinecap="round"
          fill="none"
        />
      </g>
      <path
        d="M-50 300C200 260 320 350 550 300"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.4"
      />
      <style>{`
        @keyframes wave-drift {
          0%, 100% { transform: translateX(0) translateY(0); }
          50% { transform: translateX(-2%) translateY(1.5%); }
        }
      `}</style>
    </svg>
  );
}
