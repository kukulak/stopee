import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { connectDB } from "~/lib/db.server";
import { requireUserId } from "~/lib/session.server";
import { UserModel } from "~/models/user.server";
import { OrderModel } from "~/models/order.server";
import { SubscriptionModel } from "~/models/subscription.server";
import {
  createBillingPortalSession,
  pauseSubscription,
  resumeSubscription,
  updateSubscriptionFrequency,
} from "~/lib/stripe.server";
import {
  SUBSCRIPTION_FREQUENCIES,
  type SubscriptionFrequency,
} from "~/data/subscriptionFrequencies";
import { LOYALTY_PURCHASES_REQUIRED } from "~/data/products";

const ORDER_STATUS_LABELS: Record<string, string> = {
  paid: "Pagado",
  processing: "En preparación",
  shipped: "En tránsito",
  delivered: "Entregado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

export const meta: MetaFunction = () => [{ title: "Mi cuenta — STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  await connectDB();

  const [user, orders, subscriptions] = await Promise.all([
    UserModel.findById(userId).lean(),
    OrderModel.find({ user: userId }).sort({ createdAt: -1 }).lean(),
    SubscriptionModel.find({ user: userId }).sort({ createdAt: -1 }).lean(),
  ]);

  if (!user) throw new Response("Usuario no encontrado", { status: 404 });

  return json({
    user: { name: user.name, email: user.email, dogName: user.dogName },
    loyalty: {
      count: user.individualPurchaseCount ?? 0,
      required: LOYALTY_PURCHASES_REQUIRED,
      active: Boolean(user.loyaltyDiscountActive),
    },
    orders: orders.map((o) => ({
      id: String(o._id),
      items: o.items,
      netAmount: o.netAmount,
      status: o.status,
      createdAt: o.createdAt,
    })),
    subscriptions: subscriptions.map((s) => ({
      id: String(s._id),
      stripeSubscriptionId: s.stripeSubscriptionId,
      frequency: s.frequency,
      status: s.status,
      currentPeriodEnd: s.currentPeriodEnd,
    })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  await connectDB();
  const formData = await request.formData();
  const intent = formData.get("intent");
  const subscriptionId = String(formData.get("subscriptionId") ?? "");

  const subscription = await SubscriptionModel.findOne({ _id: subscriptionId, user: userId });
  if (intent === "billing-portal") {
    const user = await UserModel.findById(userId);
    if (!user?.stripeCustomerId) {
      return json({ error: "Aún no tienes un método de pago registrado." }, { status: 400 });
    }
    const portalSession = await createBillingPortalSession(user.stripeCustomerId);
    return redirect(portalSession.url);
  }

  if (!subscription) {
    return json({ error: "Suscripción no encontrada." }, { status: 404 });
  }

  if (intent === "pause-subscription") {
    await pauseSubscription(subscription.stripeSubscriptionId);
    subscription.status = "paused";
    await subscription.save();
  }

  if (intent === "resume-subscription") {
    await resumeSubscription(subscription.stripeSubscriptionId);
    subscription.status = "active";
    await subscription.save();
  }

  if (intent === "update-frequency") {
    const frequency = String(formData.get("frequency"));
    if (!(frequency in SUBSCRIPTION_FREQUENCIES)) {
      return json({ error: "Frecuencia no válida." }, { status: 400 });
    }
    await updateSubscriptionFrequency(
      subscription.stripeSubscriptionId,
      frequency as SubscriptionFrequency,
    );
    subscription.frequency = frequency as SubscriptionFrequency;
    await subscription.save();
  }

  return json({ ok: true });
}

export default function Cuenta() {
  const { user, loyalty, orders, subscriptions } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isBusy = navigation.state !== "idle";

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar />

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
            Mi cuenta
          </p>
          <h1 className="mt-2 font-display text-3xl font-black text-carbon">
            Hola{user.name ? `, ${user.name}` : ""}
            {user.dogName ? ` y ${user.dogName}` : ""} 👋
          </h1>
          <p className="mt-1 text-carbon/60">{user.email}</p>

          {/* Fidelidad */}
          <div className="mt-8 rounded-3xl border border-lima/30 bg-bosque/5 p-6">
            <p className="font-display font-bold text-carbon">Programa de fidelidad</p>
            {loyalty.active ? (
              <p className="mt-1 text-sm text-bosque">
                Tienes activo tu 10% de descuento permanente por compras individuales. ¡Gracias
                por ser parte del cambio!
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm text-carbon/70">
                  Llevas {loyalty.count} de {loyalty.required} compras individuales. Al completar
                  tu {loyalty.required}ª compra, activas 10% de descuento permanente.
                </p>
                <div className="mt-3 flex gap-1.5">
                  {Array.from({ length: loyalty.required }).map((_, i: number) => (
                    <span
                      key={i}
                      className={`h-2 flex-1 rounded-full ${
                        i < loyalty.count ? "bg-lima" : "bg-carbon/10"
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Suscripciones */}
          <div className="mt-10">
            <h2 className="font-display text-xl font-black text-carbon">Mi suscripción</h2>
            {subscriptions.length === 0 ? (
              <p className="mt-2 text-sm text-carbon/60">
                Aún no tienes un auto-envío activo. Actívalo desde la{" "}
                <a href="/tienda#suscripcion" className="font-semibold text-bosque hover:underline">
                  tienda
                </a>
                .
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-4">
                {subscriptions.map((sub) => (
                  <li
                    key={sub.id}
                    className="rounded-3xl border border-carbon/10 bg-white p-5 sm:p-6"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-display font-bold text-carbon">
                          STOPee Concentrado 1L —{" "}
                          {SUBSCRIPTION_FREQUENCIES[sub.frequency as SubscriptionFrequency]?.label}
                        </p>
                        <p className="text-sm text-carbon/60">
                          Estado:{" "}
                          <span className="font-semibold capitalize">
                            {sub.status === "active"
                              ? "Activa"
                              : sub.status === "paused"
                                ? "Pausada"
                                : sub.status === "past_due"
                                  ? "Pago pendiente"
                                  : "Cancelada"}
                          </span>
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {sub.status === "active" ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="pause-subscription" />
                            <input type="hidden" name="subscriptionId" value={sub.id} />
                            <button
                              type="submit"
                              disabled={isBusy}
                              className="min-h-11 rounded-full border border-carbon/15 px-4 text-sm font-semibold text-carbon disabled:opacity-60"
                            >
                              Pausar
                            </button>
                          </Form>
                        ) : sub.status === "paused" ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="resume-subscription" />
                            <input type="hidden" name="subscriptionId" value={sub.id} />
                            <button
                              type="submit"
                              disabled={isBusy}
                              className="min-h-11 rounded-full bg-lima px-4 text-sm font-bold text-carbon disabled:opacity-60"
                            >
                              Reanudar
                            </button>
                          </Form>
                        ) : null}

                        <Form method="post">
                          <input type="hidden" name="intent" value="billing-portal" />
                          <button
                            type="submit"
                            disabled={isBusy}
                            className="min-h-11 rounded-full border border-carbon/15 px-4 text-sm font-semibold text-carbon disabled:opacity-60"
                          >
                            Gestionar pago
                          </button>
                        </Form>
                      </div>
                    </div>

                    <Form method="post" className="mt-4 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="intent" value="update-frequency" />
                      <input type="hidden" name="subscriptionId" value={sub.id} />
                      <label htmlFor={`freq-${sub.id}`} className="text-sm text-carbon/60">
                        Cambiar frecuencia:
                      </label>
                      <select
                        id={`freq-${sub.id}`}
                        name="frequency"
                        defaultValue={sub.frequency}
                        className="min-h-11 rounded-xl border border-carbon/15 px-3 text-sm"
                      >
                        {Object.entries(SUBSCRIPTION_FREQUENCIES).map(([value, freq]) => (
                          <option key={value} value={value}>
                            {freq.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={isBusy}
                        className="min-h-11 rounded-full border border-carbon/15 px-4 text-sm font-semibold text-carbon disabled:opacity-60"
                      >
                        Guardar
                      </button>
                    </Form>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Pedidos */}
          <div className="mt-10">
            <h2 className="font-display text-xl font-black text-carbon">Mis pedidos</h2>
            {orders.length === 0 ? (
              <p className="mt-2 text-sm text-carbon/60">Todavía no tienes pedidos.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {orders.map((order) => (
                  <li
                    key={order.id}
                    className="flex items-center justify-between rounded-2xl border border-carbon/10 bg-white p-4"
                  >
                    <div>
                      <p className="text-sm font-semibold text-carbon">
                        {(order.items as Array<{ quantity: number; name: string }>)
                          .map((i) => `${i.quantity}× ${i.name}`)
                          .join(", ")}
                      </p>
                      <p className="text-xs text-carbon/50">
                        {new Date(order.createdAt).toLocaleDateString("es-MX")} ·{" "}
                        {ORDER_STATUS_LABELS[order.status] ?? order.status}
                      </p>
                    </div>
                    <p className="font-display font-bold text-carbon">${order.netAmount} MXN</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Form method="post" action="/cuenta/salir" className="mt-12">
            <button type="submit" className="text-sm font-semibold text-carbon/50 hover:text-carbon">
              Cerrar sesión
            </button>
          </Form>
        </section>
      </main>

      <Footer />
    </div>
  );
}
