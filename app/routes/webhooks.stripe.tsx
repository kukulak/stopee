import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import mongoose from "mongoose";
import type Stripe from "stripe";
import { stripe } from "~/lib/stripe.server";
import { connectDB } from "~/lib/db.server";
import { OrderModel } from "~/models/order.server";
import { SubscriptionModel } from "~/models/subscription.server";
import { UserModel } from "~/models/user.server";
import { LeadModel } from "~/models/lead.server";
import { getCatalogItemNameBySku } from "~/lib/catalog.server";
import { getActiveLoyaltyConfig, PromotionModel } from "~/models/promotion.server";
import { resolveLoyaltyTier } from "~/lib/loyalty";
import { logError } from "~/lib/logger.server";
import { decrementStock } from "~/lib/inventory.server";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export async function action({ request }: ActionFunctionArgs) {
  if (!WEBHOOK_SECRET) {
    return json({ error: "STRIPE_WEBHOOK_SECRET no configurado." }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  const payload = await request.text();

  if (!signature) {
    return json({ error: "Falta la firma de Stripe." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Firma inválida";
    // No es un throw (Stripe reintenta webhooks con 4xx/5xx igual, y no
    // queremos que reintente uno que nunca va a validar), pero una firma
    // que de repente empieza a fallar casi siempre significa un
    // STRIPE_WEBHOOK_SECRET mal configurado — sin loguearlo, los pedidos
    // dejarían de confirmarse en silencio.
    logError("stripe-webhook-signature", err, { message });
    // El detalle queda en los registros del servidor; a quien llama no se le explica por qué falló.
    return json({ error: "Webhook inválido." }, { status: 400 });
  }

  await connectDB();

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;

      // Con pagos diferidos (OXXO, transferencia SPEI) Stripe avisa que la
      // sesión se completó cuando el cliente generó la ficha, NO cuando pagó:
      // `payment_status` sigue en "unpaid". Registrar el pedido entonces
      // significaría dar por pagado algo que quizá nunca se pague. Se espera
      // al evento async_payment_succeeded, que repite la sesión ya pagada.
      if (session.payment_status === "unpaid") break;

      if (session.mode === "payment") {
        await handleOneTimeCheckoutCompleted(session);
      } else if (session.mode === "subscription") {
        await handleSubscriptionCheckoutCompleted(session);
      }
      break;
    }

    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // No hay pedido que cancelar (nunca se creó); solo se deja constancia.
      logError("stripe-async-payment-failed", new Error("Un pago diferido no se completó."), {
        sessionId: session.id,
      });
      break;
    }

    case "invoice.payment_succeeded": {
      await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
      break;
    }

    case "charge.refunded": {
      await handleChargeRefunded(event.data.object as Stripe.Charge);
      break;
    }

    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      // Una disputa (contracargo) tiene fecha límite para responder en el panel
      // de Stripe; el aviso en los registros es para no enterarse tarde.
      logError("stripe-dispute-created", new Error("El cliente abrió una disputa de pago."), {
        disputeId: dispute.id,
        chargeId: typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id,
        amount: dispute.amount / 100,
        reason: dispute.reason,
      });
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      logError("stripe-invoice-payment-failed", new Error("No se pudo cobrar una renovación."), {
        invoiceId: invoice.id,
        subscriptionId: typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id,
      });
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await syncSubscriptionStatus(subscription);
      break;
    }

    default:
      break;
  }

  return json({ received: true });
}

function readAttribution(metadata: Stripe.Metadata | null) {
  return {
    utm_source: metadata?.utm_source ?? "",
    utm_medium: metadata?.utm_medium ?? "",
    utm_campaign: metadata?.utm_campaign ?? "",
  };
}

function readAppliedPromotion(metadata: Stripe.Metadata | null) {
  if (!metadata?.promotionId) return undefined;
  return { id: metadata.promotionId, name: metadata.promotionName ?? "", type: metadata.promotionType ?? "" };
}

