import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
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
import { LegalNotice } from "~/components/ui/LegalNotice";
import { usePageShowReset } from "~/lib/usePageShowReset";
import { DeliveryAddressFields, type AddressDefaults } from "~/components/ecommerce/DeliveryAddressFields";
import { InvoiceFields } from "~/components/ecommerce/InvoiceFields";
import type { BillingErrors, BillingInfo } from "~/lib/fiscal";
import { ADDRESS_FIELDS, normalizePhone, type AddressErrors } from "~/lib/deliveryAddress";
import { subscriptionPageUrl, type BoxLine } from "~/lib/subscriptionBox";
import type { AddressOption } from "~/lib/addressBook";
import type { DeliveryZone } from "~/lib/deliveryZone";
import { BrandText } from "~/components/ui/BrandText";

const SUBSCRIPTION_FORM_ID = "subscription-form";

/**
 * ¿Ya están los datos de entrega que pide el servidor? Misma regla que
 * `validateDeliveryAddress` (nombre, teléfono de 10 dígitos, código postal de 5,
 * calle y alcaldía), para que el botón solo se encienda cuando el pago puede seguir.
 */
function isDeliveryFormComplete(form: HTMLFormElement): boolean {
  const value = (key: keyof typeof ADDRESS_FIELDS) =>
    (form.elements.namedItem(ADDRESS_FIELDS[key]) as HTMLInputElement | null)?.value.trim() ?? "";
  return (
    value("name").length >= 3 &&
    normalizePhone(value("phone")) !== null &&
    /^\d{5}$/.test(value("postalCode")) &&
    value("line1").length >= 3 &&
    value("city").length >= 2
  );
}

