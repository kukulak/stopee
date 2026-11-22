import { Link, useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import type { CatalogItem } from "~/lib/catalog.server";
import { trackEvent } from "~/lib/trackClient";
import { formatPresentation } from "~/lib/productUnit";
import { ArrowLink } from "~/components/ui/ArrowLink";
import { remainingToAdd } from "~/lib/stock";

/**
 * El "glorificador" — el producto o paquete que el admin marcó como estrella
 * (marcado como estrella en /admin/catalog) se muestra primero y con más peso visual que el
 * resto del catálogo, como el mostrador principal de una tienda física.
 */
export function FeaturedProductShowcase({
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
    <div className="grid grid-cols-1 overflow-hidden rounded-3xl border border-lima/30 bg-gradient-to-br from-bosque/5 to-lima/10 lg:grid-cols-2">
      <Link
        to={`/tienda/${product.sku}`}
        className="flex aspect-square items-center justify-center overflow-hidden bg-gradient-to-br from-lima/20 to-bosque/10 lg:aspect-auto"
      >
        {product.image ? (
          <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="font-display text-2xl font-black text-bosque/40">STOPee</div>
        )}
      </Link>

      <div className="flex flex-col justify-center gap-3 p-6 sm:p-10">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-lima px-3 py-1 text-xs font-bold uppercase tracking-wide text-carbon">
          Más vendido
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/tienda/${product.sku}`} className="font-display text-2xl font-black text-carbon hover:underline sm:text-3xl">
            {product.name}
          </Link>
          {product.unitValue && product.unit && (
            <span className="rounded-full bg-bosque/10 px-2 py-0.5 text-xs font-semibold text-bosque">
              {formatPresentation(product.unitValue, product.unit)}
            </span>
          )}
        </div>
        <p className="max-w-md text-carbon/70">{product.shortDescription}</p>
        <ArrowLink to={`/tienda/${product.sku}`} className="min-h-9 text-sm">
          Ver detalles e ingredientes
        </ArrowLink>

        <span className="mt-2 font-display text-3xl font-black text-carbon">
          ${product.priceMxn} <span className="text-sm font-medium text-carbon/50">MXN</span>
        </span>

        <div className="mt-2 flex items-center gap-2">
          <div className="flex shrink-0 items-center rounded-full border border-carbon/15 bg-hueso">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label={`Reducir cantidad de ${product.name}`}
              className="flex min-h-12 min-w-12 items-center justify-center rounded-full text-carbon hover:bg-carbon/5"
            >
              −
            </button>
            <span className="w-6 text-center text-sm font-semibold text-carbon" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                disabled={atMax}
              aria-label={`Aumentar cantidad de ${product.name}`}
              className="flex min-h-12 min-w-12 items-center justify-center rounded-full text-carbon hover:bg-carbon/5 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              +
            </button>
          </div>

          <fetcher.Form method="post" action="/tienda" className="min-w-0 flex-1 sm:flex-none">
            <input type="hidden" name="intent" value="add-to-cart" />
            <input type="hidden" name="sku" value={product.sku} />
            <input type="hidden" name="quantity" value={quantity} />
            <button
              type="submit"
              disabled={isAdding || soldOut || cartIsFull}
              className="min-h-12 w-full rounded-full bg-carbon px-8 text-sm font-bold text-hueso transition-transform hover:scale-105 active:scale-95 disabled:opacity-60 sm:w-auto"
            >
              {soldOut ? "Agotado" : isAdding ? "Agregando…" : "Agregar al carrito"}
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
      </div>
    </div>
  );
}