type EffectName = "stock" | "promotion" | "lead" | "loyalty" | "subscription" | "refund";

/**
 * Reclama un efecto del pedido de forma atómica: devuelve true solo para quien
 * lo marca por primera vez. Los pedidos sin control de efectos (creados antes
 * de este cambio) devuelven false para no reprocesarlos.
 */
async function claimEffect(orderId: unknown, effect: EffectName) {
  const result = await OrderModel.updateOne(
    { _id: orderId, effects: { $exists: true }, [`effects.${effect}`]: { $ne: true } },
    { $set: { [`effects.${effect}`]: true } },
  );
  return result.modifiedCount === 1;
}

const NO_EFFECTS_YET = { stock: false, promotion: false, lead: false, loyalty: false, subscription: false, refund: false };

/** Crea el pedido, o devuelve el que ya existe si Stripe repitió el evento (o dos llegaron a la vez). */
async function createOrderOnce(data: Record<string, unknown> & { stripeCheckoutSessionId: string }) {
  try {
    return await OrderModel.create({ ...data, effects: NO_EFFECTS_YET });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return OrderModel.findOne({ stripeCheckoutSessionId: data.stripeCheckoutSessionId });
    }
    throw err;
  }
}

async function bumpPromotionUsage(promotionId?: string) {
  if (!promotionId) return;
  await PromotionModel.findByIdAndUpdate(promotionId, { $inc: { timesUsed: 1 } });
}

async function markLeadConverted(email: string) {
  await LeadModel.findOneAndUpdate({ email, status: "pending" }, { status: "converted" });
}

/**
 * El premio de lealtad nunca es permanente: se gana para la SIGUIENTE compra
 * y se limpia en cuanto se usa (usedLoyaltyReward). El contador del ciclo se
 * reinicia cada vez que se completa, y la recompensa que le toca depende de
 * cuántos ciclos ya completó — ver resolveLoyaltyTier.
 */
async function bumpUserLoyaltyAndLTV(
  user: InstanceType<typeof UserModel>,
  netAmount: number,
  countsTowardLoyalty: boolean,
  usedLoyaltyReward: boolean,
) {
  user.totalSpentLTV = (user.totalSpentLTV ?? 0) + netAmount;
  if (usedLoyaltyReward) {
    user.loyaltyPendingReward = null;
  }
  if (countsTowardLoyalty) {
    user.individualPurchaseCount += 1;
    user.loyaltyCycleCount = (user.loyaltyCycleCount ?? 0) + 1;
    const loyalty = await getActiveLoyaltyConfig();
    if (user.loyaltyCycleCount >= loyalty.purchasesRequired) {
      const tier = resolveLoyaltyTier(user.loyaltyCyclesCompleted ?? 0, loyalty.tiers);
      user.loyaltyPendingReward = {
        promotionId: loyalty.id ? new mongoose.Types.ObjectId(loyalty.id) : undefined,
        promotionName: loyalty.name ?? "Lealtad",
        rewardType: tier.rewardType ?? "discount",
        percentage: tier.percentage ?? undefined,
        giftDescription: tier.giftDescription ?? undefined,
      };
      user.loyaltyCyclesCompleted = (user.loyaltyCyclesCompleted ?? 0) + 1;
      user.loyaltyCycleCount = 0;
    }
  }
  await user.save();
}

