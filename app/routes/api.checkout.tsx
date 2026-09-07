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
import { evaluateRequirementPromotion } from "~/lib/promotionEngine.server";

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

  // Orden de prioridad para el descuento automático: un cupón explícito del
  // cliente gana sobre cualquier promoción condicional, y esta a su vez gana
  // sobre el descuento de lealtad (el más genérico de los tres).
  let discountPercent: number | undefined;
  let appliedPromotion: { id: string; name: string; type: string } | null = null;
  let giftSku: ProductSku | undefined;

  if (couponCode) {
    const promo = await findRedeemableCoupon(couponCode);
    if (promo?.coupon?.percentage) {
      discountPercent = promo.coupon.percentage;
      appliedPromotion = { id: String(promo._id), name: promo.name, type: promo.type };
    }
  }

  const isFirstPurchase = Boolean(user && user.individualPurchaseCount === 0);
  const requirementMatch = await evaluateRequirementPromotion(validItems, isFirstPurchase);
  if (requirementMatch) {
    giftSku = requirementMatch.rewardGiftSku;
    if (discountPercent === undefined && requirementMatch.rewardDiscountPercentage) {
      discountPercent = requirementMatch.rewardDiscountPercentage;
      appliedPromotion = { id: requirementMatch.id, name: requirementMatch.name, type: "by_requirement" };
    } else if (!appliedPromotion && giftSku) {
      // Solo trae regalo (sin descuento asignado a esta orden) — igual se
      // registra qué promoción fue, para medir su efectividad en el dashboard.
      appliedPromotion = { id: requirementMatch.id, name: requirementMatch.name, type: "by_requirement" };
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
    giftLineItem: giftSku ? { name: PRODUCTS[giftSku].name } : undefined,
    metadata: {
      userId: user ? String(user._id) : "guest",
      cartSkus: validItems.map((i) => `${i.sku}:${i.quantity}`).join(","),
      utm_source: attribution?.utm_source ?? "",
      utm_medium: attribution?.utm_medium ?? "",
      utm_campaign: attribution?.utm_campaign ?? "",
      promotionId: appliedPromotion?.id ?? "",
      promotionName: appliedPromotion?.name ?? "",
      promotionType: appliedPromotion?.type ?? "",
      giftSku: giftSku ?? "",
    },
  });

  if (!session.url) {
    return json({ error: "No se pudo iniciar el pago. Intenta de nuevo." }, { status: 502 });
  }

  const { visitorId } = await getOrCreateVisitorId(request);
  await logEvent(visitorId, "begin_checkout", undefined, user ? { userId: String(user._id), email: user.email } : undefined);

  return redirect(session.url);
}
