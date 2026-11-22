import Stripe from "stripe";
import { stripeIntervalFor, type SubscriptionFrequency } from "~/lib/subscriptionConfig";

export type SubscriptionBoxItem = { sku: string; name: string; quantity: number; unitPriceMxn: number };

export type { SubscriptionFrequency };

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error("Falta la variable de entorno STRIPE_SECRET_KEY");
}

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2025-02-24.acacia",
  // Tope por llamada: sin él, una respuesta lenta de Stripe deja al cliente mirando "Redirigiendo…" hasta 80 s.
  timeout: 15_000,
});

export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/**
 * La suscripción es una caja armable de productos del catálogo real
 * (~/lib/catalog.server, marcados "se puede incluir en el auto-envío
 * periódico" en /admin/catalog) — igual que el checkout de una compra
 * normal, NO usa Price IDs fijos de Stripe: arma el precio de cada producto
 * al vuelo con `price_data` a partir de lo que cueste HOY en MongoDB, y el
 * descuento se aplica vía un Coupon de Stripe asociado a la suscripción, ya
 * que Stripe Billing no soporta intervalos arbitrarios de 3/6/8 semanas de
 * forma nativa.
 */
const subscriptionProductIdCache = new Map<string, string>();

/**
 * `stripe.subscriptions.update` (usado al cambiar de frecuencia) no acepta
 * `product_data` inline como sí lo hace un Checkout Session — necesita un
 * Product real por SKU. Se crea una sola vez por SKU (o se reutiliza el ya
 * creado, buscando por nombre para no duplicarlo si el proceso reinicia) y
 * ese mismo Product se usa tanto al suscribirse como al cambiar de
 * frecuencia después.
 */
async function getSubscriptionProductId(sku: string, name: string): Promise<string> {
  const cached = subscriptionProductIdCache.get(sku);
  if (cached) return cached;

  const productName = `${name} — Auto-envío`;
  // Recorre TODAS las páginas: con más de 100 productos en Stripe, mirar solo la
  // primera no encontraría el de auto-envío y se crearía uno duplicado cada vez.
  for await (const product of stripe.products.list({ limit: 100, active: true })) {
    if (product.name === productName) {
      subscriptionProductIdCache.set(sku, product.id);
      return product.id;
    }
  }

  const created = await stripe.products.create({ name: productName, metadata: { sku } });
  subscriptionProductIdCache.set(sku, created.id);
  return created.id;
}

export async function createOneTimeCheckoutSession(params: {
  lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
  customerEmail?: string;
  metadata: Record<string, string>;
  discountPercent?: number;
  giftLineItems?: { name: string }[];
  /** Se manda como `shipping_options` (no como line item) para que un cupón de % no lo descuente también — el envío se cobra aparte, tal cual. */
  shipping?: { amountMxnCents: number; displayName: string } | null;
}) {
  const { lineItems, customerEmail, metadata, discountPercent, giftLineItems, shipping } = params;

  let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
  if (discountPercent) {
    const coupon = await stripe.coupons.create({
      percent_off: discountPercent,
      duration: "once",
      name: `Fidelidad STOPee ${discountPercent}%`,
    });
    discounts = [{ coupon: coupon.id }];
  }

  const allLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [...lineItems];
  for (const gift of giftLineItems ?? []) {
    allLineItems.push({
      price_data: {
        currency: "mxn",
        product_data: { name: `Regalo: ${gift.name}` },
        unit_amount: 0,
      },
      quantity: 1,
    });
  }

  const shippingOptions: Stripe.Checkout.SessionCreateParams.ShippingOption[] | undefined = shipping
    ? [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: shipping.amountMxnCents, currency: "mxn" },
            display_name: shipping.displayName,
          },
        },
      ]
    : undefined;

  return stripe.checkout.sessions.create({
    mode: "payment",
    line_items: allLineItems,
    customer_email: customerEmail,
    discounts,
    shipping_options: shippingOptions,
    // Stripe pide la dirección (y un teléfono para la paquetería) en su pantalla
    // de pago: así el carrito ya no necesita código postal y la dirección real
    // queda en el pedido, tanto para domicilio como para asignar el punto de
    // entrega más cercano.
    shipping_address_collection: { allowed_countries: ["MX"] },
    phone_number_collection: { enabled: true },
    success_url: `${APP_URL}/gracias?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/tienda?checkout=cancelled`,
    metadata,
  });
}