async function handleOneTimeCheckoutCompleted(session: Stripe.Checkout.Session) {
  const cartSkus = session.metadata?.cartSkus ?? "";
  const parsedEntries = cartSkus
    .split(",")
    .filter(Boolean)
    .map((entry) => {
      const [sku, quantityRaw, priceRaw] = entry.split(":");
      return { sku, quantity: Number(quantityRaw) || 1, unitPriceMxn: Number(priceRaw) || 0 };
    });
  // El precio se toma de la metadata (lo que realmente se cobró en esta
  // sesión); el catálogo actual solo se consulta para el nombre — si el
  // producto se borra después, el pedido conserva su SKU como referencia en
  // vez de desaparecer o quedar con nombre vacío.
  const items = await Promise.all(
    parsedEntries.map(async (entry) => {
      const name = await getCatalogItemNameBySku(entry.sku);
      return { sku: entry.sku, name: name ?? entry.sku, quantity: entry.quantity, unitPriceMxn: entry.unitPriceMxn };
    }),
  );

  const giftSku = session.metadata?.giftSku;
  if (giftSku) {
    const giftName = await getCatalogItemNameBySku(giftSku);
    if (giftName) {
      items.push({ sku: giftSku, name: `Regalo: ${giftName}`, quantity: 1, unitPriceMxn: 0 });
    }
  }

  const loyaltyGiftDescription = session.metadata?.loyaltyGiftDescription;
  if (loyaltyGiftDescription) {
    items.push({ sku: "loyalty-gift", name: `Regalo: ${loyaltyGiftDescription}`, quantity: 1, unitPriceMxn: 0 });
  }

  // El envío va aparte de session.amount_total (Stripe lo suma vía
  // shipping_options, no como line item) — se separa aquí para que el
  // descuento se siga calculando solo sobre productos, nunca sobre el envío.
  const shippingCost = Number(session.metadata?.shippingCost ?? 0) || 0;
  const shippingMethod = session.metadata?.shippingMethod ?? "";
  const shippingMethodLabel = session.metadata?.shippingMethodLabel ?? "";
  const shippingFree = session.metadata?.shippingFree === "true";
  // Dirección que el cliente escribió en la pantalla de pago de Stripe.
  const stripeShipping = session.shipping_details;
  const shippingAddress = stripeShipping?.address
    ? {
        name: stripeShipping.name ?? undefined,
        phone: session.customer_details?.phone ?? undefined,
        line1: stripeShipping.address.line1 ?? undefined,
        line2: stripeShipping.address.line2 ?? undefined,
        city: stripeShipping.address.city ?? undefined,
        state: stripeShipping.address.state ?? undefined,
        postalCode: stripeShipping.address.postal_code ?? undefined,
        country: stripeShipping.address.country ?? "MX",
      }
    : undefined;

  const totalAmount = items.reduce((sum, item) => sum + item.unitPriceMxn * item.quantity, 0);
  const grossCharged = (session.amount_total ?? (totalAmount + shippingCost) * 100) / 100;
  const productNetAmount = grossCharged - shippingCost;
  const discountAmount = Math.max(0, totalAmount - productNetAmount);
  const discountPercent = totalAmount > 0 ? Math.round((discountAmount / totalAmount) * 100) : 0;

  const email =
    session.customer_details?.email ?? session.customer_email ?? "desconocido@stopee.com.mx";
  const userId = session.metadata?.userId;
  const user = userId && userId !== "guest" ? await UserModel.findById(userId) : null;

  const appliedPromotion = readAppliedPromotion(session.metadata ?? null);

  const order = await createOrderOnce({
    user: user?._id,
    email,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId:
      typeof session.payment_intent === "string" ? session.payment_intent : undefined,
    items,
    totalAmount,
    discountAmount,
    discountPercent,
    netAmount: grossCharged,
    shippingCost,
    shippingMethod,
    shippingMethodLabel,
    shippingFree,
    shippingAddress,
    type: "one_time",
    status: "paid",
    countsTowardLoyalty: true,
    attribution: readAttribution(session.metadata ?? null),
    promotion: appliedPromotion,
  });

  if (!order) return;

  // Cada efecto se reclama por separado: si algo falla a la mitad, Stripe
  // reintenta el evento y solo se repite lo que faltó.
  if (await claimEffect(order._id, "lead")) await markLeadConverted(email);
  if (await claimEffect(order._id, "promotion")) await bumpPromotionUsage(appliedPromotion?.id);
  if (await claimEffect(order._id, "stock")) {
    await decrementStock([
      ...parsedEntries.map((entry) => ({ sku: entry.sku, quantity: entry.quantity })),
      ...(giftSku ? [{ sku: giftSku, quantity: 1 }] : []),
    ]);
  }
  if (user && (await claimEffect(order._id, "loyalty"))) {
    const usedLoyaltyReward = session.metadata?.usedLoyaltyReward === "true";
    await bumpUserLoyaltyAndLTV(user, grossCharged, true, usedLoyaltyReward);
  }
}

