import { Link, useFetcher } from "react-router";
import { useState } from "react";
import type { CatalogItem } from "~/lib/catalog.server";
import type { ShippingQuote } from "~/models/shipping.server";
import { CloseIcon, TrashIcon } from "~/components/ui/Icons";
import { usePageShowReset } from "~/lib/usePageShowReset";
import { LegalNotice } from "~/components/ui/LegalNotice";
import { DeliveryAddressFields, type AddressDefaults } from "~/components/ecommerce/DeliveryAddressFields";
import type { AddressErrors } from "~/lib/deliveryAddress";
import type { DeliveryZone } from "~/lib/deliveryZone";

const CHECKOUT_FORM_ID = "checkout-form";

export type CartLine = {
  sku: string;
  quantity: number;
  product: CatalogItem;
};

function CartLineRow({ line }: { line: CartLine }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string; notice?: string }>();
  const isUpdating = fetcher.state !== "idle";
  const stock = line.product.stock;
  const atMax = line.quantity >= stock;
  const overStock = line.quantity > stock;

  function updateQuantity(quantity: number) {
    fetcher.submit(
      { intent: "update-quantity", sku: line.sku, quantity: String(quantity) },
      { method: "post", action: "/tienda" },
    );
  }

  return (
    <li className={`flex items-center justify-between gap-3 ${isUpdating ? "opacity-60" : ""}`}>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-carbon">{line.product.name}</p>
        <p className="text-xs text-carbon/50">${line.product.priceMxn} MXN c/u</p>
        {(fetcher.data?.error || fetcher.data?.notice || overStock || (atMax && stock > 0)) && (
          <p className={`mt-0.5 text-xs ${overStock || fetcher.data?.error ? "font-semibold text-red-600" : "text-carbon/60"}`}>
            {fetcher.data?.error ??
              fetcher.data?.notice ??
              (stock <= 0
                ? "Agotado: quítalo del carrito para poder pagar."
                : overStock
                  ? `Solo hay ${stock} disponibles: baja la cantidad para poder pagar.`
                  : "Máximo disponible.")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {/* La cantidad y el quitar van separados: restar nunca borra el producto por accidente. */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => updateQuantity(line.quantity - 1)}
            disabled={isUpdating || line.quantity <= 1}
            aria-label={`Reducir cantidad de ${line.product.name}`}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon/60 hover:bg-carbon/5 disabled:opacity-40"
          >
            −
          </button>
          <span className="w-6 text-center text-sm font-semibold text-carbon" aria-live="polite">
            {line.quantity}
          </span>
          <button
            type="button"
            onClick={() => updateQuantity(line.quantity + 1)}
            disabled={isUpdating || atMax}
            aria-label={`Aumentar cantidad de ${line.product.name}`}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon/60 hover:bg-carbon/5 disabled:opacity-50"
          >
            +
          </button>
        </div>
        <button
          type="button"
          onClick={() => updateQuantity(0)}
          disabled={isUpdating}
          aria-label={`Quitar ${line.product.name} del carrito`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon/40 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          <TrashIcon className="h-5 w-5" />
        </button>
      </div>
    </li>
  );
}

export function CartDrawer({
  lines,
  subtotalMxn,
  discountPercent,
  discountLabel,
  coupon,
  couponNotice,
  gifts,
  shipping,
  deliveryZone,
  addressDefaults,
  onClose,
}: {
  lines: CartLine[];
  subtotalMxn: number;
  discountPercent: number;
  discountLabel?: string;
  coupon: { code: string; percentage: number } | null;
  /** Cupón guardado que todavía no se puede aplicar (compra mínima, producto requerido, sesión…). */
  couponNotice?: { code: string; message: string; cta: "login" | "verify" | null } | null;
  gifts?: string[];
  shipping: ShippingQuote;
  /** Zona donde se entrega: fuera de ella no se puede pagar. */
  deliveryZone: DeliveryZone;
  /** Lo que ya sabemos de la persona (su perfil), para que no escriba su dirección otra vez. */
  addressDefaults?: AddressDefaults;
  /** Cierra el panel del carrito (el botón del carrito vacío lo usa antes de llevar a la tienda). */
  onClose?: () => void;
}) {
  // Si la persona se va a pagar y regresa con «atrás», el botón vuelve a estar listo.
  const restores = usePageShowReset();
  const checkoutFetcher = useFetcher<{ error?: string; fieldErrors?: AddressErrors }>({ key: `checkout-${restores}` });
  const couponFetcher = useFetcher<{ error?: string; ok?: boolean; cta?: "login" | "verify" | null }>();
  const isCheckingOut = checkoutFetcher.state !== "idle";
  const isApplyingCoupon = couponFetcher.state !== "idle";
  // Sin internet la petición ni sale, y Remix mandaría a la pantalla de "Algo salió mal". Se avisa aquí, con el carrito a la vista.
  const [offline, setOffline] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  // El código postal escrito está fuera de la zona de entrega: no se puede pagar hasta corregirlo.
  const [outOfZone, setOutOfZone] = useState(false);
  const discountedSubtotal = Math.round(subtotalMxn * (1 - discountPercent / 100));
  // La opción que el cliente acaba de tocar se refleja al instante en el total, sin esperar al servidor.
  const [pendingMethod, setPendingMethod] = useState<string | null>(null);
  const selectedShipping =
    shipping.options.find((option) => option.id === pendingMethod) ?? shipping.selected;
  const shippingCost = selectedShipping?.cost ?? 0;
  const totalMxn = discountedSubtotal + shippingCost;
  // Algo del carrito supera la existencia (se agotó o bajó el stock después de agregarlo): no se deja pagar.
  const hasStockProblem = lines.some((line) => line.quantity > line.product.stock);

  return (
    <div id="carrito" className="flex flex-col gap-4">
      {lines.length === 0 ? (
        <div className="flex flex-col items-start gap-4">
          <p className="text-sm text-carbon/70">Tu carrito está vacío. Explora nuestros productos.</p>
          <Link
            to="/tienda"
            onClick={onClose}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-carbon px-6 text-sm font-bold text-hueso transition-transform hover:scale-105 active:scale-95"
          >
            Explorar productos
          </Link>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {lines.map((line) => (
              <CartLineRow key={line.sku} line={line} />
            ))}
          </ul>

          {gifts && gifts.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {gifts.map((name) => (
                <div key={name} className="flex items-center gap-2 rounded-xl bg-lima/10 px-3 py-2 text-sm">
                  <span className="font-semibold text-bosque">Llévate gratis: {name}</span>
                </div>
              ))}
            </div>
          )}

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
                    <CloseIcon className="mx-auto block h-4 w-4" />
                  </button>
                </couponFetcher.Form>
              </div>
            ) : couponNotice ? (
              <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">Cupón {couponNotice.code} guardado, aún sin aplicar</p>
                  <couponFetcher.Form method="post" action="/tienda">
                    <input type="hidden" name="intent" value="remove-coupon" />
                    <button type="submit" aria-label="Quitar cupón" className="-my-2 min-h-11 min-w-11 text-amber-900/60 hover:text-amber-900">
                      <CloseIcon className="mx-auto block h-4 w-4" />
                    </button>
                  </couponFetcher.Form>
                </div>
                <p className="mt-0.5">{couponNotice.message}</p>
                {couponNotice.cta && (
                  <a
                    href={couponNotice.cta === "login" ? "/cuenta/entrar?redirectTo=%2Ftienda" : "/cuenta"}
                    className="mt-2 inline-flex min-h-11 items-center font-bold underline"
                  >
                    {couponNotice.cta === "login" ? "Iniciar sesión" : "Ir a mi cuenta"}
                  </a>
                )}
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
              <p className="mt-1 text-xs font-semibold text-red-600">
                {couponFetcher.data.error}
                {couponFetcher.data.cta && (
                  <>
                    {" "}
                    <a
                      href={couponFetcher.data.cta === "login" ? "/cuenta/entrar?redirectTo=%2Ftienda" : "/cuenta"}
                      className="underline"
                    >
                      {couponFetcher.data.cta === "login" ? "Iniciar sesión" : "Ir a mi cuenta"}
                    </a>
                  </>
                )}
              </p>
            )}
          </div>

          <ShippingMethods shipping={shipping} selectedId={selectedShipping?.id ?? null} onPending={setPendingMethod} />

          <DeliveryAddressFields
            formId={CHECKOUT_FORM_ID}
            // Sin método elegido (envío apagado) también se necesita la dirección completa.
            mode={selectedShipping?.id === "pickup" ? "pickup" : "home"}
            zone={deliveryZone}
            defaults={addressDefaults}
            errors={checkoutFetcher.data?.fieldErrors}
            onOutOfZoneChange={setOutOfZone}
          />

          <div className="border-t border-carbon/10 pt-4">
            {discountPercent > 0 && (
              <div className="mb-1 flex justify-between text-sm text-bosque">
                <span>{discountLabel || "Descuento aplicado"}</span>
                <span>-{discountPercent}%</span>
              </div>
            )}
            {selectedShipping && (
              <div className="mb-1 flex justify-between gap-4 text-sm text-carbon/60">
                <span>Envío</span>
                <span className={selectedShipping.isFree ? "font-semibold text-bosque" : ""}>
                  {shippingCost === 0 ? "Gratis" : `$${shippingCost} MXN`}
                </span>
              </div>
            )}
            <div className="flex justify-between font-display text-lg font-black text-carbon">
              <span>Total</span>
              <span>${totalMxn} MXN</span>
            </div>
          </div>

          <CheckoutSteps />

          <checkoutFetcher.Form
            id={CHECKOUT_FORM_ID}
            method="post"
            action="/api/checkout"
            onSubmit={(event) => {
              if (typeof navigator !== "undefined" && navigator.onLine === false) {
                event.preventDefault();
                setOffline(true);
              } else {
                setOffline(false);
              }
            }}
          >
            <button
              type="submit"
              disabled={isCheckingOut || hasStockProblem || outOfZone}
              className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
            >
              {isCheckingOut ? "Redirigiendo a pago…" : "Ir a pagar"}
            </button>
          </checkoutFetcher.Form>
          <LegalNotice action="pagar" newTab className="text-center" />
          {hasStockProblem && (
            <p className="text-center text-xs font-semibold text-red-600">
              Ajusta las cantidades marcadas en rojo para poder pagar.
            </p>
          )}
          {outOfZone && (
            <p className="text-center text-xs font-semibold text-red-600">
              Para pagar, usa un código postal de {deliveryZone.name}.
            </p>
          )}
          {offline ? (
            <p role="alert" className="text-sm font-semibold text-red-600">
              No hay conexión a internet. Tu carrito sigue guardado: cuando vuelva, pulsa «Ir a pagar».
            </p>
          ) : (
            checkoutFetcher.data?.error && (
              <p className="text-sm font-semibold text-red-600">{checkoutFetcher.data.error}</p>
            )
          )}

          <TrustBadges />
        </>
      )}
    </div>
  );
}

