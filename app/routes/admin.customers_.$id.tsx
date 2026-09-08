import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { connectDB } from "~/lib/db.server";
import { UserModel } from "~/models/user.server";
import { OrderModel } from "~/models/order.server";
import { SubscriptionModel } from "~/models/subscription.server";
import { AnalyticsEventModel } from "~/models/analyticsEvent.server";
import { PRODUCTS, type ProductSku } from "~/data/products";

export const meta: MetaFunction = () => [{ title: "Cliente — Admin STOPee" }];

const REVENUE_STATUSES = ["paid", "processing", "shipped", "delivered"];

const EVENT_LABELS: Record<string, string> = {
  page_view: "Visitó el sitio",
  view_item: "Vio un producto",
  add_to_cart: "Agregó al carrito",
  begin_checkout: "Inició el pago",
  banner_click: "Le dio clic al banner",
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  paid: "Pagado",
  processing: "En preparación",
  shipped: "En tránsito",
  delivered: "Entregado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

export async function loader({ params }: LoaderFunctionArgs) {
  await connectDB();
  const user = await UserModel.findById(params.id).lean();
  if (!user) throw new Response("Cliente no encontrado", { status: 404 });

  const [orders, subscriptions, events] = await Promise.all([
    OrderModel.find({ user: user._id }).sort({ createdAt: -1 }).lean(),
    SubscriptionModel.find({ user: user._id }).sort({ createdAt: -1 }).lean(),
    AnalyticsEventModel.find({ userId: user._id }).sort({ createdAt: -1 }).limit(60).lean(),
  ]);

  const revenueOrders = orders.filter((o) => REVENUE_STATUSES.includes(o.status));
  const oneTimeOrders = revenueOrders.filter((o) => o.type === "one_time");
  const hasActiveSubscription = subscriptions.some((s) => s.status === "active" || s.status === "past_due");
  // Compra seguido pero nunca se metió al auto-envío — pierde el descuento de
  // suscripción en cada pedido. Es exactamente el caso que vale la pena
  // ofrecerle el auto-envío de forma proactiva.
  const isSubscriptionCandidate = oneTimeOrders.length >= 2 && !hasActiveSubscription;

  const hasOrdered = revenueOrders.length > 0;
  const hasBeginCheckout = events.some((e) => e.type === "begin_checkout");
  const hasAddToCart = events.some((e) => e.type === "add_to_cart");
  const hasViewItem = events.some((e) => e.type === "view_item");
  const funnelStage = hasOrdered
    ? "Compró"
    : hasBeginCheckout
      ? "Inició el pago, pero no completó la compra"
      : hasAddToCart
        ? "Agregó productos al carrito, pero no pagó"
        : hasViewItem
          ? "Vio productos, sin agregar al carrito"
          : "Solo entró al sitio";

  return json({
    profile: {
      id: String(user._id),
      email: user.email,
      name: user.name ?? "",
      phone: user.phone ?? "",
      address: user.address ?? null,
      dogs: (user.dogs ?? []).map((d) => ({ name: d.name, birthday: d.birthday as unknown as string | null })),
      registeredAt: user.createdAt,
      role: user.role,
    },
    insights: {
      ltv: Math.round(user.totalSpentLTV ?? 0),
      orderCount: revenueOrders.length,
      loyaltyCycleCount: user.loyaltyCycleCount ?? 0,
      loyaltyPendingReward: user.loyaltyPendingReward
        ? {
            rewardType: user.loyaltyPendingReward.rewardType,
            percentage: user.loyaltyPendingReward.percentage ?? null,
            giftDescription: user.loyaltyPendingReward.giftDescription ?? null,
          }
        : null,
      isSubscriptionCandidate,
      funnelStage,
    },
    orders: orders.map((o) => ({
      id: String(o._id),
      items: o.items as { sku: string; name: string; quantity: number; unitPriceMxn: number }[],
      netAmount: o.netAmount,
      status: o.status,
      type: o.type,
      promotionName: o.promotion?.name ?? null,
      createdAt: o.createdAt,
    })),
    subscriptions: subscriptions.map((s) => ({
      id: String(s._id),
      frequency: s.frequency,
      status: s.status,
      discountPercent: s.discountPercent,
      totalOrdersGenerated: s.totalOrdersGenerated,
      nextDeliveryDate: s.nextDeliveryDate,
    })),
    timeline: events.map((e) => ({
      type: e.type,
      label: EVENT_LABELS[e.type] ?? e.type,
      productName: e.sku ? PRODUCTS[e.sku as ProductSku]?.name ?? e.sku : null,
      at: e.createdAt,
    })),
  });
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-carbon/10 bg-white p-5 ${className}`}>{children}</div>;
}

export default function AdminCustomerDetail() {
  const { profile, insights, orders, subscriptions, timeline } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/admin/customers" className="text-sm font-semibold text-bosque hover:underline">
          ← Clientes
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-black text-carbon">{profile.name || profile.email}</h1>
          {profile.role === "admin" && (
            <span className="rounded-full bg-carbon/10 px-2.5 py-1 text-xs font-semibold text-carbon/60">Admin</span>
          )}
        </div>
        <p className="mt-1 text-sm text-carbon/60">
          {profile.email} · Registrado el {new Date(profile.registeredAt).toLocaleDateString("es-MX")}
        </p>
      </div>

      {insights.isSubscriptionCandidate && (
        <Card className="border-oliva/40 bg-oliva/5">
          <p className="font-display font-bold text-carbon">💡 Candidato a suscripción</p>
          <p className="mt-1 text-sm text-carbon/70">
            Ya hizo {insights.orderCount} compras individuales pero no tiene un auto-envío activo —
            cada vez que recompra a mano, se pierde el descuento de suscripción. Buen momento para
            ofrecérselo.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">LTV</p>
          <p className="mt-2 font-display text-2xl font-black text-bosque">${insights.ltv.toLocaleString("es-MX")}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Pedidos</p>
          <p className="mt-2 font-display text-2xl font-black text-carbon">{insights.orderCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Lealtad</p>
          <p className="mt-2 text-sm font-semibold text-carbon">
            {insights.loyaltyPendingReward
              ? `🎁 ${insights.loyaltyPendingReward.rewardType === "gift" ? insights.loyaltyPendingReward.giftDescription : `${insights.loyaltyPendingReward.percentage}% listo`}`
              : `${insights.loyaltyCycleCount} compras en su ciclo actual`}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Llegó hasta</p>
          <p className="mt-2 text-sm font-semibold text-carbon">{insights.funnelStage}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Datos de contacto</h2>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-carbon/50">Teléfono</dt>
              <dd className="text-right text-carbon/70">{profile.phone || "sin registrar"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-carbon/50">Dirección</dt>
              <dd className="text-right text-carbon/70">
                {profile.address?.line1
                  ? `${profile.address.line1}${profile.address.line2 ? `, ${profile.address.line2}` : ""}, ${profile.address.city ?? ""}, ${profile.address.state ?? ""} ${profile.address.postalCode ?? ""}`
                  : "sin registrar"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-carbon/50">Perros</p>
          {profile.dogs.length === 0 ? (
            <p className="mt-1 text-sm text-carbon/60">Sin registrar.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1 text-sm text-carbon/70">
              {profile.dogs.map((d, i) => (
                <li key={i}>
                  {d.name}
                  {d.birthday && ` — 🎂 ${new Date(d.birthday).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}`}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Suscripción</h2>
          {subscriptions.length === 0 ? (
            <p className="mt-2 text-sm text-carbon/60">Nunca se ha suscrito al auto-envío.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-3">
              {subscriptions.map((s) => (
                <li key={s.id} className="rounded-xl border border-carbon/10 p-3 text-sm">
                  <p className="font-semibold text-carbon">
                    {s.frequency} · {s.status === "active" ? "Activa" : s.status === "paused" ? "Pausada" : s.status === "past_due" ? "Pago pendiente" : "Cancelada"}
                  </p>
                  <p className="mt-1 text-carbon/60">
                    {s.discountPercent}% de descuento · {s.totalOrdersGenerated} envíos generados
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="font-display text-lg font-bold text-carbon">Historial de pedidos</h2>
        {orders.length === 0 ? (
          <p className="mt-3 text-sm text-carbon/60">Todavía no ha comprado.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-carbon/50">
                  <th className="pb-2">Fecha</th>
                  <th className="pb-2">Artículos</th>
                  <th className="pb-2">Promoción</th>
                  <th className="pb-2">Estado</th>
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-carbon/5">
                    <td className="py-2.5 text-carbon/60">{new Date(o.createdAt).toLocaleDateString("es-MX")}</td>
                    <td className="py-2.5 text-carbon/70">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</td>
                    <td className="py-2.5 text-carbon/60">{o.promotionName || "—"}</td>
                    <td className="py-2.5 text-carbon/60">{ORDER_STATUS_LABELS[o.status] ?? o.status}</td>
                    <td className="py-2.5 text-right font-semibold text-carbon">${o.netAmount.toLocaleString("es-MX")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-display text-lg font-bold text-carbon">Comportamiento reciente</h2>
        <p className="mt-1 text-sm text-carbon/60">
          Solo se registran eventos ocurridos con sesión iniciada.
        </p>
        {timeline.length === 0 ? (
          <p className="mt-3 text-sm text-carbon/60">Sin actividad registrada todavía.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {timeline.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-4 border-t border-carbon/5 pt-2 text-sm first:border-0 first:pt-0">
                <span className="text-carbon/70">
                  {e.label}
                  {e.productName && `: ${e.productName}`}
                </span>
                <span className="shrink-0 text-xs text-carbon/40">
                  {new Date(e.at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
