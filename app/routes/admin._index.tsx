import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { connectDB } from "~/lib/db.server";
import { OrderModel } from "~/models/order.server";
import { LeadModel } from "~/models/lead.server";
import { SubscriptionModel } from "~/models/subscription.server";
import { UserModel } from "~/models/user.server";
import { ProductModel } from "~/models/product.server";
import { AnalyticsEventModel } from "~/models/analyticsEvent.server";
import { getSiteSettings } from "~/models/siteSettings.server";
import { resolveDateRange, percentChange } from "~/lib/dateRange.server";
import { monthlyEquivalent } from "~/lib/mrr.server";
import { SUBSCRIPTION_UNIT_AMOUNT_MXN_CENTS } from "~/lib/stripe.server";
import { PRODUCTS } from "~/data/products";
import { useSearchParams } from "@remix-run/react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts";

export const meta: MetaFunction = () => [{ title: "Dashboard — Admin STOPee" }];

const REVENUE_STATUSES = ["paid", "processing", "shipped", "delivered"];
const AUDIENCES = ["all", "new", "recurring", "subscribers"] as const;
type Audience = (typeof AUDIENCES)[number];

export async function loader({ request }: LoaderFunctionArgs) {
  await connectDB();
  const url = new URL(request.url);
  const range = resolveDateRange(url);
  const audience = (AUDIENCES.includes(url.searchParams.get("audience") as Audience)
    ? url.searchParams.get("audience")
    : "all") as Audience;

  const dateMatch = (from: Date, to: Date) => ({ createdAt: { $gte: from, $lte: to } });

  const [currentOrdersRaw, previousOrdersRaw] = await Promise.all([
    OrderModel.find({ ...dateMatch(range.from, range.to), status: { $in: REVENUE_STATUSES } }).lean(),
    OrderModel.find({ ...dateMatch(range.previousFrom, range.previousTo), status: { $in: REVENUE_STATUSES } }).lean(),
  ]);

  // Segmentación de audiencia: se aplica sobre las órdenes ya traídas para no
  // repetir la consulta a Mongo — con el volumen esperado en esta etapa del
  // negocio el filtrado en memoria es más simple y suficientemente rápido.
  const userIdsWithMultipleOrders = new Set<string>();
  {
    const countByUser = new Map<string, number>();
    for (const o of currentOrdersRaw) {
      if (!o.user) continue;
      const key = String(o.user);
      countByUser.set(key, (countByUser.get(key) ?? 0) + 1);
    }
    for (const [key, count] of countByUser) if (count > 1) userIdsWithMultipleOrders.add(key);
  }

  function matchesAudience(o: (typeof currentOrdersRaw)[number]) {
    if (audience === "all") return true;
    if (audience === "subscribers") return o.type !== "one_time";
    const userKey = o.user ? String(o.user) : null;
    const isRecurring = userKey ? userIdsWithMultipleOrders.has(userKey) : false;
    if (audience === "recurring") return isRecurring;
    if (audience === "new") return !isRecurring;
    return true;
  }

  const currentOrders = currentOrdersRaw.filter(matchesAudience);
  const previousOrders = previousOrdersRaw.filter(matchesAudience);

  // ---------- Capa 1: KPIs ----------
  const grossRevenue = currentOrders.reduce((s, o) => s + o.totalAmount, 0);
  const netRevenue = currentOrders.reduce((s, o) => s + o.netAmount, 0);
  const discountGiven = currentOrders.reduce((s, o) => s + o.discountAmount, 0);
  const prevNetRevenue = previousOrders.reduce((s, o) => s + o.netAmount, 0);
  const orderCount = currentOrders.length;
  const prevOrderCount = previousOrders.length;
  const aov = orderCount > 0 ? netRevenue / orderCount : 0;
  const prevAov = prevOrderCount > 0 ? prevNetRevenue / prevOrderCount : 0;

  const revenueByDay: Record<string, number> = Object.fromEntries(range.dayBuckets.map((d) => [d, 0]));
  for (const o of currentOrders) {
    const key = new Date(o.createdAt as unknown as string).toISOString().slice(0, 10);
    if (key in revenueByDay) revenueByDay[key] += o.netAmount;
  }
  const revenueSparkline = range.dayBuckets.map((day) => ({ day: day.slice(5), revenue: Math.round(revenueByDay[day]) }));

  const orderStatusCounts = { paid: 0, processing: 0, shipped: 0, delivered: 0 };
  for (const o of currentOrders) {
    if (o.status in orderStatusCounts) orderStatusCounts[o.status as keyof typeof orderStatusCounts] += 1;
  }

  const activeSubs = await SubscriptionModel.find({ status: "active" }).lean();
  const mrr = activeSubs.reduce((sum, s) => {
    const base = (SUBSCRIPTION_UNIT_AMOUNT_MXN_CENTS / 100) * (1 - (s.discountPercent ?? 10) / 100);
    return sum + monthlyEquivalent(base, s.frequency);
  }, 0);

  // ---------- Capa 2: Paquetes y embudo ----------
  const skuPerformance = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const o of currentOrders) {
    for (const item of o.items) {
      const entry = skuPerformance.get(item.sku) ?? { name: item.name, quantity: 0, revenue: 0 };
      entry.quantity += item.quantity;
      entry.revenue += item.unitPriceMxn * item.quantity;
      skuPerformance.set(item.sku, entry);
    }
  }
  const bundleMatrix = Array.from(skuPerformance.entries())
    .map(([sku, v]) => ({ sku, name: PRODUCTS[sku as keyof typeof PRODUCTS]?.name ?? v.name, quantity: v.quantity, revenue: Math.round(v.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  const eventCounts = await AnalyticsEventModel.aggregate([
    { $match: dateMatch(range.from, range.to) },
    { $group: { _id: "$type", count: { $sum: 1 } } },
  ]);
  const eventCountByType = Object.fromEntries(eventCounts.map((e) => [e._id, e.count as number]));
  const funnel = [
    { step: "Sesiones", count: eventCountByType.page_view ?? 0 },
    { step: "Vio producto", count: eventCountByType.view_item ?? 0 },
    { step: "Agregó al carrito", count: eventCountByType.add_to_cart ?? 0 },
    { step: "Inició checkout", count: eventCountByType.begin_checkout ?? 0 },
    { step: "Compró", count: orderCount },
  ];

  const oneTimeCount = currentOrders.filter((o) => o.type === "one_time").length;
  const subscriptionCount = currentOrders.filter((o) => o.type !== "one_time").length;

  // ---------- Capa 3: Suscripciones y lealtad ----------
  const allSubs = await SubscriptionModel.find().lean();
  const subStatusCounts = { active: 0, paused: 0, cancelled: 0, past_due: 0 };
  for (const s of allSubs) if (s.status in subStatusCounts) subStatusCounts[s.status as keyof typeof subStatusCounts] += 1;
  const churnRate = allSubs.length > 0 ? Math.round((subStatusCounts.cancelled / allSubs.length) * 100) : 0;
  const retentionRate = allSubs.length > 0 ? Math.round((subStatusCounts.active / allSubs.length) * 100) : 0;

  const frequencyDistribution = new Map<string, number>();
  for (const s of allSubs.filter((s) => s.status === "active")) {
    frequencyDistribution.set(s.frequency, (frequencyDistribution.get(s.frequency) ?? 0) + 1);
  }

  const loyaltyUsers = await UserModel.find({ individualPurchaseCount: { $gt: 0 } })
    .select("individualPurchaseCount loyaltyDiscountActive totalSpentLTV")
    .lean();
  const loyaltyFunnel = [1, 2, 3, 4].map((n) => ({
    step: `${n}ª compra`,
    count: loyaltyUsers.filter((u) => u.individualPurchaseCount === n).length,
  }));
  const loyaltyUnlocked = loyaltyUsers.filter((u) => u.loyaltyDiscountActive).length;
  const usersWithSpend = loyaltyUsers.filter((u) => (u.totalSpentLTV ?? 0) > 0);
  const avgLtv =
    usersWithSpend.length > 0
      ? usersWithSpend.reduce((s, u) => s + (u.totalSpentLTV ?? 0), 0) / usersWithSpend.length
      : 0;

  // ---------- Capa 4: Adquisición ----------
  const attributionMap = new Map<string, { orders: number; revenue: number }>();
  for (const o of currentOrders) {
    const key = o.attribution?.utm_source || "directo";
    const entry = attributionMap.get(key) ?? { orders: 0, revenue: 0 };
    entry.orders += 1;
    entry.revenue += o.netAmount;
    attributionMap.set(key, entry);
  }
  const attributionBreakdown = Array.from(attributionMap.entries())
    .map(([source, v]) => ({ source, orders: v.orders, revenue: Math.round(v.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  const [totalLeads, convertedLeads, leadsInRange] = await Promise.all([
    LeadModel.countDocuments(),
    LeadModel.countDocuments({ status: "converted" }),
    LeadModel.countDocuments(dateMatch(range.from, range.to).createdAt ? { registeredAt: { $gte: range.from, $lte: range.to } } : {}),
  ]);
  const rangeDays = Math.max(1, range.dayBuckets.length);
  const leadVelocityPerDay = Math.round((leadsInRange / rangeDays) * 10) / 10;
  const waitlistConversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

  const siteSettings = await getSiteSettings();
  const pixelStatus = {
    google: Boolean(siteSettings.googlePixelId),
    meta: Boolean(siteSettings.metaPixelId),
  };

  // ---------- Capa 5: Inventario ----------
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const recentOrdersForInventory = await OrderModel.find({
    createdAt: { $gte: thirtyDaysAgo },
    status: { $in: REVENUE_STATUSES },
  }).lean();
  const soldLast30ByProductSku = new Map<string, number>();
  for (const o of recentOrdersForInventory) {
    for (const item of o.items) {
      soldLast30ByProductSku.set(item.sku, (soldLast30ByProductSku.get(item.sku) ?? 0) + item.quantity);
    }
  }

  const products = await ProductModel.find().lean();
  const thresholdBySku: Record<string, number> = {
    "concentrado-1l": siteSettings.lowStockThresholdBottle1L ?? 20,
    squishable: siteSettings.lowStockThresholdSquishable ?? 20,
  };

  const inventoryRows = products.map((p) => {
    const soldLast30 = soldLast30ByProductSku.get(p.sku.toLowerCase()) ?? 0;
    const dailyRate = soldLast30 / 30;
    const runwayDays = dailyRate > 0 ? p.stock / dailyRate : null;
    const threshold = thresholdBySku[p.sku.toLowerCase()] ?? 10;
    return {
      id: String(p._id),
      name: p.name,
      sku: p.sku,
      stock: p.stock,
      soldLast30,
      runwayDays,
      isLow: p.stock < threshold,
      threshold,
    };
  });

  const lowestStock = [...inventoryRows].sort((a, b) => a.stock - b.stock).slice(0, 2);
  const lowStockAlerts = inventoryRows.filter((r) => r.isLow);

  function formatRunway(days: number | null) {
    if (days === null) return "sin ventas recientes";
    if (days < 1) return `${Math.max(1, Math.round(days * 24))} horas`;
    return `${Math.round(days)} días`;
  }

  return json({
    range: { key: range.key, from: range.from.toISOString(), to: range.to.toISOString() },
    audience,
    kpis: {
      grossRevenue: Math.round(grossRevenue),
      netRevenue: Math.round(netRevenue),
      discountGiven: Math.round(discountGiven),
      netRevenueChangePct: percentChange(netRevenue, prevNetRevenue),
      orderCount,
      orderCountChangePct: percentChange(orderCount, prevOrderCount),
      aov: Math.round(aov),
      aovChangePct: percentChange(aov, prevAov),
      waitlistConversionRate,
      mrr: Math.round(mrr),
    },
    revenueSparkline,
    orderStatusCounts,
    bundleMatrix,
    funnel,
    adoption: { oneTime: oneTimeCount, subscription: subscriptionCount },
    subscriptionHealth: {
      ...subStatusCounts,
      total: allSubs.length,
      churnRate,
      retentionRate,
      frequencyDistribution: Array.from(frequencyDistribution.entries()).map(([frequency, count]) => ({
        frequency,
        count,
      })),
    },
    loyalty: {
      funnel: loyaltyFunnel,
      unlocked: loyaltyUnlocked,
      avgLtv: Math.round(avgLtv),
    },
    acquisition: {
      attributionBreakdown,
      totalLeads,
      convertedLeads,
      leadVelocityPerDay,
      pixelStatus,
    },
    inventory: {
      rows: inventoryRows,
      lowestStock: lowestStock.map((r) => ({ ...r, runwayLabel: formatRunway(r.runwayDays) })),
      alerts: lowStockAlerts.map((r) => ({ ...r, runwayLabel: formatRunway(r.runwayDays) })),
    },
  });
}

const BRAND_COLORS = ["#B5D334", "#7A9330", "#3E531D", "#181C14", "#8FD3F4"];

const RANGE_OPTIONS = [
  { key: "today", label: "Hoy" },
  { key: "7d", label: "Últimos 7 días" },
  { key: "month", label: "Mes actual" },
  { key: "quarter", label: "Trimestre actual" },
] as const;

const AUDIENCE_OPTIONS = [
  { key: "all", label: "Todos" },
  { key: "new", label: "Nuevos" },
  { key: "recurring", label: "Recurrentes" },
  { key: "subscribers", label: "Suscriptores" },
] as const;

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-carbon/10 bg-white p-5 ${className}`}>{children}</div>
  );
}

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const positive = pct >= 0;
  return (
    <span
      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${
        positive ? "bg-lima/20 text-bosque" : "bg-red-100 text-red-600"
      }`}
    >
      {positive ? "+" : ""}
      {pct}%
    </span>
  );
}

export default function AdminDashboard() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-black text-carbon">Dashboard</h1>
        <p className="mt-1 text-sm text-carbon/60">Inteligencia de negocio en tiempo real.</p>
      </div>

      {/* Controles globales */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setParam("range", opt.key)}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold ${
                data.range.key === opt.key
                  ? "bg-carbon text-hueso"
                  : "border border-carbon/15 text-carbon hover:border-carbon/30"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {AUDIENCE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setParam("audience", opt.key)}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold ${
                data.audience === opt.key
                  ? "bg-lima text-carbon"
                  : "border border-carbon/15 text-carbon hover:border-carbon/30"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <a
            href="/admin/exports/sales"
            className="min-h-11 rounded-full border border-carbon/15 px-4 py-2.5 text-sm font-semibold text-carbon hover:border-carbon/30"
          >
            Exportar ventas
          </a>
          <a
            href="/admin/exports/subscribers"
            className="min-h-11 rounded-full border border-carbon/15 px-4 py-2.5 text-sm font-semibold text-carbon hover:border-carbon/30"
          >
            Exportar suscriptores
          </a>
          <a
            href="/admin/leads/csv"
            className="min-h-11 rounded-full border border-carbon/15 px-4 py-2.5 text-sm font-semibold text-carbon hover:border-carbon/30"
          >
            Exportar leads
          </a>
        </div>
      </div>

      {/* ===== Capa 1: Pulso operativo ===== */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Ingresos netos</p>
          <p className="mt-2 font-display text-2xl font-black text-carbon">
            ${data.kpis.netRevenue.toLocaleString("es-MX")}
            <ChangeBadge pct={data.kpis.netRevenueChangePct} />
          </p>
          <p className="text-xs text-carbon/50">
            Brutos ${data.kpis.grossRevenue.toLocaleString("es-MX")} · Descuentos $
            {data.kpis.discountGiven.toLocaleString("es-MX")}
          </p>
          <div className="mt-2 h-12">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.revenueSparkline}>
                <Area type="monotone" dataKey="revenue" stroke="#7A9330" fill="#B5D334" fillOpacity={0.4} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Conversión waitlist</p>
          <p className="mt-2 font-display text-2xl font-black text-carbon">
            {data.kpis.waitlistConversionRate}%
          </p>
          <p className="text-xs text-carbon/50">
            {data.acquisition.convertedLeads} de {data.acquisition.totalLeads} leads convertidos
          </p>
        </Card>

        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Ticket promedio</p>
          <p className="mt-2 font-display text-2xl font-black text-carbon">
            ${data.kpis.aov.toLocaleString("es-MX")}
            <ChangeBadge pct={data.kpis.aovChangePct} />
          </p>
          <p className="text-xs text-carbon/50">
            {data.kpis.orderCount} pedidos
            <ChangeBadge pct={data.kpis.orderCountChangePct} />
          </p>
        </Card>

        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Pedidos por estado</p>
          <div className="mt-2 flex flex-col gap-1 text-sm">
            <div className="flex justify-between"><span>Nuevos</span><span className="font-bold">{data.orderStatusCounts.paid}</span></div>
            <div className="flex justify-between"><span>Preparación</span><span className="font-bold">{data.orderStatusCounts.processing}</span></div>
            <div className="flex justify-between"><span>Tránsito</span><span className="font-bold">{data.orderStatusCounts.shipped}</span></div>
            <div className="flex justify-between"><span>Completados</span><span className="font-bold">{data.orderStatusCounts.delivered}</span></div>
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-bosque to-carbon text-hueso">
          <p className="text-xs font-semibold uppercase tracking-wide text-hueso/60">MRR (suscripciones)</p>
          <p className="mt-2 font-display text-2xl font-black">
            ${data.kpis.mrr.toLocaleString("es-MX")}
          </p>
          <p className="text-xs text-hueso/60">Ingreso recurrente mensual proyectado</p>
        </Card>
      </div>

      {/* ===== Capa 2: Paquetes y embudo ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Bundles vs. SKUs sueltos</h2>
          {data.bundleMatrix.length === 0 ? (
            <p className="mt-3 text-sm text-carbon/60">Sin ventas en este periodo.</p>
          ) : (
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.bundleMatrix} layout="vertical" margin={{ left: 24 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `$${v}`} />
                  <Bar dataKey="revenue" fill="#7A9330" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Embudo de conversión</h2>
          <div className="mt-4 flex flex-col gap-2">
            {data.funnel.map((f, i) => {
              const max = data.funnel[0]?.count || 1;
              const width = Math.max(6, Math.round((f.count / max) * 100));
              return (
                <div key={f.step}>
                  <div className="flex justify-between text-xs text-carbon/60">
                    <span>{f.step}</span>
                    <span className="font-semibold text-carbon">{f.count}</span>
                  </div>
                  <div className="mt-1 h-3 w-full rounded-full bg-carbon/5">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${width}%`, background: BRAND_COLORS[i % BRAND_COLORS.length] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-carbon/40">
            Sesiones/vistas/carrito medidos con tracking propio (no depende de que el pixel de
            Meta/Google esté configurado).
          </p>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="font-display text-lg font-bold text-carbon">Compra única vs. suscripción</h2>
          <div className="mt-4 flex items-center gap-8">
            <div className="h-40 w-40 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: "Única", value: data.adoption.oneTime },
                      { name: "Suscripción", value: data.adoption.subscription },
                    ]}
                    dataKey="value"
                    innerRadius={35}
                    outerRadius={70}
                  >
                    <Cell fill="#3E531D" />
                    <Cell fill="#B5D334" />
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="text-sm">
              <p>
                <span className="inline-block h-2 w-2 rounded-full bg-bosque" /> Compra única:{" "}
                <strong>{data.adoption.oneTime}</strong>
              </p>
              <p className="mt-1">
                <span className="inline-block h-2 w-2 rounded-full bg-lima" /> Suscripción:{" "}
                <strong>{data.adoption.subscription}</strong>
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* ===== Capa 3: Suscripciones y lealtad ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Salud de suscripciones</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-carbon/50">Retención activa</p>
              <p className="font-display text-xl font-black text-bosque">{data.subscriptionHealth.retentionRate}%</p>
            </div>
            <div>
              <p className="text-carbon/50">Churn</p>
              <p className="font-display text-xl font-black text-red-600">{data.subscriptionHealth.churnRate}%</p>
            </div>
          </div>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-carbon/50">
            Distribución por frecuencia (activas)
          </p>
          <div className="mt-2 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.subscriptionHealth.frequencyDistribution}>
                <XAxis dataKey="frequency" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#B5D334" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Camino a la 5ª compra</h2>
          <div className="mt-4 flex flex-col gap-2">
            {data.loyalty.funnel.map((f) => (
              <div key={f.step} className="flex items-center justify-between text-sm">
                <span className="text-carbon/70">{f.step}</span>
                <span className="font-bold text-carbon">{f.count} clientes</span>
              </div>
            ))}
            <div className="mt-2 flex items-center justify-between rounded-xl bg-lima/10 px-3 py-2 text-sm">
              <span className="font-semibold text-bosque">Con 10% permanente desbloqueado</span>
              <span className="font-bold text-bosque">{data.loyalty.unlocked}</span>
            </div>
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-carbon/50">LTV promedio</p>
          <p className="font-display text-xl font-black text-carbon">
            ${data.loyalty.avgLtv.toLocaleString("es-MX")} MXN
          </p>
        </Card>
      </div>

      {/* ===== Capa 4: Adquisición ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Atribución de ventas por canal</h2>
          {data.acquisition.attributionBreakdown.length === 0 ? (
            <p className="mt-3 text-sm text-carbon/60">Sin pedidos atribuidos en este periodo.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {data.acquisition.attributionBreakdown.map((a) => (
                <li key={a.source} className="flex items-center justify-between text-sm">
                  <span className="capitalize text-carbon/70">{a.source.replace("_", " ")}</span>
                  <span className="font-semibold text-carbon">
                    ${a.revenue.toLocaleString("es-MX")} · {a.orders} pedidos
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Preventa y píxeles</h2>
          <p className="mt-2 text-sm text-carbon/70">
            {data.acquisition.leadVelocityPerDay} correos/día en este periodo.
          </p>
          <div className="mt-4 flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${data.acquisition.pixelStatus.google ? "bg-lima" : "bg-carbon/20"}`} />
              Google configurado
            </div>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${data.acquisition.pixelStatus.meta ? "bg-lima" : "bg-carbon/20"}`} />
              Meta configurado
            </div>
          </div>
          <p className="mt-3 text-xs text-carbon/40">
            Esto confirma que el ID está guardado en Configuración, no que Meta/Google ya validó el
            disparo del evento — para eso hay que revisar el Administrador de eventos de cada
            plataforma.
          </p>
        </Card>
      </div>

      {/* ===== Capa 5: Inventario ===== */}
      <Card>
        <h2 className="font-display text-lg font-bold text-carbon">Inventario y reorden</h2>

        {data.inventory.alerts.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {data.inventory.alerts.map((a) => (
              <div key={a.id} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <strong>{a.name}</strong>: quedan {a.stock} unidades (umbral {a.threshold}). Al ritmo
                actual se agota en {a.runwayLabel}.
              </div>
            ))}
          </div>
        )}

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-carbon/50">
          Productos con menos inventario
        </p>
        <div className="mt-2 flex flex-col gap-2">
          {data.inventory.lowestStock.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl border border-carbon/10 px-4 py-3 text-sm">
              <div>
                <p className="font-semibold text-carbon">{p.name}</p>
                <p className="text-carbon/50">{p.soldLast30} vendidas en 30 días</p>
              </div>
              <div className="text-right">
                <p className="font-display text-lg font-black text-carbon">{p.stock}</p>
                <p className="text-xs text-carbon/50">se agota en {p.runwayLabel}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
