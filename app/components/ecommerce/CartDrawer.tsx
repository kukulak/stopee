import { useFetcher } from "@remix-run/react";
import type { Product, ProductSku } from "~/data/products";

export type CartLine = {
  sku: ProductSku;
  quantity: number;
  product: Product;
};

export function CartDrawer({
  lines,
  subtotalMxn,
  discountPercent,
}: {
  lines: CartLine[];
  subtotalMxn: number;
  discountPercent: number;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const isCheckingOut = fetcher.state !== "idle";
  const totalMxn = Math.round(subtotalMxn * (1 - discountPercent / 100));

  return (
    <div
      id="carrito"
      className="sticky top-24 flex flex-col gap-4 rounded-3xl border border-carbon/10 bg-hueso p-6"
    >
      <h3 className="font-display text-xl font-black text-carbon">Tu carrito</h3>

      {lines.length === 0 ? (
        <p className="text-sm text-carbon/60">
          Aún no agregas productos. Elige tu STOPee 1L, tu Squishable o un paquete completo.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {lines.map((line) => (
              <li key={line.sku} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-carbon">{line.product.name}</p>
                  <p className="text-xs text-carbon/50">
                    {line.quantity} × ${line.product.priceMxn} MXN
                  </p>
                </div>
                <fetcher.Form method="post" action="/tienda">
                  <input type="hidden" name="intent" value="remove-from-cart" />
                  <input type="hidden" name="sku" value={line.sku} />
                  <button
                    type="submit"
                    className="min-h-11 min-w-11 rounded-full text-carbon/40 hover:text-carbon"
                    aria-label={`Quitar ${line.product.name} del carrito`}
                  >
                    ✕
                  </button>
                </fetcher.Form>
              </li>
            ))}
          </ul>

          <div className="border-t border-carbon/10 pt-4">
            {discountPercent > 0 && (
              <div className="mb-1 flex justify-between text-sm text-bosque">
                <span>Descuento de fidelidad</span>
                <span>-{discountPercent}%</span>
              </div>
            )}
            <div className="flex justify-between font-display text-lg font-black text-carbon">
              <span>Total</span>
              <span>${totalMxn} MXN</span>
            </div>
          </div>

          <fetcher.Form method="post" action="/api/checkout">
            <button
              type="submit"
              disabled={isCheckingOut}
              className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
            >
              {isCheckingOut ? "Redirigiendo a pago…" : "Ir a pagar"}
            </button>
          </fetcher.Form>
          {fetcher.data?.error && (
            <p className="text-sm font-semibold text-red-600">{fetcher.data.error}</p>
          )}
        </>
      )}
    </div>
  );
}
