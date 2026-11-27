import { requireStoreAccessApi } from "~/lib/storeAccess.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import type Stripe from "stripe";
import { getCatalogItems, getCatalogItemBySku, isRefillAlly } from "~/lib/catalog.server";
import { getCart, getCartCoupon, getCartShippingMethod } from "~/lib/cart.server";
import { getUser } from "~/lib/session.server";
import { buildShippingQuote, getShippingConfig } from "~/models/shipping.server";
import { rememberDeliveryAddress } from "~/lib/addressBook.server";
import { addressToMetadata, outOfZoneMessage, readAddressFields, validateDeliveryAddress } from "~/lib/deliveryAddress";
import { billingToMetadata, readInvoiceRequest } from "~/lib/fiscal";
import { UserModel } from "~/models/user.server";
import { createOneTimeCheckoutSession } from "~/lib/stripe.server";
import { getAttribution } from "~/lib/attribution.server";
import { logEvent, getOrCreateVisitorId } from "~/lib/tracking.server";
import { readConsent } from "~/lib/consent.server";
import { resolveCartDiscount } from "~/lib/cartDiscount.server";
import { logError } from "~/lib/logger.server";
import { soldOutMessage, stockLimitMessage } from "~/lib/stock";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";

export async function action({ request }: ActionFunctionArgs) {
  await requireStoreAccessApi(request);
  // Cada llamada crea una sesión real en Stripe — sin este límite, un script
  // podría martillar el endpoint y generar sesiones de checkout sin fin.
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit(`checkout:${ip}`, { max: 20, windowMs: 10 * 60 * 1000 });
  if (!rateLimit.allowed) {
    return data({ error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 });
  }

  const user = await getUser(request);
  const [cartItems, attribution, couponCode, catalogItems] = await Promise.all([
    getCart(request),
    getAttribution(request),
    getCartCoupon(request),
    // Los productos "solo para aliados" entran al catálogo únicamente si quien paga es un Punto de Recarga
    // activo: aunque alguien meta el SKU a mano en su carrito, aquí se descarta.
    getCatalogItems({ viewerIsAlly: isRefillAlly(user) }),
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

  // Un solo cálculo (el mismo que ve el cliente en el carrito) elige el descuento: de todos los que le tocan
  // se aplica el que más le conviene y no se suman. Los REGALOS no compiten: un regalo por requisito y uno de
  // lealtad pueden entregarse en el mismo pedido.
  const discount = await resolveCartDiscount({
    // Mismas reglas que vio el cliente en el carrito, revisadas otra vez al pagar:
    // pudo cambiar el carrito, usar el cupón en otro pedido o vencer el cupón.
    lines: validItems.map((item) => ({ ...item, unitPriceMxn: bySku.get(item.sku)!.priceMxn })),
    user,
    nameBySku: new Map(catalogItems.map((item) => [item.sku, item.name])),
    couponCode,
  });
  if (discount.couponProblem) {
    return data({ error: `El cupón ${couponCode} no se puede aplicar: ${discount.couponProblem.reason}` }, { status: 400 });
  }
  const discountPercent: number | undefined = discount.percent > 0 ? discount.percent : undefined;
  const appliedPromotion = discount.promotion;
  const giftSku = discount.requirement?.rewardGiftSku;
  const loyaltyGiftDescription = discount.loyaltyGiftDescription;
  const usedLoyaltyReward = discount.usedLoyaltyReward;

  // El método de envío lo eligió el cliente en el carrito; el costo se vuelve a
  // calcular aquí con las mismas reglas (nunca se confía en un monto del
  // navegador) y sobre el subtotal ya con descuento.
  const productsSubtotal = validItems.reduce((sum, item) => sum + bySku.get(item.sku)!.priceMxn * item.quantity, 0);
  const discountedSubtotal = Math.round(productsSubtotal * (1 - (discountPercent ?? 0) / 100));
  const shippingConfig = await getShippingConfig();
  const shippingQuote = buildShippingQuote(shippingConfig, discountedSubtotal, await getCartShippingMethod(request), {
    isAlly: isRefillAlly(user),
  });
  const shippingChoice = shippingQuote.selected;
  if (shippingQuote.enabled && !shippingChoice) {
    return data({ error: "No hay opciones de envío disponibles por ahora. Escríbenos y te ayudamos." }, { status: 400 });
  }

  // Candado de zona: la dirección se valida AQUÍ, en el servidor, con la misma regla que ve el
  // carrito. Nada de lo que mande el navegador basta para saltarse la zona de entrega. El punto
  // de entrega solo necesita nombre, teléfono y código postal; el domicilio, la dirección completa.
  const formData = await request.formData();
  const addressResult = validateDeliveryAddress(readAddressFields(formData), {
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

  // Factura (CFDI): opcional. Solo si marcó «Requiero factura» se revisan sus datos: unos datos mal escritos
  // harían que la factura saliera rechazada, así que se piden corregidos o se desmarca la casilla.
  const invoice = readInvoiceRequest(formData);
  if (invoice.requested && !invoice.result.ok) {
    return data(
      { error: "Revisa los datos de facturación marcados en rojo, o desmarca «Requiero factura».", invoiceErrors: invoice.result.errors },
      { status: 400 },
    );
  }
  const billingInfo = invoice.requested && invoice.result.ok ? invoice.result.info : null;

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
        ...(billingInfo ? billingToMetadata(billingInfo) : {}),
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

  // La dirección que acaba de escribir se guarda en su cuenta para no pedírsela otra vez: la primera
  // queda como principal y las demás como secundarias (puede estar enviando un regalo). Es una
  // comodidad: nunca debe impedir el pago.
  if (user) {
    try {
      await rememberDeliveryAddress(String(user._id), deliveryAddress);
    } catch (error) {
      logError("checkout.save-profile-address", error);
    }
  }

  // Si pidió guardar sus datos fiscales en su cuenta, se guardan (comodidad: nunca debe impedir el pago).
  if (user && billingInfo && invoice.requested && invoice.saveToProfile) {
    try {
      await UserModel.updateOne({ _id: user._id }, { $set: { billingInfo } });
    } catch (error) {
      logError("checkout.save-billing-info", error);
    }
  }

  // El embudo solo cuenta a quien aceptó las cookies de estadísticas. El pago no depende de esto.
  if ((await readConsent(request))?.analytics) {
    const { visitorId } = await getOrCreateVisitorId(request);
    await logEvent(visitorId, "begin_checkout", undefined, user ? { userId: String(user._id), email: user.email } : undefined);
  }

  return redirect(session.url);
}
