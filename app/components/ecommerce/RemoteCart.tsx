import { useEffect } from "react";
import { useFetcher } from "react-router";
import { CartDrawer } from "~/components/ecommerce/CartDrawer";
import { CartOverlay } from "~/components/ecommerce/CartOverlay";
import type { CartView } from "~/lib/cartView.server";

/**
 * El carrito como panel lateral para páginas que no son la tienda (blog, nosotros,
 * cómo funciona…). Pide su contenido a /api/carrito cada vez que se abre, así
 * siempre muestra lo último, y deja a la persona en la página donde estaba.
 */
export function RemoteCart({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fetcher = useFetcher<CartView>();

  useEffect(() => {
    if (open && fetcher.state === "idle") fetcher.load("/api/carrito");
    // Solo al abrir: los cambios dentro del carrito se refrescan solos (revalidación del router).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cart = fetcher.data;

  return (
    <CartOverlay open={open} onClose={onClose}>
      {cart ? (
        <CartDrawer
          lines={cart.lines}
          subtotalMxn={cart.subtotalMxn}
          discountPercent={cart.discountPercent}
          discountLabel={cart.discountLabel}
          coupon={cart.coupon}
          couponNotice={cart.couponNotice}
          gifts={cart.gifts}
          shipping={cart.shipping}
          deliveryZone={cart.deliveryZone}
          addressDefaults={cart.addressDefaults}
          onClose={onClose}
        />
      ) : (
        <p className="text-sm text-carbon/60" role="status">
          Cargando tu carrito…
        </p>
      )}
    </CartOverlay>
  );
}
