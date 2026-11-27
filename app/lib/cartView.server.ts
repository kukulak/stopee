import type { CartLine } from "~/components/ecommerce/CartDrawer";
import type { CatalogItem } from "~/lib/catalog.server";
import { getCart, getCartCoupon, getCartShippingMethod } from "~/lib/cart.server";
import { getCatalogItemBySku, isRefillAlly } from "~/lib/catalog.server";
import { addressDefaultsFromProfile } from "~/lib/deliveryAddress";
import { addressOptionsFromProfile } from "~/lib/addressBook";
import { resolveCartDiscount } from "~/lib/cartDiscount.server";
import { getPasswordGateConfig } from "~/models/passwordGate.server";
import { buildShippingQuote, type ShippingConfig } from "~/models/shipping.server";
import { getInvoiceRequestEmail } from "~/models/legalSettings.server";
import type { BillingInfo } from "~/lib/fiscal";
import type { getUser } from "~/lib/session.server";

export function billingDefaultsFromUser(user: Awaited<ReturnType<typeof getUser>>): BillingInfo | null {
  const b = user?.billingInfo;
  if (!b?.rfc) return null;
  return {
    rfc: b.rfc,
    razonSocial: b.razonSocial ?? "",
    regimenFiscal: b.regimenFiscal ?? "",
    codigoPostalFiscal: b.codigoPostalFiscal ?? "",
    usoCfdi: b.usoCfdi ?? "G03",
  };
}

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

  // Un solo cálculo (el mismo que usa el pago) elige el descuento: el que más le conviene al cliente.
  const gateConfig = await getPasswordGateConfig();
  const discount = await resolveCartDiscount({
    lines: lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unitPriceMxn: l.product.priceMxn })),
    user,
    nameBySku: new Map(catalogItems.map((item) => [item.sku, item.name])),
    couponCode,
    couponLabel: async (promotionId) =>
      gateConfig.linkedPromotionId === promotionId ? gateConfig.cartBannerMessage || null : null,
  });
  const discountPercent = discount.percent;
  const discountLabel = discount.label;

  const coupon = discount.appliedCouponCode
    ? { code: discount.appliedCouponCode, percentage: discount.percent }
    : null;

  // Avisos de un cupón escrito que no está aplicando: o todavía no cumple sus reglas, o hay un descuento mejor.
  let couponNotice: {
    code: string;
    message: string;
    cta: "login" | "verify" | null;
    heading?: string;
    tone?: "warn" | "info";
  } | null = null;
  if (discount.couponProblem) {
    const { code, reason, kind } = discount.couponProblem;
    couponNotice = { code, message: reason, cta: kind === "login" || kind === "verify" ? kind : null };
  } else if (discount.couponBeaten) {
    couponNotice = {
      code: discount.couponBeaten.code,
      heading: `Cupón ${discount.couponBeaten.code} guardado`,
      tone: "info",
      message: `Aplicamos ${discount.label} (${discount.percent}%) porque te conviene más que tu cupón (${discount.couponBeaten.percentage}%). Los descuentos no se suman.`,
      cta: null,
    };
  }
  // Una recompensa de lealtad que no hizo falta usar no se pierde: queda para la siguiente compra.
  const discountNotice = discount.loyaltyKept
    ? `Tu recompensa de lealtad (${discount.loyaltyKept.percentage}%) se guarda para tu siguiente compra.`
    : null;

  const requirementGift = discount.requirement?.rewardGiftSku
    ? (bySku.get(discount.requirement.rewardGiftSku) ??
        (await getCatalogItemBySku(discount.requirement.rewardGiftSku, { includeUnavailable: true })))?.name ?? null
    : null;
  const loyaltyGift = discount.loyaltyGiftDescription ?? null;
  const gifts = [requirementGift, loyaltyGift].filter((g): g is string => Boolean(g));

  // El envío gratis se evalúa sobre lo que realmente se paga por productos (ya con descuento).
  const discountedSubtotal = Math.round(subtotalMxn * (1 - discountPercent / 100));
  const shipping = buildShippingQuote(shippingConfig, discountedSubtotal, cartShippingMethod, { isAlly: isRefillAlly(user) });

  return {
    lines,
    subtotalMxn,
    discountPercent,
    discountLabel,
    coupon,
    couponNotice,
    discountNotice,
    gifts,
    shipping,
    deliveryZone: shippingConfig.zone,
    addressDefaults: addressDefaultsFromProfile(user),
    // null = visita sin sesión: no se ofrecen ni se guardan direcciones.
    addressBook: user ? addressOptionsFromProfile(user) : null,
    // Factura: los datos fiscales guardados en la cuenta (para precargarlos) y a dónde pedirla después.
    billingDefaults: billingDefaultsFromUser(user),
    invoiceEmail: await getInvoiceRequestEmail(),
    signedIn: Boolean(user),
    // Quien ya aceptó recibir promociones no vuelve a ver la casilla al pagar.
    marketingOptedIn: Boolean(user?.marketingOptInAt),
  };
}

export type CartView = Awaited<ReturnType<typeof buildCartView>>;
