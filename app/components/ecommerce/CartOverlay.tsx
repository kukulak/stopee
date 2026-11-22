import { useEffect } from "react";
import { CloseIcon } from "~/components/ui/Icons";

/**
 * Panel del carrito como overlay deslizable (no un panel fijo siempre
 * visible) — se abre desde el ícono de carrito del Navbar o desde el botón
 * "Ver carrito" del aviso al agregar un producto, y se cierra con el botón,
 * clic afuera o Escape.
 */
export function CartOverlay({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  return (
    <div className={`fixed inset-0 z-[60] ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-carbon/40 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tu carrito"
        className={`absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-hueso shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-carbon/10 px-5 py-4">
          <p className="font-display text-lg font-black text-carbon">Tu carrito</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar carrito"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon/60 hover:bg-carbon/5"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
