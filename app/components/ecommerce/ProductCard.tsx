import { Link, useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import type { Product } from "~/data/products";
import { trackEvent } from "~/lib/trackClient";
import { formatPresentation } from "~/lib/productUnit";

export function ProductCard({ product }: { product: Product }) {
  const fetcher = useFetcher();
  const isAdding = fetcher.state !== "idle";
  const wasAdding = useRef(false);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (wasAdding.current && !isAdding && fetcher.data) {
      trackEvent("add_to_cart", product.sku);
      setQuantity(1);
    }
    wasAdding.current = isAdding;
  }, [isAdding, fetcher.data, product.sku]);

  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-carbon/10 bg-hueso transition-shadow hover:shadow-lg">
      <Link to={`/tienda/${product.sku}`} className="flex aspect-square items-center justify-center bg-gradient-to-br from-lima/20 to-bosque/10">
        <div className="font-display text-lg font-black text-bosque/40">STOPee</div>
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/tienda/${product.sku}`} className="font-display text-lg font-bold text-carbon hover:underline">
              {product.name}
            </Link>
            {product.unitValue && product.unit && (
              <span className="rounded-full bg-bosque/10 px-2 py-0.5 text-xs font-semibold text-bosque">
                {formatPresentation(product.unitValue, product.unit)}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-carbon/60">{product.shortDescription}</p>
          <Link to={`/tienda/${product.sku}`} className="mt-1 inline-block text-xs font-semibold text-bosque hover:underline">
            Ver detalles e ingredientes →
          </Link>
        </div>

        <div className="mt-auto flex flex-col gap-3 pt-2">
          <span className="font-display text-xl font-black text-carbon">
            ${product.priceMxn} <span className="text-xs font-medium text-carbon/50">MXN</span>
          </span>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-full border border-carbon/15">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                aria-label={`Reducir cantidad de ${product.name}`}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon hover:bg-carbon/5"
              >
                −
              </button>
              <span className="w-6 text-center text-sm font-semibold text-carbon" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                aria-label={`Aumentar cantidad de ${product.name}`}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon hover:bg-carbon/5"
              >
                +
              </button>
            </div>

            <fetcher.Form method="post" action="/tienda" className="flex-1">
              <input type="hidden" name="intent" value="add-to-cart" />
              <input type="hidden" name="sku" value={product.sku} />
              <input type="hidden" name="quantity" value={quantity} />
              <button
                type="submit"
                disabled={isAdding}
                className="min-h-11 w-full rounded-full bg-carbon px-5 text-sm font-bold text-hueso transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
              >
                {isAdding ? "Agregando…" : "Agregar"}
              </button>
            </fetcher.Form>
          </div>
        </div>
      </div>
    </div>
  );
}
