import { useNavigation } from "react-router";

/** Barra de progreso indeterminada arriba de la página durante la navegación entre rutas — Remix no muestra nada por defecto, así que un click sin feedback inmediato se siente roto (Doherty Threshold, ver CLAUDE.md). */
export function GlobalLoadingBar() {
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-x-0 top-0 z-[60] h-1 bg-lima transition-opacity duration-150 ${
        isNavigating ? "opacity-100" : "opacity-0"
      }`}
      style={{
        animation: isNavigating ? "stopee-loading-bar 1.1s ease-in-out infinite" : "none",
        transformOrigin: "left",
      }}
    >
      <style>{`
        @keyframes stopee-loading-bar {
          0% { transform: scaleX(0); }
          50% { transform: scaleX(0.6); }
          100% { transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
}
