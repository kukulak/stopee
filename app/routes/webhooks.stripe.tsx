import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type Stripe from "stripe";
import { stripe } from "~/lib/stripe.server";
import { connectDB } from "~/lib/db.server";
import { OrderModel } from "~/models/order.server";
import { SubscriptionModel } from "~/models/subscription.server";
import { UserModel } from "~/models/user.server";
import { PRODUCTS } from "~/data/products";
import type { ProductSku } from "~/data/products";
import { LOYALTY_PURCHASES_REQUIRED } from "~/data/products";

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

  const subtotalMxn = items.reduce((sum, item) => sum + item.unitPriceMxn * item.quantity, 0);
  const totalMxn = (session.amount_total ?? subtotalMxn * 100) / 100;
  const discountPercent = subtotalMxn > 0 ? Math.round((1 - totalMxn / subtotalMxn) * 100) : 0;

  const userId = session.metadata?.userId;
  const user = userId && userId !== "guest" ? await UserModel.findById(userId) : null;

  await OrderModel.create({
    user: user?._id,
    email: session.customer_details?.email ?? session.customer_email ?? "desconocido@stopee.com.mx",
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId:
      typeof session.payment_intent === "string" ? session.payment_intent : undefined,
    items,
    subtotalMxn,
    discountPercent,
    totalMxn,
    status: "paid",
    countsTowardLoyalty: true,
  });

  if (user) {
    user.individualPurchaseCount += 1;
    if (user.individualPurchaseCount >= LOYALTY_PURCHASES_REQUIRED) {
      user.loyaltyDiscountActive = true;
    }
    await user.save();
  }
}

async function handleSubscriptionCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  if (!userId || typeof session.subscription !== "string") return;

  const existing = await SubscriptionModel.findOne({ stripeSubscriptionId: session.subscription });
  if (existing) return;

  const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);
  const frequency = session.metadata?.frequency ?? "4-semanas";

  await SubscriptionModel.create({
    user: userId,
    stripeSubscriptionId: stripeSubscription.id,
    stripeCustomerId:
      typeof stripeSubscription.customer === "string"
        ? stripeSubscription.customer
        : stripeSubscription.customer.id,
    frequency,
    status: "active",
    currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
  });

  await UserModel.findByIdAndUpdate(userId, {
    stripeCustomerId:
      typeof stripeSubscription.customer === "string"
        ? stripeSubscription.customer
        : stripeSubscription.customer.id,
  });
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