/** Un cupón de Stripe por porcentaje: si el admin cambia el descuento, el siguiente checkout crea el nuevo. */
const cachedSubscriptionCouponIds = new Map<number, string>();

async function getSubscriptionCouponId(discountPercent: number) {
  const cached = cachedSubscriptionCouponIds.get(discountPercent);
  if (cached) return cached;
  const coupon = await stripe.coupons.create({
    percent_off: discountPercent,
    duration: "forever",
    name: `Auto-Envío STOPee ${discountPercent}%`,
  });
  cachedSubscriptionCouponIds.set(discountPercent, coupon.id);
  return coupon.id;
}

function requireInterval(frequency: SubscriptionFrequency) {
  const interval = stripeIntervalFor(frequency);
  if (!interval) throw new Error(`Frecuencia de suscripción no válida: ${frequency}`);
  return interval;
}

export async function createSubscriptionCheckoutSession(params: {
  frequency: SubscriptionFrequency;
  /** Descuento vigente en el momento de contratar (0 = sin descuento). */
  discountPercent: number;
  items: SubscriptionBoxItem[];
  customerEmail: string;
  metadata: Record<string, string>;
}) {
  const { frequency, discountPercent, items, customerEmail, metadata } = params;
  const freq = requireInterval(frequency);
  const [couponId, ...productIds] = await Promise.all([
    discountPercent > 0 ? getSubscriptionCouponId(discountPercent) : Promise.resolve(null),
    ...items.map((item) => getSubscriptionProductId(item.sku, item.name)),
  ]);

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map((item, i) => ({
    price_data: {
      currency: "mxn",
      product: productIds[i],
      unit_amount: Math.round(item.unitPriceMxn * 100),
      recurring: {
        interval: freq.interval,
        interval_count: freq.intervalCount,
      },
    },
    quantity: item.quantity,
  }));

  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: customerEmail,
    line_items: lineItems,
    ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
    success_url: `${APP_URL}/gracias?tipo=suscripcion&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/tienda?subscription=cancelled`,
    metadata: { ...metadata, frequency },
  });
}

export async function pauseSubscription(stripeSubscriptionId: string) {
  return stripe.subscriptions.update(stripeSubscriptionId, {
    pause_collection: { behavior: "void" },
  });
}

export async function resumeSubscription(stripeSubscriptionId: string) {
  return stripe.subscriptions.update(stripeSubscriptionId, {
    pause_collection: null,
  });
}

/**
 * Cambia la frecuencia de TODOS los renglones de la suscripción a la vez —
 * la caja (qué productos y cuántos) no cambia, solo cada cuánto se cobra y
 * se envía. `items` debe ser la misma caja ya guardada en SubscriptionModel,
 * para reconstruir cada Product de Stripe sin volver a preguntarle nada al
 * cliente.
 */
export async function updateSubscriptionFrequency(
  stripeSubscriptionId: string,
  frequency: SubscriptionFrequency,
  items: SubscriptionBoxItem[],
) {
  const freq = requireInterval(frequency);
  const [subscription, ...productIds] = await Promise.all([
    stripe.subscriptions.retrieve(stripeSubscriptionId),
    ...items.map((item) => getSubscriptionProductId(item.sku, item.name)),
  ]);

  const stripeItems = subscription.items.data;

  return stripe.subscriptions.update(stripeSubscriptionId, {
    items: items.map((item, i) => ({
      // Mismo renglón de Stripe si ya existía (evita cancelar/recrear cada
      // uno); si la caja creció desde que se creó la suscripción, se agregan
      // renglones nuevos.
      id: stripeItems[i]?.id,
      price_data: {
        currency: "mxn",
        product: productIds[i],
        unit_amount: Math.round(item.unitPriceMxn * 100),
        recurring: { interval: freq.interval, interval_count: freq.intervalCount },
      },
      quantity: item.quantity,
    })),
    proration_behavior: "none",
  });
}

export async function createBillingPortalSession(stripeCustomerId: string) {
  return stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${APP_URL}/cuenta`,
  });
}
