import Stripe from "stripe";
import { SUBSCRIPTION_FREQUENCIES, type SubscriptionFrequency } from "~/data/subscriptionFrequencies";

export type { SubscriptionFrequency };

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error("Falta la variable de entorno STRIPE_SECRET_KEY");
}

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2025-02-24.acacia",
});

export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/**
 * Precios de Stripe (Price IDs) — deben crearse previamente en el Dashboard
 * de Stripe. El precio de suscripción usa `recurring` con el intervalo base;
 * el descuento del 10% se aplica vía un Coupon/Promotion Code de Stripe
 * asociado a la suscripción, ya que Stripe Billing no soporta intervalos
 * arbitrarios de 3/6/8 semanas de forma nativa — ver `subscription.server.ts`.
 */
export const STRIPE_PRICES = {
  concentrado1L: process.env.STRIPE_PRICE_CONCENTRADO_1L ?? "",
  squishable: process.env.STRIPE_PRICE_SQUISHABLE ?? "",
  packBasico: process.env.STRIPE_PRICE_PACK_BASICO ?? "",
  packDuo: process.env.STRIPE_PRICE_PACK_DUO ?? "",
  packManada: process.env.STRIPE_PRICE_PACK_MANADA ?? "",
  suscripcion1L: process.env.STRIPE_PRICE_SUSCRIPCION_1L ?? "",
} as const;

type CheckoutLineItem = {
  price: string;
  quantity: number;
};

export async function createOneTimeCheckoutSession(params: {
  lineItems: CheckoutLineItem[];
  customerEmail?: string;
  metadata: Record<string, string>;
  discountPercent?: number;
  giftLineItem?: { name: string };
}) {
  const { lineItems, customerEmail, metadata, discountPercent, giftLineItem } = params;

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
  if (giftLineItem) {
    allLineItems.push({
      price_data: {
        currency: "mxn",
        product_data: { name: `🎁 Regalo: ${giftLineItem.name}` },
        unit_amount: 0,
      },
      quantity: 1,
    });
  }

  return stripe.checkout.sessions.create({
    mode: "payment",
    line_items: allLineItems,
    customer_email: customerEmail,
    discounts,
    success_url: `${APP_URL}/cuenta?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/tienda?checkout=cancelled`,
    metadata,
  });
}

const SUBSCRIPTION_DISCOUNT_PERCENT = 10;
// Precio base del envío de 1L en la suscripción, en centavos de MXN.
// El 10% de descuento se aplica vía cupón, no reduciendo este monto.
export const SUBSCRIPTION_UNIT_AMOUNT_MXN_CENTS = Number(
  process.env.STRIPE_SUBSCRIPTION_1L_AMOUNT_CENTS ?? 45000,
);
let cachedSubscriptionCouponId: string | null = null;

async function getSubscriptionCouponId() {
  if (cachedSubscriptionCouponId) return cachedSubscriptionCouponId;
  const coupon = await stripe.coupons.create({
    percent_off: SUBSCRIPTION_DISCOUNT_PERCENT,
    duration: "forever",
    name: "Auto-Envío STOPee 10%",
  });
  cachedSubscriptionCouponId = coupon.id;
  return coupon.id;
}

export async function createSubscriptionCheckoutSession(params: {
  frequency: SubscriptionFrequency;
  customerEmail: string;
  metadata: Record<string, string>;
}) {
  const { frequency, customerEmail, metadata } = params;
  const freq = SUBSCRIPTION_FREQUENCIES[frequency];
  const couponId = await getSubscriptionCouponId();

  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: customerEmail,
    line_items: [
      {
        price_data: {
          currency: "mxn",
          product: STRIPE_PRICES.suscripcion1L,
          unit_amount: SUBSCRIPTION_UNIT_AMOUNT_MXN_CENTS,
          recurring: {
            interval: freq.interval,
            interval_count: freq.intervalCount,
          },
        },
        quantity: 1,
      },
    ],
    discounts: [{ coupon: couponId }],
    success_url: `${APP_URL}/cuenta?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
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

export async function updateSubscriptionFrequency(
  stripeSubscriptionId: string,
  frequency: SubscriptionFrequency,
) {
  const freq = SUBSCRIPTION_FREQUENCIES[frequency];
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const itemId = subscription.items.data[0]?.id;

  return stripe.subscriptions.update(stripeSubscriptionId, {
    items: [
      {
        id: itemId,
        price_data: {
          currency: "mxn",
          product: STRIPE_PRICES.suscripcion1L,
          unit_amount: SUBSCRIPTION_UNIT_AMOUNT_MXN_CENTS,
          recurring: { interval: freq.interval, interval_count: freq.intervalCount },
        },
      },
    ],
    proration_behavior: "none",
  });
}

export async function createBillingPortalSession(stripeCustomerId: string) {
  return stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${APP_URL}/cuenta`,
  });
}
