import { requireStoreAccessApi } from "~/lib/storeAccess.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import type Stripe from "stripe";
import { getCatalogItems, getCatalogItemBySku } from "~/lib/catalog.server";
import { getCart, getCartCoupon, getCartShippingMethod } from "~/lib/cart.server";
import { getUser } from "~/lib/session.server";
import { buildShippingQuote, getShippingConfig } from "~/models/shipping.server";
import { UserModel } from "~/models/user.server";
import { addressToMetadata, outOfZoneMessage, readAddressFields, validateDeliveryAddress } from "~/lib/deliveryAddress";
import { connectDB } from "~/lib/db.server";
import { createOneTimeCheckoutSession } from "~/lib/stripe.server";
import { getAttribution } from "~/lib/attribution.server";
import { logEvent, getOrCreateVisitorId } from "~/lib/tracking.server";
import { readConsent } from "~/lib/consent.server";
import { findRedeemableCoupon } from "~/models/promotion.server";
import { checkCouponEligibility } from "~/lib/couponRules.server";
import { stackPercents } from "~/lib/couponRules";
import { evaluateRequirementPromotion } from "~/lib/promotionEngine.server";
import { logError } from "~/lib/logger.server";
import { soldOutMessage, stockLimitMessage } from "~/lib/stock";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";