/** Convierte la metadata "sku:cantidad:precio,sku:cantidad:precio" en la caja real de la suscripción. */
function parseSubscriptionItemsMetadata(raw: string | undefined) {
  return (raw ?? "")
    .split(",")
    .filter(Boolean)
    .map((entry) => {
      const [sku, quantityRaw, priceRaw] = entry.split(":");
      return { sku, name: sku, quantity: Number(quantityRaw) || 1, unitPriceMxn: Number(priceRaw) || 0 };
    });
}

async function handleSubscriptionCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  if (!userId || typeof session.subscription !== "string") return;

  const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);
  const frequency = session.metadata?.frequency ?? "4-semanas";
  const stripeCustomerId =
    typeof stripeSubscription.customer === "string"
      ? stripeSubscription.customer
      : stripeSubscription.customer.id;

  // El nombre real (no solo el SKU) se resuelve contra el catálogo actual;
  // si el producto se borra después, la caja guardada conserva el SKU.
  const parsedItems = parseSubscriptionItemsMetadata(session.metadata?.subscriptionItems);
  const items = await Promise.all(
    parsedItems.map(async (item) => ({
      ...item,
      name: (await getCatalogItemNameBySku(item.sku)) ?? item.sku,
    })),
  );

  // upsert: si Stripe reintenta el evento, la suscripción no se duplica y el resto del proceso continúa.
  await SubscriptionModel.updateOne(
    { stripeSubscriptionId: stripeSubscription.id },
    {
      $setOnInsert: {
        user: userId,
        stripeSubscriptionId: stripeSubscription.id,
        stripeCustomerId,
        items,
        frequency,
        discountPercent: Number(session.metadata?.discountPercent ?? 0) || 0,
        status: "active",
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        nextDeliveryDate: new Date(stripeSubscription.current_period_end * 1000),
      },
    },
    { upsert: true },
  );

  await UserModel.findByIdAndUpdate(userId, { stripeCustomerId });

  // El primer cobro de la suscripción también es un pedido real (la caja
  // completa que armó el cliente) — no debe faltar en las métricas de
  // ventas ni en el conteo de "pedidos generados" de la suscripción.
  const netAmount = (session.amount_total ?? 0) / 100;
  const email = session.customer_details?.email ?? session.customer_email ?? "";
  const user = await UserModel.findById(userId);

  const order = await createOrderOnce({
    user: userId,
    email: email || user?.email || "desconocido@stopee.com.mx",
    stripeCheckoutSessionId: session.id,
    stripeSubscriptionId: stripeSubscription.id,
    items,
    totalAmount: netAmount,
    discountAmount: 0,
    discountPercent: 0,
    netAmount,
    type: "subscription_first",
    status: "paid",
    countsTowardLoyalty: false,
    attribution: readAttribution(session.metadata ?? null),
  });
  if (!order) return;

  if (await claimEffect(order._id, "subscription")) {
    await SubscriptionModel.findOneAndUpdate(
      { stripeSubscriptionId: stripeSubscription.id },
      { $inc: { totalOrdersGenerated: 1 } },
    );
  }
  if (email && (await claimEffect(order._id, "lead"))) await markLeadConverted(email);
  if (await claimEffect(order._id, "stock")) {
    await decrementStock(items.map((item) => ({ sku: item.sku, quantity: item.quantity })));
  }
  if (user && (await claimEffect(order._id, "loyalty"))) await bumpUserLoyaltyAndLTV(user, netAmount, false, false);
}

