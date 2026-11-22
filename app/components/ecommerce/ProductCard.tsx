import { Link, useFetcher } from "react-router";
import { useEffect, useRef, useState } from "react";
import type { CatalogItem } from "~/lib/catalog.server";
import { trackEvent } from "~/lib/trackClient";
import { formatPresentation } from "~/lib/productUnit";
import { ArrowLink } from "~/components/ui/ArrowLink";
import { remainingToAdd } from "~/lib/stock";

export function ProductCard({
  product,
  onAdded,
  inCartQuantity = 0,
}: {
  product: CatalogItem;
  onAdded?: (name: string) => void;
  /** Cuántas unidades de este producto ya están en el carrito, para no ofrecer más de la existencia. */
  inCartQuantity?: number;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string; notice?: string }>();
  const isAdding = fetcher.state !== "idle";
  const wasAdding = useRef(false);
  const [quantity, setQuantity] = useState(1);
  const maxQuantity = remainingToAdd(product.stock, inCartQuantity);
  const soldOut = product.stock <= 0;
  const cartIsFull = !soldOut && maxQuantity <= 0;
  const atMax = quantity >= maxQuantity;

  // Si el tope baja (ya agregó al carrito) la cantidad elegida no se pasa de él.
  useEffect(() => {
    setQuantity((q) => Math.max(1, Math.min(q, maxQuantity || 1)));
  }, [maxQuantity]);

  useEffect(() => {
    if (wasAdding.current && !isAdding && fetcher.data?.ok) {
      trackEvent("add_to_cart", product.sku);
      onAdded?.(product.name);
      setQuantity(1);
    }
    wasAdding.current = isAdding;
  }, [isAdding, fetcher.data, product.sku, product.name, onAdded]);

  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-carbon/10 bg-hueso transition-shadow hover:shadow-lg">
      <Link to={`/tienda/${product.sku}`} className="flex aspect-square items-center justify-center overflow-hidden bg-gradient-to-br from-lima/20 to-bosque/10">
        {product.image ? (
          <img src={product.image} alt={product.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="font-display text-lg font-black text-bosque/40">STOPee</div>
        )}
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
          <ArrowLink to={`/tienda/${product.sku}`} className="mt-1 min-h-9 text-sm">
            Ver detalles e ingredientes
          </ArrowLink>
        </div>

        <div className="mt-auto flex flex-col gap-3 pt-2">
          <span className="font-display text-xl font-black text-carbon">
            ${product.priceMxn} <span className="text-xs font-medium text-carbon/50">MXN</span>
          </span>

          <div className="flex items-center gap-1.5">
            <div className="flex shrink-0 items-center rounded-full border border-carbon/15">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                aria-label={`Reducir cantidad de ${product.name}`}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon hover:bg-carbon/5"
              >
                −
              </button>
              <span className="w-5 text-center text-sm font-semibold text-carbon" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                disabled={atMax}
                aria-label={`Aumentar cantidad de ${product.name}`}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon hover:bg-carbon/5 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                +
              </button>
            </div>

            <fetcher.Form method="post" action="/tienda" className="min-w-0 flex-1">
              <input type="hidden" name="intent" value="add-to-cart" />
              <input type="hidden" name="sku" value={product.sku} />
              <input type="hidden" name="quantity" value={quantity} />
              <button
                type="submit"
                disabled={isAdding || soldOut || cartIsFull}
                className="min-h-11 w-full rounded-full bg-carbon px-3 text-sm font-bold text-hueso transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
              >
                {soldOut ? "Agotado" : isAdding ? "Agregando…" : "Agregar"}
              </button>
            </fetcher.Form>
          </div>

          <p className="min-h-4 text-xs text-carbon/60" aria-live="polite">
            {fetcher.data?.error ? (
              <span className="font-semibold text-red-600">{fetcher.data.error}</span>
            ) : cartIsFull ? (
              `Ya tienes en tu carrito las ${product.stock} unidades disponibles.`
            ) : atMax && !soldOut ? (
              `Máximo disponible: ${maxQuantity}.`
            ) : !soldOut && product.stock <= 5 ? (
              `Quedan solo ${product.stock}.`
            ) : null}
          </p>

          {product.kind === "product" && product.isSubscribable && (
            <Link
              to={`/suscripcion?sku=${product.sku}`}
              className="text-center text-xs font-semibold text-bosque hover:underline"
            >
              También disponible en auto-envío periódico
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