export function SubscriptionConfigurator({
  products,
  config,
  preselectedSku,
  deliveryZone,
  addressDefaults,
  addressBook,
  mode = "checkout",
  initialBox,
  initialFrequency,
  isLoggedIn = true,
  billingDefaults,
  invoiceEmail,
}: {
  products: CatalogItem[];
  config: SubscriptionConfig;
  /** Llega desde el banner de un producto puntual (?sku=...) — precarga esa caja con 1 unidad para no obligar a rearmarla desde cero. */
  preselectedSku?: string | null;
  /** Zona donde se entrega: fuera de ella no se puede contratar. */
  deliveryZone: DeliveryZone;
  /** Lo que ya sabemos de la persona (su perfil), para que no escriba su dirección otra vez. */
  addressDefaults?: AddressDefaults;
  /** Las direcciones guardadas en su cuenta (`null` si no ha iniciado sesión). */
  addressBook?: AddressOption[] | null;
  /**
   * "preview" (en /tienda): solo se arma la caja y se continúa en /suscripcion, sin pedir dirección.
   * "checkout" (en /suscripcion): la caja se termina con los datos de entrega y se activa.
   */
  mode?: "preview" | "checkout";
  /** La caja que viene armada desde /tienda (`?caja=`), ya validada contra el catálogo. */
  initialBox?: BoxLine[];
  /** La frecuencia que traía desde /tienda (`?frecuencia=`). */
  initialFrequency?: string | null;
  /** Sin sesión no se puede activar: se invita a entrar sin perder la caja. */
  isLoggedIn?: boolean;
  /** Los datos fiscales guardados en su cuenta, para que no los escriba otra vez. */
  billingDefaults?: BillingInfo | null;
  /** A dónde pedir una factura después (de «Datos del negocio»). */
  invoiceEmail?: string | null;
}) {
  // Arranca con 1 unidad (la del producto elegido o, si no hay, el primero): así la frecuencia, el
  // precio con descuento y el botón se ven activos desde el primer momento, no bloqueados.
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    if (initialBox && initialBox.length > 0) {
      return Object.fromEntries(initialBox.filter((line) => products.some((p) => p.sku === line.sku)).map((l) => [l.sku, l.quantity]));
    }
    const first = preselectedSku && products.some((p) => p.sku === preselectedSku) ? preselectedSku : products[0]?.sku;
    return first ? { [first]: 1 } : {};
  });
  const { discountPercent } = config;
  const frequencies = activeFrequencies(config);
  const [frequency, setFrequency] = useState(() =>
    initialFrequency && frequencies.some((f) => frequencyKey(f.weeks) === initialFrequency)
      ? initialFrequency
      : defaultFrequencyKey(config),
  );
  const selectedWeeks = frequencies.find((f) => frequencyKey(f.weeks) === frequency)?.weeks;
  // Si la persona se va a pagar y regresa con «atrás», el botón vuelve a estar listo.
  const restores = usePageShowReset();
  const fetcher = useFetcher<{ error?: string; fieldErrors?: AddressErrors; invoiceErrors?: BillingErrors }>({ key: `subscription-${restores}` });
  const isSubmitting = fetcher.state !== "idle";
  const [outOfZone, setOutOfZone] = useState(false);
  // El botón de activar solo se enciende con los datos de entrega completos: un botón de color
  // invita a pulsarlo, y que responda "falta algo" es una vuelta que la persona no necesita.
  const formRef = useRef<HTMLFormElement>(null);
  const [deliveryComplete, setDeliveryComplete] = useState(false);
  const recheckDelivery = useCallback(() => {
    if (formRef.current) setDeliveryComplete(isDeliveryFormComplete(formRef.current));
  }, []);

  const items = useMemo(
    () => products.filter((p) => (quantities[p.sku] ?? 0) > 0).map((p) => ({ product: p, quantity: quantities[p.sku] })),
    [products, quantities],
  );
  const hasItems = items.length > 0;
  // La página llega con la dirección del perfil ya escrita: se revisa al aparecer el formulario.
  useEffect(() => {
    recheckDelivery();
  }, [recheckDelivery, hasItems, isLoggedIn, mode]);
  const subtotal = items.reduce((sum, i) => sum + i.product.priceMxn * i.quantity, 0);
  const total = Math.round(subtotal * (1 - discountPercent / 100));
  const savings = subtotal - total;

  function updateQuantity(sku: string, quantity: number) {
    setQuantities((prev) => ({ ...prev, [sku]: Math.max(0, Math.min(99, quantity)) }));
  }

  return (
    <div id="suscripcion" className="scroll-mt-32 rounded-3xl border border-lima/30 bg-bosque/5 p-6 sm:p-8">
      <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva"><BrandText>{programEyebrow(config)}</BrandText></p>
      <h3 className="mt-2 font-display text-2xl font-black text-carbon">{fillDiscount(config.headline, config)}</h3>
      <p className="mt-2 max-w-2xl text-sm font-semibold text-carbon">
        Cuando sepas cuánto te dura tu primer litro, activa tu suscripción periódica.
      </p>
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

      {/* Paso 3: revisa tu caja */}
      {hasItems && (
        <div className="mt-6 rounded-2xl border-2 border-lima/40 bg-hueso p-5">
          <p className="text-sm font-semibold text-carbon">
            {mode === "preview" ? "3. Tu caja" : "3. Revisa tu caja antes de confirmar"}
          </p>
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

          {mode === "preview" ? (
            /* En la tienda solo se arma la caja: la dirección se pide en el siguiente paso. */
            <div className="mt-5 flex flex-col items-end gap-2 border-t border-carbon/10 pt-4">
              <Link
                to={subscriptionPageUrl(quantities, frequency)}
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-lima px-8 text-sm font-bold text-carbon transition-transform hover:scale-105 active:scale-95"
              >
                Continuar con tu pedido
              </Link>
              <p className="text-xs text-carbon/60">En el siguiente paso eliges a dónde te lo enviamos.</p>
            </div>
          ) : (
            <>
              {config.disclaimer && <p className="mt-4 rounded-xl bg-carbon/5 p-3 text-xs text-carbon/60">{config.disclaimer}</p>}

              {isLoggedIn ? (
                <fetcher.Form
                  ref={formRef}
                  id={SUBSCRIPTION_FORM_ID}
                  method="post"
                  action="/api/subscription"
                  onInput={recheckDelivery}
                  className="mt-4"
                >
                  <input type="hidden" name="frequency" value={frequency} />
                  {items.map(({ product }) => (
                    <input key={product.sku} type="hidden" name="sku" value={product.sku} />
                  ))}
                  {items.map(({ product, quantity }) => (
                    <input key={`${product.sku}-qty`} type="hidden" name="quantity" value={quantity} />
                  ))}
                  {/* La caja llega siempre a domicilio: dirección completa. */}
                  <DeliveryAddressFields
                    formId={SUBSCRIPTION_FORM_ID}
                    mode="home"
                    zone={deliveryZone}
                    defaults={addressDefaults}
                    addressBook={addressBook}
                    errors={fetcher.data?.fieldErrors}
                    onOutOfZoneChange={setOutOfZone}
                    onAddressChange={recheckDelivery}
                  />
                  <div className="mt-4">
                    <InvoiceFields
                      formId={SUBSCRIPTION_FORM_ID}
                      defaults={billingDefaults}
                      errors={fetcher.data?.invoiceErrors}
                      signedIn
                      invoiceEmail={invoiceEmail}
                      recurring
                    />
                  </div>
                  <div className="mt-4 flex flex-col items-end gap-2">
                    <button
                      type="submit"
                      disabled={isSubmitting || outOfZone || !deliveryComplete}
                      className="inline-flex min-h-12 items-center justify-center rounded-full bg-lima px-8 text-sm font-bold text-carbon transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-not-allowed disabled:bg-carbon/10 disabled:text-carbon/40"
                    >
                      {isSubmitting ? "Redirigiendo…" : config.ctaLabel}
                    </button>
                    {!isSubmitting && !outOfZone && !deliveryComplete && (
                      <p className="text-xs text-carbon/60" role="status">
                        Completa tus datos de entrega para activar tu suscripción.
                      </p>
                    )}
                  </div>
                  <LegalNotice action="activar tu suscripción" newTab className="mt-3 text-right" />
                  {fetcher.data?.error && (
                    <p className="mt-3 text-right text-sm font-semibold text-red-600">{fetcher.data.error}</p>
                  )}
                </fetcher.Form>
              ) : (
                /* Sin sesión no hay a nombre de quién activar: se entra y se regresa a esta misma caja. */
                <div className="mt-5 flex flex-col items-end gap-2 border-t border-carbon/10 pt-4">
                  <Link
                    to={`/cuenta/entrar?redirectTo=${encodeURIComponent(subscriptionPageUrl(quantities, frequency))}`}
                    className="inline-flex min-h-12 items-center justify-center rounded-full bg-lima px-8 text-sm font-bold text-carbon transition-transform hover:scale-105 active:scale-95"
                  >
                    Inicia sesión para continuar
                  </Link>
                  <p className="text-xs text-carbon/60">
                    Al entrar regresas a esta misma caja. ¿Aún no tienes cuenta?{" "}
                    <Link to="/cuenta/registro" className="font-semibold text-bosque underline">
                      Créala aquí
                    </Link>
                    .
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