/**
 * Las opciones de envío como radios grandes: se ve el costo de cada una antes
 * de elegir, y la elegida se guarda al tocarla. Ya viene una preseleccionada,
 * así que el cliente puede pagar sin tocar nada.
 */
function ShippingMethods({
  shipping,
  selectedId,
  onPending,
}: {
  shipping: ShippingQuote;
  selectedId: string | null;
  onPending: (id: string | null) => void;
}) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();

  if (!shipping.enabled || shipping.options.length === 0) return null;

  function choose(id: string) {
    onPending(id);
    fetcher.submit({ intent: "set-shipping-method", method: id }, { method: "post", action: "/tienda" });
  }

  return (
    <fieldset className="min-w-0 border-t border-carbon/10 pt-4">
      <legend className="mb-2 text-sm font-bold text-carbon">¿Cómo quieres recibirlo?</legend>
      <div className="flex flex-col gap-2">
        {shipping.options.map((option) => {
          const checked = option.id === selectedId;
          return (
            <label
              key={option.id}
              className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-3 transition-colors ${
                checked ? "border-lima bg-lima/10" : "border-carbon/10 hover:border-carbon/25"
              }`}
            >
              <input
                type="radio"
                name="shippingMethod"
                value={option.id}
                checked={checked}
                onChange={() => choose(option.id)}
                className="mt-1 h-5 w-5 shrink-0 accent-carbon"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-carbon">{option.label}</span>
                {option.note && <span className="mt-0.5 block text-xs text-carbon/60">{option.note}</span>}
                {/* Abre en pestaña nueva: el carrito se guarda en cookie y no se pierde nada al volver. */}
                <a
                  href={`/envios#${option.id === "pickup" ? "recoleccion" : "domicilio"}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex min-h-8 items-center text-xs font-semibold text-bosque underline"
                >
                  Leer más
                </a>
              </span>
              <span className="shrink-0 text-sm font-bold text-carbon">
                {option.isFree ? (
                  <>
                    <span className="mr-1 text-xs font-medium text-carbon/40 line-through">${option.baseCost}</span>
                    <span className="text-bosque">Gratis</span>
                  </>
                ) : (
                  `$${option.cost}`
                )}
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 min-h-4 text-xs" aria-live="polite">
        {fetcher.data?.error ? (
          <span className="font-semibold text-red-600">{fetcher.data.error}</span>
        ) : shipping.freeRemaining !== null ? (
          <span className="text-carbon/60">
            Agrega <strong className="text-carbon">${shipping.freeRemaining} MXN</strong> más y tu envío es gratis.
          </span>
        ) : shipping.options[0]?.isFree ? (
          <span className="font-semibold text-bosque">Tu compra incluye envío gratis.</span>
        ) : null}
      </p>
    </fieldset>
  );
}

/** Deja claro qué sigue después de "Ir a pagar" — el pago en sí corre en el Checkout hospedado de Stripe, fuera de tu tienda, así que sin esto el salto se siente abrupto. */
function CheckoutSteps() {
  const steps = ["Carrito", "Pago seguro", "¡Listo!"];
  return (
    <div className="flex items-center justify-between border-t border-carbon/10 pt-4 text-xs font-semibold text-carbon/40">
      {steps.map((step, i) => (
        <div key={step} className="flex flex-1 items-center">
          <div className="flex flex-col items-center gap-1">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full ${
                i === 0 ? "bg-carbon text-hueso" : "bg-carbon/10 text-carbon/40"
              }`}
            >
              {i + 1}
            </span>
            <span className={i === 0 ? "text-carbon" : ""}>{step}</span>
          </div>
          {i < steps.length - 1 && <div className="mx-2 h-px flex-1 bg-carbon/10" />}
        </div>
      ))}
    </div>
  );
}

/** Sello genérico de confianza — sin logos de Visa/Mastercard (son marcas registradas de terceros, no se pueden usar sin autorización), solo el hecho honesto de que el pago lo procesa Stripe. */
function TrustBadges() {
  return (
    <div className="flex items-center justify-center gap-2 text-xs text-carbon/50">
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0">
        <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>Pago 100% seguro, procesado por Stripe</span>
    </div>
  );
}
