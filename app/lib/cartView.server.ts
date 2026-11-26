import type { CartLine } from "~/components/ecommerce/CartDrawer";
import type { CatalogItem } from "~/lib/catalog.server";
import { getCart, getCartCoupon, getCartShippingMethod } from "~/lib/cart.server";
import { getCatalogItemBySku } from "~/lib/catalog.server";
import { addressDefaultsFromProfile } from "~/lib/deliveryAddress";
import { checkCouponEligibility } from "~/lib/couponRules.server";
import { stackPercents } from "~/lib/couponRules";
import { evaluateRequirementPromotion } from "~/lib/promotionEngine.server";
import { findRedeemableCoupon } from "~/models/promotion.server";
import { getPasswordGateConfig } from "~/models/passwordGate.server";
import { buildShippingQuote, type ShippingConfig } from "~/models/shipping.server";
import type { getUser } from "~/lib/session.server";

/**
 * Todo lo que el carrito necesita para dibujarse: renglones, descuento (cupón,
 * promoción por requisito o lealtad), regalos, envío y zona de entrega. Lo usan
 * /tienda (que ya tiene el catálogo y la configuración cargados) y /api/carrito
 * (para abrir el carrito desde cualquier página sin salir de ella), así que los
 * dos muestran siempre exactamente lo mismo.
 */
export async function buildCartView(
  request: Request,
  deps: {
    user: Awaited<ReturnType<typeof getUser>>;
    catalogItems: CatalogItem[];
    shippingConfig: ShippingConfig;
  },
) {
  const { user, catalogItems, shippingConfig } = deps;
  const [cartItems, couponCode, cartShippingMethod] = await Promise.all([
    getCart(request),
    getCartCoupon(request),
    getCartShippingMethod(request),
  ]);

  const bySku = new Map(catalogItems.map((item) => [item.sku, item]));

  const lines: CartLine[] = cartItems
    .filter((item) => bySku.has(item.sku))
    .map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      product: bySku.get(item.sku)!,
    }));

  const subtotalMxn = lines.reduce((sum, line) => sum + line.product.priceMxn * line.quantity, 0);

  let coupon: { code: string; percentage: number } | null = null;
  let couponStackable = false;
  let couponNotice: { code: string; message: string; cta: "login" | "verify" | null } | null = null;
  let gateBenefitLabel: string | null = null;
  if (couponCode) {
    const promo = await findRedeemableCoupon(couponCode);
    if (promo?.coupon?.percentage) {
      // Las reglas del cupón (compra mínima, producto requerido, un uso por cliente…)
      // se revisan aquí cada vez: si el carrito deja de cumplirlas, el cupón queda
      // guardado pero sin aplicar, con un aviso de qué falta.
      const eligibility = await checkCouponEligibility(promo, {
        lines: lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unitPriceMxn: l.product.priceMxn })),
        user,
        nameBySku: new Map(catalogItems.map((item) => [item.sku, item.name])),
      });
      if (eligibility.ok) {
        coupon = { code: couponCode, percentage: promo.coupon.percentage };
        couponStackable = Boolean(promo.coupon.stackable);
        const gateConfigForBanner = await getPasswordGateConfig();
        if (gateConfigForBanner.linkedPromotionId === String(promo._id)) {
          gateBenefitLabel = gateConfigForBanner.cartBannerMessage;
        }
      } else {
        couponNotice = {
          code: couponCode,
          message: eligibility.reason,
          cta: eligibility.kind === "login" || eligibility.kind === "verify" ? eligibility.kind : null,
        };
      }
    }
  }

  const isFirstPurchase = Boolean(user && user.individualPurchaseCount === 0);
  const requirementMatch = await evaluateRequirementPromotion(
    lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unitPriceMxn: l.product.priceMxn })),
    isFirstPurchase,
  );
  const requirementGift = requirementMatch?.rewardGiftSku
    ? (bySku.get(requirementMatch.rewardGiftSku) ?? (await getCatalogItemBySku(requirementMatch.rewardGiftSku, { includeUnavailable: true })))?.name ?? null
    : null;

  // La recompensa de lealtad (si la tiene) es para SU SIGUIENTE compra, nunca
  // permanente — ver app/lib/loyalty.ts y webhooks.stripe.tsx.
  const pendingReward = user?.loyaltyPendingReward;
  const loyaltyGift = pendingReward?.rewardType === "gift" ? pendingReward.giftDescription ?? null : null;
  const loyaltyDiscountPercent = pendingReward?.rewardType === "discount" ? pendingReward.percentage ?? 0 : 0;

  // Prioridad para el DESCUENTO: un cupón explícito del cliente gana sobre
  // una promoción condicional, y esta a su vez gana sobre la lealtad. Los
  // regalos (requisito + lealtad) no compiten entre sí, ambos se muestran.
  let discountPercent = 0;
  let discountLabel = "";
  if (coupon) {
    discountPercent = coupon.percentage;
    discountLabel = gateBenefitLabel ?? `Cupón ${coupon.code}`;
    // Solo si el cupón lo permite se suma a la recompensa de lealtad ya ganada.
    if (couponStackable && loyaltyDiscountPercent > 0) {
      discountPercent = stackPercents(coupon.percentage, loyaltyDiscountPercent);
      discountLabel = `${discountLabel} + ${pendingReward?.promotionName ?? "Recompensa de lealtad"}`;
    }
  } else if (requirementMatch?.rewardDiscountPercentage) {
    discountPercent = requirementMatch.rewardDiscountPercentage;
    discountLabel = requirementMatch.name;
  } else if (loyaltyDiscountPercent > 0) {
    discountPercent = loyaltyDiscountPercent;
    discountLabel = pendingReward?.promotionName ?? "Recompensa de lealtad";
  }

  const gifts = [requirementGift, loyaltyGift].filter((g): g is string => Boolean(g));

  // El envío gratis se evalúa sobre lo que realmente se paga por productos (ya con descuento).
  const discountedSubtotal = Math.round(subtotalMxn * (1 - discountPercent / 100));
  const shipping = buildShippingQuote(shippingConfig, discountedSubtotal, cartShippingMethod);

  return {
    lines,
    subtotalMxn,
    discountPercent,
    discountLabel,
    coupon,
    couponNotice,
    gifts,
    shipping,
    deliveryZone: shippingConfig.zone,
    addressDefaults: addressDefaultsFromProfile(user),
  };
}

export type CartView = Awaited<ReturnType<typeof buildCartView>>;
