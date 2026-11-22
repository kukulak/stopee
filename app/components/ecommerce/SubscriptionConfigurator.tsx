import { useMemo, useState } from "react";
import { useFetcher } from "react-router";
import type { CatalogItem } from "~/lib/catalog.server";
import { CheckIcon } from "~/components/ui/Icons";
import {
  activeFrequencies,
  defaultFrequencyKey,
  fillDiscount,
  frequencyKey,
  frequencyLabelForWeeks,
  programEyebrow,
  type SubscriptionConfig,
} from "~/lib/subscriptionConfig";

export function SubscriptionConfigurator({
  products,
  config,
  preselectedSku,
}: {
  products: CatalogItem[];
  config: SubscriptionConfig;
  /** Llega desde el banner de un producto puntual (?sku=...) — precarga esa caja con 1 unidad para no obligar a rearmarla desde cero. */
  preselectedSku?: string | null;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    preselectedSku && products.some((p) => p.sku === preselectedSku) ? { [preselectedSku]: 1 } : {},
  );
  const { discountPercent } = config;
  const frequencies = activeFrequencies(config);
  const [frequency, setFrequency] = useState(() => defaultFrequencyKey(config));
  const selectedWeeks = frequencies.find((f) => frequencyKey(f.weeks) === frequency)?.weeks;
  const fetcher = useFetcher<{ error?: string }>();
  const isSubmitting = fetcher.state !== "idle";

  const items = useMemo(
    () => products.filter((p) => (quantities[p.sku] ?? 0) > 0).map((p) => ({ product: p, quantity: quantities[p.sku] })),
    [products, quantities],
  );
  const hasItems = items.length > 0;
  const subtotal = items.reduce((sum, i) => sum + i.product.priceMxn * i.quantity, 0);
  const total = Math.round(subtotal * (1 - discountPercent / 100));
  const savings = subtotal - total;

  function updateQuantity(sku: string, quantity: number) {
    setQuantities((prev) => ({ ...prev, [sku]: Math.max(0, Math.min(99, quantity)) }));
  }

  return (
    <div id="suscripcion" className="rounded-3xl border border-lima/30 bg-bosque/5 p-6 sm:p-8">
      <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">{programEyebrow(config)}</p>
      <h3 className="mt-2 font-display text-2xl font-black text-carbon">{fillDiscount(config.headline, config)}</h3>
      {config.description && <p className="mt-2 max-w-2xl text-sm text-carbon/70">{config.description}</p>}

      {config.benefits.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-1.5">
          {config.benefits.map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm text-carbon/70">
              <CheckIcon className="h-4 w-4 shrink-0 text-bosque" />
              {item}
            </li>
          ))}
        </ul>
      )}

      {/* Paso 1: arma tu caja */}
      <div className="mt-6">
        <p className="text-sm font-semibold text-carbon">1. Elige qué va en tu caja</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {products.map((p) => {
            const quantity = quantities[p.sku] ?? 0;
            return (
              <div
                key={p.sku}
                className={`flex items-center justify-between gap-3 rounded-2xl border-2 p-4 transition-colors ${
                  quantity > 0 ? "border-lima bg-lima/10" : "border-carbon/10 bg-hueso"
                }`}
              >
                <div>
                  <p className="font-display font-bold text-carbon">{p.name}</p>
                  <p className="text-xs text-carbon/60">${p.priceMxn} MXN c/u</p>
                </div>
                <div className="flex shrink-0 items-center rounded-full border border-carbon/15 bg-white">
                  <button
                    type="button"
                    onClick={() => updateQuantity(p.sku, quantity - 1)}
                    aria-label={`Quitar una unidad de ${p.name}`}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon hover:bg-carbon/5"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-semibold text-carbon" aria-live="polite">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(p.sku, quantity + 1)}
                    aria-label={`Agregar una unidad de ${p.name}`}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon hover:bg-carbon/5"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Paso 2: frecuencia — solo importa una vez que ya hay algo en la caja */}
      <div className={`mt-6 transition-opacity ${hasItems ? "" : "pointer-events-none opacity-40"}`}>
        <p className="text-sm font-semibold text-carbon">2. Elige la frecuencia</p>
        <fieldset className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="sr-only">Elige tu frecuencia de entrega</legend>
          {frequencies.map((freq) => (
            <label
              key={freq.weeks}
              className={`relative flex min-h-11 cursor-pointer flex-col rounded-2xl border-2 p-4 transition-colors ${
                frequency === frequencyKey(freq.weeks) ? "border-lima bg-lima/10" : "border-carbon/10 bg-hueso hover:border-carbon/20"
              }`}
            >
              {freq.recommended && (
                <span className="absolute -top-2.5 left-4 rounded-full bg-lima px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-carbon">
                  Recomendado
                </span>
              )}
              <input
                type="radio"
                name="frequencyChoice"
                value={frequencyKey(freq.weeks)}
                checked={frequency === frequencyKey(freq.weeks)}
                onChange={() => setFrequency(frequencyKey(freq.weeks))}
                className="sr-only"
              />
              <span className="font-display font-bold text-carbon">{frequencyLabelForWeeks(freq.weeks)}</span>
              {freq.hint && <span className="mt-1 text-xs text-carbon/60">{freq.hint}</span>}
            </label>
          ))}
        </fieldset>
      </div>

      {/* Paso 3: revisa y confirma */}
      {hasItems && (
        <div className="mt-6 rounded-2xl border-2 border-lima/40 bg-hueso p-5">
          <p className="text-sm font-semibold text-carbon">3. Revisa tu caja antes de confirmar</p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {items.map(({ product, quantity }) => (
              <li key={product.sku} className="flex items-center justify-between text-sm text-carbon/80">
                <span>
                  {quantity}× {product.name}
                </span>
                <span>${(product.priceMxn * quantity).toFixed(0)} MXN</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-baseline justify-between border-t border-carbon/10 pt-3">
            <span className="text-sm text-carbon/60">
              {selectedWeeks ? frequencyLabelForWeeks(selectedWeeks) : ""}
            </span>
            <span className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-black text-carbon">${total} MXN</span>
              <span className="text-sm text-carbon/40 line-through">${subtotal} MXN</span>
            </span>
          </div>
          <p className="text-right text-xs text-carbon/50">+ envío, calculado por separado según tu código postal</p>
          {savings > 0 && <p className="mt-1 text-right text-sm font-semibold text-bosque">Ahorras ${savings} MXN por entrega</p>}

          {config.disclaimer && <p className="mt-4 rounded-xl bg-carbon/5 p-3 text-xs text-carbon/60">{config.disclaimer}</p>}

          <fetcher.Form method="post" action="/api/subscription" className="mt-4">
            <input type="hidden" name="frequency" value={frequency} />
            {items.map(({ product, quantity }) => (
              <input key={product.sku} type="hidden" name="sku" value={product.sku} />
            ))}
            {items.map(({ product, quantity }) => (
              <input key={`${product.sku}-qty`} type="hidden" name="quantity" value={quantity} />
            ))}
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-12 w-full rounded-full bg-lima px-8 text-sm font-bold text-carbon transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
            >
              {isSubmitting ? "Redirigiendo…" : config.ctaLabel}
            </button>
            {fetcher.data?.error && <p className="mt-3 text-sm font-semibold text-red-600">{fetcher.data.error}</p>}
          </fetcher.Form>
        </div>
      )}
    </div>
  );
}
