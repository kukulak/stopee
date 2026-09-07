import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type Stripe from "stripe";
import { stripe } from "~/lib/stripe.server";
import { connectDB } from "~/lib/db.server";
import { OrderModel } from "~/models/order.server";
import { SubscriptionModel } from "~/models/subscription.server";
import { UserModel } from "~/models/user.server";
import { LeadModel } from "~/models/lead.server";
import { PRODUCTS } from "~/data/products";
import type { ProductSku } from "~/data/products";
import { getActiveLoyaltyConfig, PromotionModel } from "~/models/promotion.server";

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
    return json({ error: `Webhook inválido: ${message}` }, { status: 400 });
  }

  await connectDB();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.mode === "payment") {
        await handleOneTimeCheckoutCompleted(session);
      } else if (session.mode === "subscription") {
        await handleSubscriptionCheckoutCompleted(session);
      }
      break;
    }

    case "invoice.payment_succeeded": {
      await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
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

async function bumpPromotionUsage(promotionId?: string) {
  if (!promotionId) return;
  await PromotionModel.findByIdAndUpdate(promotionId, { $inc: { timesUsed: 1 } });
}

async function markLeadConverted(email: string) {
  await LeadModel.findOneAndUpdate({ email, status: "pending" }, { status: "converted" });
}

async function bumpUserLoyaltyAndLTV(user: InstanceType<typeof UserModel>, netAmount: number, countsTowardLoyalty: boolean) {
  user.totalSpentLTV = (user.totalSpentLTV ?? 0) + netAmount;
  if (countsTowardLoyalty) {
    user.individualPurchaseCount += 1;
    const loyalty = await getActiveLoyaltyConfig();
    if (user.individualPurchaseCount >= loyalty.purchasesRequired) {
      user.loyaltyDiscountActive = true;
    }
  }
  await user.save();
}

async function handleOneTimeCheckoutCompleted(session: Stripe.Checkout.Session) {
  const existing = await OrderModel.findOne({ stripeCheckoutSessionId: session.id });
  if (existing) return;

  const cartSkus = session.metadata?.cartSkus ?? "";
  const items = cartSkus
    .split(",")
    .filter(Boolean)
    .map((entry) => {
      const [sku, quantityRaw] = entry.split(":");
      const quantity = Number(quantityRaw) || 1;
      const product = PRODUCTS[sku as ProductSku];
      return product
        ? { sku, name: product.name, quantity, unitPriceMxn: product.priceMxn }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const giftSku = session.metadata?.giftSku;
  if (giftSku && giftSku in PRODUCTS) {
    const gift = PRODUCTS[giftSku as ProductSku];
    items.push({ sku: giftSku, name: `🎁 ${gift.name}`, quantity: 1, unitPriceMxn: 0 });
  }

  const totalAmount = items.reduce((sum, item) => sum + item.unitPriceMxn * item.quantity, 0);
  const netAmount = (session.amount_total ?? totalAmount * 100) / 100;
  const discountAmount = Math.max(0, totalAmount - netAmount);
  const discountPercent = totalAmount > 0 ? Math.round((discountAmount / totalAmount) * 100) : 0;

  const email =
    session.customer_details?.email ?? session.customer_email ?? "desconocido@stopee.com.mx";
  const userId = session.metadata?.userId;
  const user = userId && userId !== "guest" ? await UserModel.findById(userId) : null;

  const appliedPromotion = readAppliedPromotion(session.metadata ?? null);

  await OrderModel.create({
    user: user?._id,
    email,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId:
      typeof session.payment_intent === "string" ? session.payment_intent : undefined,
    items,
    totalAmount,
    discountAmount,
    discountPercent,
    netAmount,
    type: "one_time",
    status: "paid",
    countsTowardLoyalty: true,
    attribution: readAttribution(session.metadata ?? null),
    promotion: appliedPromotion,
  });

  await markLeadConverted(email);
  await bumpPromotionUsage(appliedPromotion?.id);
  if (user) await bumpUserLoyaltyAndLTV(user, netAmount, true);
}

async function handleSubscriptionCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  if (!userId || typeof session.subscription !== "string") return;

  const existing = await SubscriptionModel.findOne({ stripeSubscriptionId: session.subscription });
  if (existing) return;

  const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);
  const frequency = session.metadata?.frequency ?? "4-semanas";
  const stripeCustomerId =
    typeof stripeSubscription.customer === "string"
      ? stripeSubscription.customer
      : stripeSubscription.customer.id;

  await SubscriptionModel.create({
    user: userId,
    stripeSubscriptionId: stripeSubscription.id,
    stripeCustomerId,
    frequency,
    status: "active",
    currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
    nextDeliveryDate: new Date(stripeSubscription.current_period_end * 1000),
  });

  await UserModel.findByIdAndUpdate(userId, { stripeCustomerId });

  // El primer cobro de la suscripción también es un pedido real (1L de
  // concentrado) — no debe faltar en las métricas de ventas ni en el
  // conteo de "pedidos generados" de la suscripción.
  const netAmount = (session.amount_total ?? 0) / 100;
  const email = session.customer_details?.email ?? session.customer_email ?? "";
  const user = await UserModel.findById(userId);

  const existingOrder = session.id
    ? await OrderModel.findOne({ stripeCheckoutSessionId: session.id })
    : null;
  if (!existingOrder) {
    await OrderModel.create({
      user: userId,
      email: email || user?.email || "desconocido@stopee.com.mx",
      stripeCheckoutSessionId: session.id,
      stripeSubscriptionId: stripeSubscription.id,
      items: [{ sku: "concentrado-1l", name: "STOPee Concentrado 1L (suscripción)", quantity: 1, unitPriceMxn: netAmount }],
      totalAmount: netAmount,
      discountAmount: 0,
      discountPercent: 0,
      netAmount,
      type: "subscription_first",
      status: "paid",
      countsTowardLoyalty: false,
      attribution: readAttribution(session.metadata ?? null),
    });
    await SubscriptionModel.findOneAndUpdate(
      { stripeSubscriptionId: stripeSubscription.id },
      { $inc: { totalOrdersGenerated: 1 } },
    );
    if (email) await markLeadConverted(email);
    if (user) await bumpUserLoyaltyAndLTV(user, netAmount, false);
  }
}

/** Renovaciones automáticas: cada factura pagada de un ciclo genera su propio pedido. */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId =
    typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId || invoice.billing_reason !== "subscription_cycle") return;

  const subscription = await SubscriptionModel.findOne({ stripeSubscriptionId: subscriptionId });
  if (!subscription) return;

  const existing = invoice.id ? await OrderModel.findOne({ stripeCheckoutSessionId: invoice.id }) : null;
  if (existing) return;

  const netAmount = (invoice.amount_paid ?? 0) / 100;
  const user = await UserModel.findById(subscription.user);

  await OrderModel.create({
    user: subscription.user,
    email: user?.email ?? invoice.customer_email ?? "desconocido@stopee.com.mx",
    // Las facturas de renovación no tienen Checkout Session propia; se usa
    // el id de la factura como llave de idempotencia en su lugar.
    stripeCheckoutSessionId: invoice.id,
    stripeSubscriptionId: subscriptionId,
    items: [{ sku: "concentrado-1l", name: "STOPee Concentrado 1L (renovación)", quantity: 1, unitPriceMxn: netAmount }],
    totalAmount: netAmount,
    discountAmount: 0,
    discountPercent: subscription.discountPercent ?? 0,
    netAmount,
    type: "subscription_recurring",
    status: "paid",
    countsTowardLoyalty: false,
  });

  subscription.totalOrdersGenerated += 1;
  const periodEnd = invoice.lines?.data?.[0]?.period?.end;
  if (periodEnd) {
    subscription.currentPeriodEnd = new Date(periodEnd * 1000);
    subscription.nextDeliveryDate = new Date(periodEnd * 1000);
  }
  await subscription.save();

  if (user) {
    user.totalSpentLTV = (user.totalSpentLTV ?? 0) + netAmount;
    await user.save();
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