export async function action({ request }: ActionFunctionArgs) {
  await requireStoreAccessApi(request);
  // Cada llamada crea una sesión real en Stripe — sin este límite, un script
  // podría martillar el endpoint y generar sesiones de checkout sin fin.
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`checkout:${ip}`, { max: 20, windowMs: 10 * 60 * 1000 });
  if (!rateLimit.allowed) {
    return data({ error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 });
  }

  const [cartItems, user, attribution, couponCode, catalogItems] = await Promise.all([
    getCart(request),
    getUser(request),
    getAttribution(request),
    getCartCoupon(request),
    getCatalogItems(),
  ]);

  const bySku = new Map(catalogItems.map((item) => [item.sku, item]));
  const validItems = cartItems.filter((item) => bySku.has(item.sku));

  if (validItems.length === 0) {
    return data({ error: "Tu carrito está vacío." }, { status: 400 });
  }

  // La existencia se revisa otra vez aquí: el carrito vive en una cookie y el
  // stock pudo bajar (o agotarse) después de agregar el producto.
  for (const item of validItems) {
    const catalogItem = bySku.get(item.sku)!;
    if (catalogItem.stock <= 0) {
      return data({ error: `${soldOutMessage(catalogItem.name)} Quítalo del carrito para continuar.` }, { status: 400 });
    }
    if (item.quantity > catalogItem.stock) {
      return data(
        { error: `${stockLimitMessage(catalogItem.stock, catalogItem.name)} Baja la cantidad en tu carrito.` },
        { status: 400 },
      );
    }
  }

  // Precio dinámico (price_data) en vez de un Price ID fijo por SKU: el
  // catálogo se edita en /admin/catalog, así que el checkout siempre cobra
  // el precio ACTUAL en MongoDB, sin necesidad de crear un Price en Stripe
  // cada vez que se agrega un producto o paquete nuevo.
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = validItems.map((item) => {
    const catalogItem = bySku.get(item.sku)!;
    return {
      price_data: {
        currency: "mxn",
        unit_amount: Math.round(catalogItem.priceMxn * 100),
        product_data: { name: catalogItem.name },
      },
      quantity: item.quantity,
    };
  });

  // Orden de prioridad para el DESCUENTO automático: un cupón explícito del
  // cliente gana sobre cualquier promoción condicional, y esta a su vez gana
  // sobre el descuento de lealtad (el más genérico de los tres). Los REGALOS
  // no compiten entre sí — son aditivos, así que un regalo por requisito y un
  // regalo de lealtad pueden entregarse en el mismo pedido.
  let discountPercent: number | undefined;
  let appliedPromotion: { id: string; name: string; type: string } | null = null;
  let giftSku: string | undefined;
  let loyaltyGiftDescription: string | undefined;
  let usedLoyaltyReward = false;

  let couponStackable = false;

  if (couponCode) {
    const promo = await findRedeemableCoupon(couponCode);
    if (promo?.coupon?.percentage) {
      // Mismas reglas que vio el cliente en el carrito, revisadas otra vez al pagar:
      // pudo cambiar el carrito, usar el cupón en otro pedido o vencer el cupón.
      const eligibility = await checkCouponEligibility(promo, {
        lines: validItems.map((item) => ({ sku: item.sku, quantity: item.quantity, unitPriceMxn: bySku.get(item.sku)!.priceMxn })),
        user,
        nameBySku: new Map(catalogItems.map((item) => [item.sku, item.name])),
      });
      if (!eligibility.ok) {
        return data({ error: `El cupón ${couponCode} no se puede aplicar: ${eligibility.reason}` }, { status: 400 });
      }
      discountPercent = promo.coupon.percentage;
      couponStackable = Boolean(promo.coupon.stackable);
      appliedPromotion = { id: String(promo._id), name: promo.name, type: promo.type };
    }
  }

  const isFirstPurchase = Boolean(user && user.individualPurchaseCount === 0);
  const requirementMatch = await evaluateRequirementPromotion(
    validItems.map((item) => ({ ...item, unitPriceMxn: bySku.get(item.sku)!.priceMxn })),
    isFirstPurchase,
  );
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

  // Recompensa de lealtad pendiente — se ganó al completar un ciclo anterior
  // y es para ESTA compra únicamente; el webhook la limpia en cuanto se use.
  const pendingReward = user?.loyaltyPendingReward;
  if (pendingReward?.rewardType === "gift" && pendingReward.giftDescription) {
    loyaltyGiftDescription = pendingReward.giftDescription;
    usedLoyaltyReward = true;
  } else if (
    pendingReward?.rewardType === "discount" &&
    pendingReward.percentage &&
    discountPercent !== undefined &&
    couponStackable &&
    appliedPromotion?.type === "coupon"
  ) {
    // Cupón marcado como "se puede sumar": conserva su promoción registrada y
    // además consume la recompensa de lealtad.
    discountPercent = stackPercents(discountPercent, pendingReward.percentage);
    usedLoyaltyReward = true;
  } else if (pendingReward?.rewardType === "discount" && pendingReward.percentage && discountPercent === undefined) {
    discountPercent = pendingReward.percentage;
    appliedPromotion = {
      id: pendingReward.promotionId ? String(pendingReward.promotionId) : "loyalty",
      name: pendingReward.promotionName ?? "Lealtad",
      type: "loyalty",
    };
    usedLoyaltyReward = true;
  }

  // El método de envío lo eligió el cliente en el carrito; el costo se vuelve a
  // calcular aquí con las mismas reglas (nunca se confía en un monto del
  // navegador) y sobre el subtotal ya con descuento.
  const productsSubtotal = validItems.reduce((sum, item) => sum + bySku.get(item.sku)!.priceMxn * item.quantity, 0);
  const discountedSubtotal = Math.round(productsSubtotal * (1 - (discountPercent ?? 0) / 100));
  const shippingConfig = await getShippingConfig();
  const shippingQuote = buildShippingQuote(shippingConfig, discountedSubtotal, await getCartShippingMethod(request));
  const shippingChoice = shippingQuote.selected;
  if (shippingQuote.enabled && !shippingChoice) {
    return data({ error: "No hay opciones de envío disponibles por ahora. Escríbenos y te ayudamos." }, { status: 400 });
  }

  // Candado de zona: la dirección se valida AQUÍ, en el servidor, con la misma regla que ve el
  // carrito. Nada de lo que mande el navegador basta para saltarse la zona de entrega. El punto
  // de entrega solo necesita nombre, teléfono y código postal; el domicilio, la dirección completa.
  const addressResult = validateDeliveryAddress(readAddressFields(await request.formData()), {
    mode: shippingChoice?.id === "pickup" ? "pickup" : "home",
    zone: shippingConfig.zone,
  });
  if (!addressResult.ok) {
    return data(
      {
        error: addressResult.outOfZone ? outOfZoneMessage(shippingConfig.zone) : "Revisa los datos de entrega marcados en rojo.",
        fieldErrors: addressResult.errors,
      },
      { status: 400 },
    );
  }
  const deliveryAddress = addressResult.address;

  const giftProduct = giftSku ? await getCatalogItemBySku(giftSku, { includeUnavailable: true }) : null;

  // Stripe rechaza cualquier valor de metadatos de más de 500 caracteres. Con un
  // carrito enorme el pago fallaría con un error genérico; mejor avisar claro.
  const cartSkusMetadata = validItems.map((i) => `${i.sku}:${i.quantity}:${bySku.get(i.sku)!.priceMxn}`).join(",");
  if (cartSkusMetadata.length > 480) {
    return data(
      { error: "Tu carrito tiene demasiados productos distintos para pagarlos juntos. Divide la compra en dos pedidos." },
      { status: 400 },
    );
  }

  // Si Stripe falla (llave inválida, red, datos rechazados) el cliente debe ver
  // un mensaje y conservar su carrito, no la pantalla de error general.
  let session: Awaited<ReturnType<typeof createOneTimeCheckoutSession>>;
  try {
    session = await createOneTimeCheckoutSession({
      lineItems,
      customerEmail: user?.email,
      discountPercent,
      giftLineItems: [
        giftProduct ? { name: giftProduct.name } : null,
        loyaltyGiftDescription ? { name: loyaltyGiftDescription } : null,
      ].filter((g): g is { name: string } => g !== null),
      shipping: shippingChoice
        ? {
            amountMxnCents: Math.round(shippingChoice.cost * 100),
            displayName: shippingChoice.isFree ? `${shippingChoice.label} (gratis)` : shippingChoice.label,
          }
        : null,
      deliveryAddress,
      metadata: {
        ...addressToMetadata(deliveryAddress),
        userId: user ? String(user._id) : "guest",
        // Se incluye el precio unitario cobrado (no solo el SKU) para que el
        // webhook registre el pedido con el precio real de esta compra, sin
        // depender de que el catálogo no haya cambiado entre el checkout y la
        // confirmación del pago.
        cartSkus: cartSkusMetadata,
        shippingCost: String(shippingChoice?.cost ?? 0),
        shippingMethod: shippingChoice?.id ?? "",
        shippingMethodLabel: shippingChoice?.label ?? "",
        shippingFree: shippingChoice?.isFree ? "true" : "false",
        utm_source: attribution?.utm_source ?? "",
        utm_medium: attribution?.utm_medium ?? "",
        utm_campaign: attribution?.utm_campaign ?? "",
        promotionId: appliedPromotion?.id ?? "",
        promotionName: (appliedPromotion?.name ?? "").slice(0, 100),
        promotionType: appliedPromotion?.type ?? "",
        giftSku: giftSku ?? "",
        loyaltyGiftDescription: (loyaltyGiftDescription ?? "").slice(0, 300),
        usedLoyaltyReward: usedLoyaltyReward ? "true" : "false",
      },
    });
  } catch (error) {
    logError("checkout.stripe", error);
    return data(
      { error: "No pudimos abrir el pago en este momento. Tu carrito sigue guardado: intenta de nuevo en un momento." },
      { status: 502 },
    );
  }

  if (!session.url) {
    return data({ error: "No se pudo iniciar el pago. Intenta de nuevo." }, { status: 502 });
  }

  // Primera vez que escribe su dirección: se guarda en su perfil para que la próxima compra llegue
  // llena. Si ya tenía una, no se pisa (puede estar enviando un regalo); la edita en "Mi cuenta".
  if (user && !user.address?.line1 && !user.address?.postalCode) {
    try {
      await connectDB();
      await UserModel.updateOne(
        { _id: user._id },
        {
          $set: {
            address: {
              line1: deliveryAddress.line1,
              line2: deliveryAddress.line2,
              city: deliveryAddress.city,
              state: deliveryAddress.state,
              postalCode: deliveryAddress.postalCode,
              country: "MX",
            },
            ...(user.phone ? {} : { phone: deliveryAddress.phone }),
            ...(user.name ? {} : { name: deliveryAddress.name }),
          },
        },
      );
    } catch (error) {
      // Guardar el perfil es una comodidad: nunca debe impedir el pago.
      logError("checkout.save-profile-address", error);
    }
  }

  // El embudo solo cuenta a quien aceptó las cookies de estadísticas. El pago no depende de esto.
  if ((await readConsent(request))?.analytics) {
    const { visitorId } = await getOrCreateVisitorId(request);
    await logEvent(visitorId, "begin_checkout", undefined, user ? { userId: String(user._id), email: user.email } : undefined);
  }

  return redirect(session.url);
}
