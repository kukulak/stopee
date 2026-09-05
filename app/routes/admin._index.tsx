import type { MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { connectDB } from "~/lib/db.server";
import { OrderModel } from "~/models/order.server";
import { LeadModel } from "~/models/lead.server";

export const meta: MetaFunction = () => [{ title: "Dashboard — Admin STOPee" }];

export async function loader() {
  await connectDB();

  const [totalLeads, salesAgg, pendingOrders, topProducts] = await Promise.all([
    LeadModel.countDocuments(),
    OrderModel.aggregate([
      { $match: { status: { $in: ["paid", "fulfilled"] } } },
      { $group: { _id: null, total: { $sum: "$totalMxn" }, count: { $sum: 1 } } },
    ]),
    OrderModel.countDocuments({ status: "pending" }),
    OrderModel.aggregate([
      { $match: { status: { $in: ["paid", "fulfilled"] } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.sku",
          name: { $first: "$items.name" },
          totalQuantity: { $sum: "$items.quantity" },
        },
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const totalSalesMxn = salesAgg[0]?.total ?? 0;
  const totalPaidOrders = salesAgg[0]?.count ?? 0;
  const maxQuantity = Math.max(1, ...topProducts.map((p) => p.totalQuantity));

  return json({
    totalLeads,
    totalSalesMxn,
    totalPaidOrders,
    pendingOrders,
    topProducts: topProducts.map((p) => ({
      sku: p._id as string,
      name: p.name as string,
      totalQuantity: p.totalQuantity as number,
      barPercent: Math.round((p.totalQuantity / maxQuantity) * 100),
    })),
  });
}

export default function AdminDashboard() {
  const { totalLeads, totalSalesMxn, totalPaidOrders, pendingOrders, topProducts } =
    useLoaderData<typeof loader>();

  return (
    <div>
      <h1 className="font-display text-2xl font-black text-carbon">Dashboard</h1>
      <p className="mt-1 text-sm text-carbon/60">Resumen general del negocio.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Lista de espera" value={totalLeads.toLocaleString("es-MX")} />
        <SummaryCard
          label="Ventas totales"
          value={`$${totalSalesMxn.toLocaleString("es-MX")} MXN`}
        />
        <SummaryCard label="Pedidos pagados" value={totalPaidOrders.toLocaleString("es-MX")} />
        <SummaryCard
          label="Pedidos pendientes"
          value={pendingOrders.toLocaleString("es-MX")}
          accent={pendingOrders > 0}
        />
      </div>

      <div className="mt-8 rounded-3xl border border-carbon/10 bg-white p-6">
        <h2 className="font-display text-lg font-bold text-carbon">Paquetes más vendidos</h2>
        {topProducts.length === 0 ? (
          <p className="mt-3 text-sm text-carbon/60">
            Todavía no hay pedidos pagados para calcular tendencias.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {topProducts.map((p) => (
              <li key={p.sku}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-carbon">{p.name}</span>
                  <span className="text-carbon/60">{p.totalQuantity} unidades</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-carbon/10">
                  <div
                    className="h-full rounded-full bg-lima"
                    style={{ width: `${p.barPercent}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          to="/admin/leads"
          className="min-h-11 rounded-full border border-carbon/15 px-5 py-2.5 text-sm font-semibold text-carbon hover:border-carbon/30"
        >
          Ver lista de espera →
        </Link>
        <Link
          to="/admin/settings"
          className="min-h-11 rounded-full border border-carbon/15 px-5 py-2.5 text-sm font-semibold text-carbon hover:border-carbon/30"
        >
          Ir a configuración →
        </Link>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl border p-5 ${
        accent ? "border-lima bg-lima/10" : "border-carbon/10 bg-white"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">{label}</p>
      <p className="mt-2 font-display text-2xl font-black text-carbon">{value}</p>
    </div>
  );
}
