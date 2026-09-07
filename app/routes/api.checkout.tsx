import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { PRODUCTS } from "~/data/products";
import type { ProductSku } from "~/data/products";
import { STRIPE_PRICE_BY_SKU } from "~/data/stripePriceMap.server";
import { getCart, getCartCoupon } from "~/lib/cart.server";
import { getUser } from "~/lib/session.server";
import { createOneTimeCheckoutSession } from "~/lib/stripe.server";
import { getAttribution } from "~/lib/attribution.server";
import { logEvent, getOrCreateVisitorId } from "~/lib/tracking.server";
import { getActiveLoyaltyConfig, findRedeemableCoupon } from "~/models/promotion.server";

export async function action({ request }: ActionFunctionArgs) {
  const [cartItems, user, attribution, couponCode] = await Promise.all([
    getCart(request),
    getUser(request),
    getAttribution(request),
    getCartCoupon(request),
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

  // El cupón, si el cliente puso uno explícitamente, gana sobre el
  // descuento automático de lealtad — igual que se muestra en el carrito.
  let discountPercent: number | undefined;
  let appliedPromotion: { id: string; name: string; type: string } | null = null;
  if (couponCode) {
    const promo = await findRedeemableCoupon(couponCode);
    if (promo?.coupon?.percentage) {
      discountPercent = promo.coupon.percentage;
      appliedPromotion = { id: String(promo._id), name: promo.name, type: promo.type };
    }
  }
  if (discountPercent === undefined && user?.loyaltyDiscountActive) {
    const loyalty = await getActiveLoyaltyConfig();
    discountPercent = loyalty.percentage;
    if (loyalty.id) appliedPromotion = { id: loyalty.id, name: loyalty.name ?? "Lealtad", type: "loyalty" };
  }

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
      promotionId: appliedPromotion?.id ?? "",
      promotionName: appliedPromotion?.name ?? "",
      promotionType: appliedPromotion?.type ?? "",
    },
  });

  if (!session.url) {
    return json({ error: "No se pudo iniciar el pago. Intenta de nuevo." }, { status: 502 });
  }

  const { visitorId } = await getOrCreateVisitorId(request);
  await logEvent(visitorId, "begin_checkout");

  return redirect(session.url);
}