/** Renovaciones automáticas: cada factura pagada de un ciclo genera su propio pedido. */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId =
    typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId || invoice.billing_reason !== "subscription_cycle") return;

  const subscription = await SubscriptionModel.findOne({ stripeSubscriptionId: subscriptionId });
  if (!subscription) return;

  if (!invoice.id) return;

  const netAmount = (invoice.amount_paid ?? 0) / 100;
  const user = await UserModel.findById(subscription.user);

  // La caja renovada es la MISMA que se guardó al suscribirse o en el
  // último cambio de frecuencia — nunca se reconstruye desde Stripe en cada
  // renovación, para no depender de que sus Price/Product sigan intactos.
  const renewalItems = subscription.items?.length
    ? subscription.items.map((item) => ({ ...item, name: `${item.name} (renovación)` }))
    : [{ sku: "concentrado-1l", name: "STOPee Concentrado 1L (renovación)", quantity: 1, unitPriceMxn: netAmount }];

  const order = await createOrderOnce({
    user: subscription.user,
    email: user?.email ?? invoice.customer_email ?? "desconocido@stopee.com.mx",
    // Las facturas de renovación no tienen Checkout Session propia; se usa
    // el id de la factura como llave de idempotencia en su lugar.
    stripeCheckoutSessionId: invoice.id,
    stripeSubscriptionId: subscriptionId,
    items: renewalItems,
    totalAmount: netAmount,
    discountAmount: 0,
    discountPercent: subscription.discountPercent ?? 0,
    netAmount,
    type: "subscription_recurring",
    status: "paid",
    countsTowardLoyalty: false,
  });

  if (!order) return;

  if (await claimEffect(order._id, "subscription")) {
    const periodEnd = invoice.lines?.data?.[0]?.period?.end;
    await SubscriptionModel.updateOne(
      { _id: subscription._id },
      {
        $inc: { totalOrdersGenerated: 1 },
        ...(periodEnd
          ? { $set: { currentPeriodEnd: new Date(periodEnd * 1000), nextDeliveryDate: new Date(periodEnd * 1000) } }
          : {}),
      },
    );
  }
  if (await claimEffect(order._id, "stock")) {
    await decrementStock(renewalItems.map((item) => ({ sku: item.sku, quantity: item.quantity })));
  }
  if (user && (await claimEffect(order._id, "loyalty"))) {
    await UserModel.updateOne({ _id: user._id }, { $inc: { totalSpentLTV: netAmount } });
  }
}

/**
 * Reembolso total: el pedido pasa a "refunded" para que no cuente como venta en
 * los reportes, y se resta de lo gastado por el cliente. No se reponen
 * existencias (la mercancía puede no regresar) ni se resta la compra de
 * lealtad: eso se decide a mano. Un reembolso parcial solo se deja anotado.
 */
async function handleChargeRefunded(charge: Stripe.Charge) {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  if (!charge.refunded) {
    logError("stripe-partial-refund", new Error("Reembolso parcial: revisa el pedido a mano."), {
      chargeId: charge.id,
      refunded: charge.amount_refunded / 100,
    });
    return;
  }

  const order = await OrderModel.findOne({ stripePaymentIntentId: paymentIntentId });
  if (!order) return;

  await OrderModel.updateOne({ _id: order._id }, { $set: { status: "refunded" } });
  if (order.user && (await claimEffect(order._id, "refund"))) {
    await UserModel.updateOne({ _id: order.user }, { $inc: { totalSpentLTV: -order.netAmount } });
  }
}

async function syncSubscriptionStatus(subscription: Stripe.Subscription) {
  const status =
    subscription.status === "canceled"
      ? "cancelled"
      : subscription.pause_collection
        ? "paused"
        : subscription.status === "past_due"
          ? "past_due"
          : "active";

  await SubscriptionModel.findOneAndUpdate(
    { stripeSubscriptionId: subscription.id },
    {
      status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    },
  );
}
