import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import mongoose from "mongoose";
import { Form, useLoaderData, useSearchParams } from "@remix-run/react";
import { connectDB } from "~/lib/db.server";
import { OrderModel } from "~/models/order.server";
import { requireAdmin } from "~/lib/session.server";
import { sendEmail } from "~/lib/mail.server";
import { orderShippedEmail } from "~/lib/emailTemplates.server";
import { logError } from "~/lib/logger.server";

export const meta: MetaFunction = () => [{ title: "Pedidos — Admin STOPee" }];

const STATUS_FILTERS = ["all", "paid", "processing", "shipped", "delivered", "cancelled", "refunded"] as const;
const STATUS_LABELS: Record<string, string> = {
  paid: "Nuevo",
  processing: "En preparación",
  shipped: "En tránsito",
  delivered: "Entregado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};
const STATUS_FLOW = ["paid", "processing", "shipped", "delivered"] as const;
const ORDER_STATUSES: string[] = [...STATUS_FLOW, "cancelled", "refunded"];
const PAGE_SIZE = 20;

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") ?? "all";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

  const query = statusFilter !== "all" ? { status: statusFilter } : {};
  const [orders, totalCount, counts] = await Promise.all([
    OrderModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    OrderModel.countDocuments(query),
    OrderModel.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);
  const countByStatus = Object.fromEntries(counts.map((c) => [c._id, c.count]));
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return json({
    orders: orders.map((o) => ({
      id: String(o._id),
      email: o.email,
      items: o.items,
      netAmount: o.netAmount,
      shippingCost: o.shippingCost ?? 0,
      shippingMethodLabel: o.shippingMethodLabel ?? "",
      shippingFree: Boolean(o.shippingFree),
      shippingAddress: o.shippingAddress
        ? {
            name: o.shippingAddress.name ?? "",
            phone: o.shippingAddress.phone ?? "",
            line1: o.shippingAddress.line1 ?? "",
            line2: o.shippingAddress.line2 ?? "",
            city: o.shippingAddress.city ?? "",
            state: o.shippingAddress.state ?? "",
            postalCode: o.shippingAddress.postalCode ?? "",
          }
        : null,
      type: o.type,
      status: o.status,
      trackingNumber: o.trackingNumber ?? "",
      createdAt: o.createdAt,
      promotionName: o.promotion?.name ?? null,
    })),
    countByStatus,
    statusFilter,
    page,
    totalPages,
    totalCount,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = String(formData.get("id"));

  if (!mongoose.isValidObjectId(id)) {
    return json({ error: "Pedido no válido." }, { status: 400 });
  }

  if (intent === "update-status" || intent === "save-tracking") {
    const before = await OrderModel.findById(id).select("status trackingNumber").lean();

    if (intent === "update-status") {
      const status = String(formData.get("status"));
      if (!ORDER_STATUSES.includes(status)) {
        return json({ error: "Estado no válido." }, { status: 400 });
      }
      await OrderModel.findByIdAndUpdate(id, { status }, { runValidators: true });
    } else {
      const trackingNumber = String(formData.get("trackingNumber") ?? "").trim();
      await OrderModel.findByIdAndUpdate(id, {
        trackingNumber: trackingNumber.slice(0, 80),
        ...(trackingNumber ? { status: "shipped" } : {}),
      });
    }

    // Aviso al cliente (lo prometemos en "Mi cuenta"): cuando el pedido pasa a
    // "En tránsito" o cuando se captura/cambia el número de guía.
    try {
      const after = await OrderModel.findById(id).lean();
      if (after && before) {
        const justShipped = after.status === "shipped" && before.status !== "shipped";
        const trackingChanged = Boolean(after.trackingNumber) && after.trackingNumber !== before.trackingNumber;
        if (justShipped || trackingChanged) {
          await sendEmail({
            to: { email: after.email },
            ...orderShippedEmail({
              trackingNumber: after.trackingNumber || undefined,
              items: after.items.map((i) => ({ name: i.name, quantity: i.quantity })),
            }),
          });
        }
      }
    } catch (error) {
      logError("orders.shipped-notify", error, { orderId: id });
    }

    return json({ ok: true });
  }

  return json({ ok: false, error: "Acción no reconocida." }, { status: 400 });
}

const TYPE_LABELS: Record<string, string> = {
  one_time: "Compra única",
  subscription_first: "Suscripción (1er pago)",
  subscription_recurring: "Suscripción (renovación)",
};

export default function AdminOrders() {
  const { orders, countByStatus, statusFilter, page, totalPages, totalCount } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  return (
    <div>
      <h1 className="font-display text-2xl font-black text-carbon sm:text-3xl">Pedidos</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Operación diaria: estado, guía y seguimiento de cada pedido. {totalCount} en total.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((status) => {
          const params = new URLSearchParams(searchParams);
          if (status === "all") params.delete("status");
          else params.set("status", status);
          params.delete("page");
          const count = status === "all"
            ? Object.values(countByStatus as Record<string, number>).reduce((a, b) => a + b, 0)
            : (countByStatus as Record<string, number>)[status] ?? 0;

          return (
            <a
              key={status}
              href={`?${params.toString()}`}
              className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold ${
                statusFilter === status
                  ? "bg-carbon text-hueso"
                  : "border border-carbon/15 text-carbon hover:border-carbon/30"
              }`}
            >
              {status === "all" ? "Todos" : STATUS_LABELS[status]} ({count})
            </a>
          );
        })}
      </div>

      {orders.length === 0 ? (
        <p className="mt-8 text-sm text-carbon/60">No hay pedidos con este filtro.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {orders.map((order) => (
            <li key={order.id} className="min-w-0 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <p className="order-first font-display text-lg font-black text-carbon sm:order-last sm:shrink-0">
                  ${order.netAmount} MXN
                </p>
                <div className="min-w-0 sm:flex-1">
                  <p className="break-all font-semibold text-carbon sm:break-words">{order.email}</p>
                  <p className="text-sm text-carbon/60">
                    {(order.items as Array<{ quantity: number; name: string }>)
                      .map((i) => `${i.quantity}× ${i.name}`)
                      .join(", ")}
                  </p>
                  <p className="mt-1 text-xs text-carbon/50">
                    {new Date(order.createdAt).toLocaleString("es-MX")} ·{" "}
                    {TYPE_LABELS[order.type] ?? order.type}
                    {order.promotionName && (
                      <>
                        {" "}
                        ·{" "}
                        <span className="font-semibold text-oliva">{order.promotionName}</span>
                      </>
                    )}
                    {(order.shippingMethodLabel || order.shippingCost > 0) && (
                      <>
                        {" "}
                        · {order.shippingMethodLabel || "Envío"}:{" "}
                        {order.shippingFree || order.shippingCost === 0 ? "gratis" : `$${order.shippingCost} MXN`}
                      </>
                    )}
                  </p>
                  {order.shippingAddress && (order.shippingAddress.line1 || order.shippingAddress.postalCode) && (
                    <p className="mt-2 rounded-xl bg-carbon/5 px-3 py-2 text-xs text-carbon/70">
                      <span className="font-semibold text-carbon">Entregar a:</span>{" "}
                      {[order.shippingAddress.name, order.shippingAddress.phone && `Tel. ${order.shippingAddress.phone}`]
                        .filter(Boolean)
                        .join(" · ")}
                      <br />
                      {[
                        order.shippingAddress.line1,
                        order.shippingAddress.line2,
                        order.shippingAddress.city,
                        order.shippingAddress.state,
                        order.shippingAddress.postalCode && `CP ${order.shippingAddress.postalCode}`,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Form method="post" className="flex w-full items-center gap-2 sm:w-auto">
                  <input type="hidden" name="intent" value="update-status" />
                  <input type="hidden" name="id" value={order.id} />
                  <label htmlFor={`status-${order.id}`} className="shrink-0 text-xs font-semibold text-carbon/60">Estado</label>
                  <select
                    id={`status-${order.id}`}
                    name="status"
                    defaultValue={order.status}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-carbon/15 px-3 text-sm focus:border-oliva focus:outline-none sm:flex-none"
                  >
                    {[...STATUS_FLOW, "cancelled", "refunded"].map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </Form>

                <Form method="post" className="flex w-full items-center gap-2 sm:w-auto">
                  <input type="hidden" name="intent" value="save-tracking" />
                  <input type="hidden" name="id" value={order.id} />
                  <label htmlFor={`tracking-${order.id}`} className="shrink-0 text-xs font-semibold text-carbon/60">Guía</label>
                  <input
                    id={`tracking-${order.id}`}
                    name="trackingNumber"
                    defaultValue={order.trackingNumber}
                    placeholder="Número de guía"
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-carbon/15 px-3 text-sm focus:border-oliva focus:outline-none sm:w-40 sm:flex-none"
                  />
                  <button
                    type="submit"
                    className="min-h-11 shrink-0 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30"
                  >
                    Guardar
                  </button>
                </Form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
            const params = new URLSearchParams(searchParams);
            params.set("page", String(p));
            return (
              <a
                key={p}
                href={`?${params.toString()}`}
                className={`flex min-h-11 min-w-11 items-center justify-center rounded-full text-sm font-semibold ${
                  page === p ? "bg-carbon text-hueso" : "border border-carbon/15 text-carbon hover:border-carbon/30"
                }`}
              >
                {p}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
