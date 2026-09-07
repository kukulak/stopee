import type { MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { connectDB } from "~/lib/db.server";
import { UserModel } from "~/models/user.server";
import { OrderModel } from "~/models/order.server";
import { LeadModel } from "~/models/lead.server";
import { AnalyticsEventModel } from "~/models/analyticsEvent.server";

export const meta: MetaFunction = () => [{ title: "Clientes — Admin STOPee" }];

const REVENUE_STATUSES = ["paid", "processing", "shipped", "delivered"];
const ABANDONED_LOOKBACK_DAYS = 14;

export async function loader() {
  await connectDB();

  const [users, leads, purchasedUserIds, guestOrders] = await Promise.all([
    UserModel.find()
      .select("email name dogName totalSpentLTV individualPurchaseCount createdAt")
      .sort({ createdAt: -1 })
      .lean(),
    LeadModel.find().lean(),
    OrderModel.distinct("user", { status: { $in: REVENUE_STATUSES }, user: { $ne: null } }),
    OrderModel.aggregate([
      { $match: { status: { $in: REVENUE_STATUSES }, user: null, email: { $ne: "desconocido@stopee.com.mx" } } },
      { $group: { _id: "$email", orders: { $sum: 1 }, totalSpent: { $sum: "$netAmount" }, lastOrderAt: { $max: "$createdAt" } } },
      { $sort: { lastOrderAt: -1 } },
    ]),
  ]);

  const purchasedIds = new Set(purchasedUserIds.map((id) => String(id)));

  const customersWithPurchase = users
    .filter((u) => purchasedIds.has(String(u._id)))
    .map((u) => ({
      id: String(u._id),
      email: u.email,
      name: u.name ?? "",
      dogName: u.dogName ?? "",
      orderCount: u.individualPurchaseCount ?? 0,
      ltv: Math.round(u.totalSpentLTV ?? 0),
      registeredAt: u.createdAt,
    }))
    .sort((a, b) => b.ltv - a.ltv);

  const registeredNoPurchase = users
    .filter((u) => !purchasedIds.has(String(u._id)))
    .map((u) => ({
      id: String(u._id),
      email: u.email,
      name: u.name ?? "",
      dogName: u.dogName ?? "",
      registeredAt: u.createdAt,
    }));

  const anonymousBuyers = guestOrders.map((g) => ({
    email: g._id as string,
    orders: g.orders as number,
    totalSpent: Math.round(g.totalSpent as number),
    lastOrderAt: g.lastOrderAt as Date,
  }));

  // Carritos abandonados: solo se pueden identificar cuando el evento ocurrió
  // con sesión iniciada (ver AnalyticsEvent.userId) — la mayoría de las
  // visitas son anónimas y no dejan un contacto al que escribirle.
  const lookback = new Date(Date.now() - ABANDONED_LOOKBACK_DAYS * 86400000);
  const [recentCheckoutStarts, anonymousAbandonedCount] = await Promise.all([
    AnalyticsEventModel.aggregate([
      { $match: { type: "begin_checkout", userId: { $ne: null }, createdAt: { $gte: lookback } } },
      { $group: { _id: "$userId", lastAttemptAt: { $max: "$createdAt" }, email: { $first: "$email" } } },
    ]),
    AnalyticsEventModel.countDocuments({ type: "begin_checkout", userId: null, createdAt: { $gte: lookback } }),
  ]);

  const attemptedUserIds = recentCheckoutStarts.map((r) => r._id);
  const ordersSince = attemptedUserIds.length
    ? await OrderModel.find({ user: { $in: attemptedUserIds } }).select("user createdAt").lean()
    : [];
  const lastOrderByUser = new Map<string, number>();
  for (const o of ordersSince) {
    if (!o.user) continue;
    const key = String(o.user);
    const t = new Date(o.createdAt as unknown as string).getTime();
    if (!lastOrderByUser.has(key) || t > lastOrderByUser.get(key)!) lastOrderByUser.set(key, t);
  }
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const abandonedCarts = recentCheckoutStarts
    .filter((r) => {
      const lastOrderAt = lastOrderByUser.get(String(r._id));
      return !lastOrderAt || lastOrderAt < new Date(r.lastAttemptAt).getTime();
    })
    .map((r) => ({
      userId: String(r._id),
      email: (r.email as string) || userById.get(String(r._id))?.email || "",
      name: userById.get(String(r._id))?.name ?? "",
      lastAttemptAt: r.lastAttemptAt as Date,
    }))
    .sort((a, b) => new Date(b.lastAttemptAt).getTime() - new Date(a.lastAttemptAt).getTime());

  const totalLeads = leads.length;
  const pendingLeads = leads.filter((l) => l.status === "pending").length;

  return json({
    counts: {
      registeredNoPurchase: registeredNoPurchase.length,
      customersWithPurchase: customersWithPurchase.length,
      anonymousBuyers: anonymousBuyers.length,
      abandonedCarts: abandonedCarts.length,
      totalLeads,
      pendingLeads,
    },
    registeredNoPurchase,
    customersWithPurchase,
    anonymousBuyers,
    abandonedCarts,
    anonymousAbandonedCount,
    abandonedLookbackDays: ABANDONED_LOOKBACK_DAYS,
  });
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-carbon/10 bg-white p-5 ${className}`}>{children}</div>;
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">{label}</p>
      <p className="mt-2 font-display text-2xl font-black text-carbon">{value}</p>
      {hint && <p className="mt-1 text-xs text-carbon/50">{hint}</p>}
    </Card>
  );
}

function daysAgo(date: string | Date) {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}

export default function AdminCustomers() {
  const data = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-black text-carbon">Clientes</h1>
        <p className="mt-1 text-sm text-carbon/60">
          El recorrido completo: quién tiene cuenta pero no ha comprado, quién ya es cliente, quién
          compró sin registrarse y quién dejó el carrito a medias.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Registrados sin compra" value={data.counts.registeredNoPurchase} />
        <StatCard label="Clientes con cuenta" value={data.counts.customersWithPurchase} />
        <StatCard label="Compradores anónimos" value={data.counts.anonymousBuyers} hint="Compraron sin crear cuenta" />
        <StatCard
          label="Carritos abandonados"
          value={data.counts.abandonedCarts}
          hint={`Con sesión iniciada, últimos ${data.abandonedLookbackDays} días`}
        />
        <Link to="/admin/leads" className="block">
          <Card className="h-full transition-shadow hover:shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Lista de espera</p>
            <p className="mt-2 font-display text-2xl font-black text-carbon">{data.counts.totalLeads}</p>
            <p className="mt-1 text-xs text-carbon/50">{data.counts.pendingLeads} pendientes · Administrar →</p>
          </Card>
        </Link>
      </div>

      <Card>
        <h2 className="font-display text-lg font-bold text-carbon">Carritos abandonados</h2>
        <p className="mt-1 text-sm text-carbon/60">
          Iniciaron el pago con sesión abierta en los últimos {data.abandonedLookbackDays} días y no
          completaron ninguna compra después. Buen candidato para un correo de recordatorio.
        </p>
        {data.abandonedCarts.length === 0 ? (
          <p className="mt-4 text-sm text-carbon/60">Nadie con sesión iniciada abandonó el carrito en este periodo.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-carbon/50">
                  <th className="pb-2">Cliente</th>
                  <th className="pb-2">Correo</th>
                  <th className="pb-2 text-right">Último intento</th>
                </tr>
              </thead>
              <tbody>
                {data.abandonedCarts.map((c) => (
                  <tr key={c.userId} className="border-t border-carbon/5">
                    <td className="py-2.5 font-semibold text-carbon">{c.name || "Sin nombre"}</td>
                    <td className="py-2.5 text-carbon/70">{c.email}</td>
                    <td className="py-2.5 text-right text-carbon/60">{daysAgo(c.lastAttemptAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.anonymousAbandonedCount > 0 && (
          <p className="mt-3 text-xs text-carbon/40">
            Además, {data.anonymousAbandonedCount} inicios de pago anónimos (sin sesión) en el mismo
            periodo — no se pueden asociar a un correo para contactarlos.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Registrados sin compra</h2>
          <p className="mt-1 text-sm text-carbon/60">Tienen cuenta en el sitio pero todavía no compran nada.</p>
          {data.registeredNoPurchase.length === 0 ? (
            <p className="mt-4 text-sm text-carbon/60">Todos los registrados ya compraron al menos una vez.</p>
          ) : (
            <div className="mt-4 max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-carbon/50">
                    <th className="pb-2">Correo</th>
                    <th className="pb-2">Nombre</th>
                    <th className="pb-2 text-right">Registro</th>
                  </tr>
                </thead>
                <tbody>
                  {data.registeredNoPurchase.map((u) => (
                    <tr key={u.id} className="border-t border-carbon/5">
                      <td className="py-2.5 text-carbon/70">{u.email}</td>
                      <td className="py-2.5 text-carbon/70">{u.name || "—"}</td>
                      <td className="py-2.5 text-right text-carbon/50">
                        {new Date(u.registeredAt).toLocaleDateString("es-MX")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Compradores anónimos</h2>
          <p className="mt-1 text-sm text-carbon/60">Compraron como invitados, sin crear una cuenta.</p>
          {data.anonymousBuyers.length === 0 ? (
            <p className="mt-4 text-sm text-carbon/60">Todas las compras vienen de cuentas registradas.</p>
          ) : (
            <div className="mt-4 max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-carbon/50">
                    <th className="pb-2">Correo</th>
                    <th className="pb-2 text-right">Pedidos</th>
                    <th className="pb-2 text-right">Gastado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.anonymousBuyers.map((b) => (
                    <tr key={b.email} className="border-t border-carbon/5">
                      <td className="py-2.5 text-carbon/70">{b.email}</td>
                      <td className="py-2.5 text-right font-semibold text-carbon">{b.orders}</td>
                      <td className="py-2.5 text-right text-bosque">${b.totalSpent.toLocaleString("es-MX")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="font-display text-lg font-bold text-carbon">Clientes con cuenta</h2>
        <p className="mt-1 text-sm text-carbon/60">Ya compraron al menos una vez y tienen perfil en el sitio.</p>
        {data.customersWithPurchase.length === 0 ? (
          <p className="mt-4 text-sm text-carbon/60">Todavía nadie con cuenta ha comprado.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-carbon/50">
                  <th className="pb-2">Correo</th>
                  <th className="pb-2">Nombre</th>
                  <th className="pb-2">Perro</th>
                  <th className="pb-2 text-right">Compras individuales</th>
                  <th className="pb-2 text-right">LTV</th>
                </tr>
              </thead>
              <tbody>
                {data.customersWithPurchase.map((c) => (
                  <tr key={c.id} className="border-t border-carbon/5">
                    <td className="py-2.5 text-carbon/70">{c.email}</td>
                    <td className="py-2.5 text-carbon/70">{c.name || "—"}</td>
                    <td className="py-2.5 text-carbon/70">{c.dogName || "—"}</td>
                    <td className="py-2.5 text-right font-semibold text-carbon">{c.orderCount}</td>
                    <td className="py-2.5 text-right font-semibold text-bosque">${c.ltv.toLocaleString("es-MX")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
