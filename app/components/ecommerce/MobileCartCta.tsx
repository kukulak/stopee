/** Barra fija móvil de "ver carrito" — solo aparece con algo adentro, para no ocupar espacio de pantalla en vano ni competir con el resto de CTAs mientras el carrito sigue vacío. */
export function MobileCartCta({
  itemCount,
  subtotalMxn,
  onOpenCart,
}: {
  itemCount: number;
  subtotalMxn: number;
  onOpenCart: () => void;
}) {
  if (itemCount === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-carbon/10 bg-white/95 px-4 py-3 backdrop-blur-md sm:hidden">
      <button
        type="button"
        onClick={onOpenCart}
        className="flex min-h-11 w-full items-center justify-between rounded-full bg-carbon px-6 text-sm font-bold text-hueso"
      >
        <span>
          {itemCount} {itemCount === 1 ? "artículo" : "artículos"}
        </span>
        <span>Ver carrito · ${subtotalMxn} MXN</span>
      </button>
    </div>
  );
}
