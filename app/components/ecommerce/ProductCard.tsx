import { useFetcher } from "@remix-run/react";
import type { Product } from "~/data/products";

export function ProductCard({ product }: { product: Product }) {
  const fetcher = useFetcher();
  const isAdding = fetcher.state !== "idle";

  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-carbon/10 bg-hueso transition-shadow hover:shadow-lg">
      <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-lima/20 to-bosque/10">
        <div className="font-display text-lg font-black text-bosque/40">STOPee</div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <h3 className="font-display text-lg font-bold text-carbon">{product.name}</h3>
          <p className="mt-1 text-sm text-carbon/60">{product.shortDescription}</p>
        </div>

        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="font-display text-xl font-black text-carbon">
            ${product.priceMxn} <span className="text-xs font-medium text-carbon/50">MXN</span>
          </span>

          <fetcher.Form method="post" action="/tienda">
            <input type="hidden" name="intent" value="add-to-cart" />
            <input type="hidden" name="sku" value={product.sku} />
            <button
              type="submit"
              disabled={isAdding}
              className="min-h-11 rounded-full bg-carbon px-5 text-sm font-bold text-hueso transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
            >
              {isAdding ? "Agregando…" : "Agregar"}
            </button>
          </fetcher.Form>
        </div>
      </div>
    </div>
  );
}
