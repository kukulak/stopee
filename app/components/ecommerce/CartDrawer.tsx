import { useFetcher } from "@remix-run/react";
import { useState } from "react";
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
  coupon,
}: {
  lines: CartLine[];
  subtotalMxn: number;
  discountPercent: number;
  coupon: { code: string; percentage: number } | null;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const couponFetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const isCheckingOut = fetcher.state !== "idle";
  const isApplyingCoupon = couponFetcher.state !== "idle";
  const [codeInput, setCodeInput] = useState("");
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

          {/* Código de descuento */}
          <div className="border-t border-carbon/10 pt-4">
            {coupon ? (
              <div className="flex items-center justify-between rounded-xl bg-lima/10 px-3 py-2 text-sm">
                <span className="font-semibold text-bosque">
                  Cupón {coupon.code} aplicado (-{coupon.percentage}%)
                </span>
                <couponFetcher.Form method="post" action="/tienda">
                  <input type="hidden" name="intent" value="remove-coupon" />
                  <button type="submit" className="min-h-11 min-w-11 text-carbon/50 hover:text-carbon">
                    ✕
                  </button>
                </couponFetcher.Form>
              </div>
            ) : (
              <couponFetcher.Form method="post" action="/tienda" className="flex gap-2">
                <input type="hidden" name="intent" value="apply-coupon" />
                <input
                  type="text"
                  name="code"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                  placeholder="Código de descuento"
                  className="min-h-11 flex-1 rounded-full border border-carbon/15 px-4 text-sm uppercase focus:border-oliva focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isApplyingCoupon || !codeInput}
                  className="min-h-11 rounded-full border border-carbon/20 px-4 text-sm font-semibold text-carbon disabled:opacity-50"
                >
                  Aplicar
                </button>
              </couponFetcher.Form>
            )}
            {couponFetcher.data?.error && (
              <p className="mt-1 text-xs font-semibold text-red-600">{couponFetcher.data.error}</p>
            )}
          </div>

          <div className="border-t border-carbon/10 pt-4">
            {discountPercent > 0 && (
              <div className="mb-1 flex justify-between text-sm text-bosque">
                <span>{coupon ? "Descuento aplicado" : "Descuento de fidelidad"}</span>
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
