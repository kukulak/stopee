import { useEffect, useState } from "react";
import { CheckIcon } from "~/components/ui/Icons";

/**
 * Aviso que entra deslizándose desde arriba al agregar algo al carrito y se
 * retira solo a los pocos segundos — reemplaza tener el carrito siempre
 * visible: el usuario solo necesita esta confirmación breve, y "Ver carrito"
 * abre el panel completo si de verdad quiere revisarlo.
 */
export function AddedToCartToast({
  item,
  onDismiss,
  onViewCart,
}: {
  item: { name: string } | null;
  onDismiss: () => void;
  onViewCart: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [displayItem, setDisplayItem] = useState<{ name: string } | null>(null);

  useEffect(() => {
    if (!item) {
      // El padre lo retiró (p. ej. al tocar "Ver carrito"): se oculta de inmediato.
      // Sin esto, el temporizador de abajo se cancelaba y el aviso se quedaba pegado.
      setVisible(false);
      return;
    }
    setDisplayItem(item);
    const showFrame = requestAnimationFrame(() => setVisible(true));
    const hideTimer = setTimeout(() => setVisible(false), 4000);
    return () => {
      cancelAnimationFrame(showFrame);
      clearTimeout(hideTimer);
    };
  }, [item]);

  useEffect(() => {
    if (visible || !displayItem) return;
    const cleanupTimer = setTimeout(() => {
      setDisplayItem(null);
      onDismiss();
    }, 300);
    return () => clearTimeout(cleanupTimer);
  }, [visible, displayItem, onDismiss]);

  if (!displayItem) return null;

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 top-3 z-[55] flex justify-center px-4 transition-transform duration-300 ${
        visible ? "translate-y-0" : "-translate-y-[150%]"
      }`}
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-2xl bg-carbon px-5 py-3.5 text-hueso shadow-xl">
        <p className="text-sm font-semibold">
          <CheckIcon className="mr-1 inline h-4 w-4 align-text-bottom" /> Se agregó <span className="font-bold">{displayItem.name}</span> al carrito
        </p>
        <button
          type="button"
          onClick={onViewCart}
          className="min-h-9 shrink-0 rounded-full bg-lima px-4 text-xs font-bold text-carbon"
        >
          Ver carrito
        </button>
      </div>
    </div>
  );
}
