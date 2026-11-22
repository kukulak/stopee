import { useEffect, useState } from "react";
import { useLocation } from "react-router";

const HIDDEN_PREFIXES = ["/admin", "/cuenta"];
const SHOW_AFTER_PX = 480;

/** Botón flotante "volver arriba" para páginas largas (landing, blog, tienda) — abajo a la izquierda para no chocar con el botón de WhatsApp. */
export function BackToTopButton() {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname]);

  if (HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Volver arriba"
      className="fixed bottom-5 left-5 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-carbon/10 bg-white text-carbon shadow-lg transition-transform hover:scale-105"
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
