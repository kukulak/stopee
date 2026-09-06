import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { PRODUCTS, LOYALTY_DISCOUNT_PERCENT } from "~/data/products";
import type { ProductSku } from "~/data/products";
import { STRIPE_PRICE_BY_SKU } from "~/data/stripePriceMap.server";
import { getCart } from "~/lib/cart.server";
import { getUser } from "~/lib/session.server";
import { createOneTimeCheckoutSession } from "~/lib/stripe.server";
import { getAttribution } from "~/lib/attribution.server";
import { logEvent, getOrCreateVisitorId } from "~/lib/tracking.server";

export async function action({ request }: ActionFunctionArgs) {
  const [cartItems, user, attribution] = await Promise.all([
    getCart(request),
    getUser(request),
    getAttribution(request),
  ]);

  const validItems = cartItems.filter(
    (item): item is { sku: ProductSku; quantity: number } => item.sku in PRODUCTS,
  );

  if (validItems.length === 0) {
    return json({ error: "Tu carrito está vacío." }, { status: 400 });
  }

  const lineItems = validItems.map((item) => ({
    price: STRIPE_PRICE_BY_SKU[item.sku],
    quantity: item.quantity,
  }));

  const discountPercent = user?.loyaltyDiscountActive ? LOYALTY_DISCOUNT_PERCENT : undefined;

  const session = await createOneTimeCheckoutSession({
    lineItems,
    customerEmail: user?.email,
    discountPercent,
    metadata: {
      userId: user ? String(user._id) : "guest",
      cartSkus: validItems.map((i) => `${i.sku}:${i.quantity}`).join(","),
      utm_source: attribution?.utm_source ?? "",
      utm_medium: attribution?.utm_medium ?? "",
      utm_campaign: attribution?.utm_campaign ?? "",
    },
  });

  if (!session.url) {
    return json({ error: "No se pudo iniciar el pago. Intenta de nuevo." }, { status: 502 });
  }

  const { visitorId } = await getOrCreateVisitorId(request);
  await logEvent(visitorId, "begin_checkout");

  return redirect(session.url);
}
