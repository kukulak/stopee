import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { requireAdmin } from "~/lib/session.server";
import { connectDB } from "~/lib/db.server";
import { csvCell } from "~/lib/csv";
import { OrderModel } from "~/models/order.server";
import { REGIMENES_FISCALES, USOS_CFDI, ivaBreakdown, orderNumber } from "~/lib/fiscal";
import { parseCutoff, pendingInvoiceFilter } from "~/lib/invoiceQueue.server";
import { DEFAULT_SALES_EXPORT, isDay, type SalesExportOptions } from "~/lib/salesExport";

const csvEscape = csvCell;
const PAYMENT_LABELS: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", other: "Otro" };

/** Fecha y hora de México (no UTC), que es como se ve el día de una venta en la práctica. */
const mexicoDateTime = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "America/Mexico_City" });
const mexicoDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

/**
 * CSV de lo que se vende.
 *
 * - `?factura=1`: la lista de trabajo de quien factura. SOLO los pedidos que pidieron factura y todavía no
 *   se marcan como emitidas (sin cancelados ni reembolsados), con únicamente lo que hace falta para emitirlas.
 *   `&hasta=<fecha ISO>` fija el corte para que coincida con lo que se marca después como facturado.
 * - Lo demás: las ventas del periodo y con las opciones que se pidan (ver `SalesExportOptions`): `from` y `to`
 *   (día, hora de México), `estado` (validas | todas), `facturacion` (todas | sin | con) y `manuales` (1 | 0).
 *   Sin opciones, trae las ventas válidas de todo el historial. Con `resumen=1` no baja el archivo: dice cuántos
 *   pedidos y cuánto dinero hay con esos filtros, para ver el tamaño antes de descargar.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();

  const url = new URL(request.url);
  if (url.searchParams.get("factura") === "1") return invoiceQueueCsv(parseCutoff(url.searchParams.get("hasta")));

  const parsed = parseSalesOptions(url.searchParams);
  if (!parsed.ok) return data({ error: parsed.error }, { status: 400 });
  const { options } = parsed;

  if (url.searchParams.get("resumen") === "1") return data(await salesSummary(options));

  const orders = await OrderModel.find(salesFilter(options, { withStatus: true })).sort({ createdAt: -1 }).lean();

  const header = [
    "fecha",
    "pedido",
    "email",
    "items",
    "tipo",
    "origen",
    "pago",
    "registrado_por",
    "estado",
    "bruto",
    "descuento",
    "neto",
    "guia",
    "utm_source",
    "factura",
    "facturada",
    "rfc",
    "razon_social",
    "regimen_fiscal",
    "cp_fiscal",
    "uso_cfdi",
  ].join(",");

  const lines = orders.map((o) => {
    const invoice = o.requiresInvoice ? o.billingInfo : undefined;
    return [
      csvEscape(new Date(o.createdAt as unknown as string).toISOString()),
      csvEscape(orderNumber(o._id)),
      csvEscape(o.email),
      csvEscape(o.items.map((i) => `${i.quantity}x ${i.name}`).join(" | ")),
      csvEscape(o.type),
      csvEscape(o.source === "manual" ? "Manual" : "Web"),
      csvEscape(PAYMENT_LABELS[o.paymentMethod ?? ""] ?? ""),
      csvEscape(o.createdByName ?? ""),
      csvEscape(o.status),
      String(o.totalAmount),
      String(o.discountAmount),
      String(o.netAmount),
      csvEscape(o.trackingNumber ?? ""),
      csvEscape(o.attribution?.utm_source ?? ""),
      // «factura» = el cliente la pidió; «facturada» = ya se emitió (solo tiene sentido si la pidió).
      o.requiresInvoice ? "Si" : "No",
      o.requiresInvoice ? (o.invoiceIssuedAt ? "Si" : "No") : "",
      csvEscape(invoice?.rfc ?? ""),
      csvEscape(invoice?.razonSocial ?? ""),
      csvEscape(invoice?.regimenFiscal ?? ""),
      csvEscape(invoice?.codigoPostalFiscal ?? ""),
      csvEscape(invoice?.usoCfdi ?? ""),
    ].join(",");
  });

  const csv = [header, ...lines].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${salesFileName(options)}"`,
    },
  });
}

const nameOf = (catalog: { code: string; label: string }[], code: string | null | undefined) =>
  catalog.find((o) => o.code === code)?.label ?? "";

/** Una fila por pedido por facturar; el total es lo que pagó el cliente (IVA incluido), con el desglose al lado. */
async function invoiceQueueCsv(until: Date | undefined) {
  const orders = await OrderModel.find(pendingInvoiceFilter(until)).sort({ createdAt: 1 }).lean();

  const header = [
    "pedido",
    "fecha",
    "email",
    "rfc",
    "razon_social",
    "regimen_clave",
    "regimen_nombre",
    "cp_fiscal",
    "uso_cfdi_clave",
    "uso_cfdi_nombre",
    "conceptos",
    "subtotal",
    "iva",
    "total",
  ].join(",");

  const lines = orders.map((o) => {
    const b = o.billingInfo;
    const { subtotal, iva, total } = ivaBreakdown(o.netAmount);
    return [
      csvEscape(orderNumber(o._id)),
      csvEscape(mexicoDateTime(new Date(o.createdAt as unknown as string))),
      csvEscape(o.email),
      csvEscape(b?.rfc ?? ""),
      csvEscape(b?.razonSocial ?? ""),
      csvEscape(b?.regimenFiscal ?? ""),
      csvEscape(nameOf(REGIMENES_FISCALES, b?.regimenFiscal)),
      csvEscape(b?.codigoPostalFiscal ?? ""),
      csvEscape(b?.usoCfdi ?? ""),
      csvEscape(nameOf(USOS_CFDI, b?.usoCfdi)),
      csvEscape(o.items.map((i) => `${i.quantity}x ${i.name}`).join(" | ")),
      subtotal.toFixed(2),
      iva.toFixed(2),
      total.toFixed(2),
    ].join(",");
  });

  return new Response([header, ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="facturas-por-emitir-${mexicoDate(until ?? new Date())}.csv"`,
    },
  });
}

function parseSalesOptions(params: URLSearchParams): { ok: true; options: SalesExportOptions } | { ok: false; error: string } {
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if ((from && !isDay(from)) || (to && !isDay(to))) return { ok: false, error: "La fecha no es válida. Usa el calendario." };
  if (from && to && from > to) return { ok: false, error: "La fecha de inicio es posterior a la final." };
  const estado = params.get("estado") === "todas" ? "todas" : "validas";
  const facturacionParam = params.get("facturacion");
  const facturacion = facturacionParam === "sin" || facturacionParam === "con" ? facturacionParam : DEFAULT_SALES_EXPORT.facturacion;
  const manuales = params.get("manuales") !== "0";
  return { ok: true, options: { from, to, estado, facturacion, manuales } };
}

/** Qué pedidos entran. Con `withStatus: false` no se filtra por estado (para contar aparte las canceladas y reembolsadas). */
function salesFilter(options: SalesExportOptions, { withStatus }: { withStatus: boolean }) {
  // Los días se leen en hora de México (UTC-6 todo el año): el 30 a las 9 pm sigue siendo del 30.
  const range = {
    ...(options.from ? { $gte: new Date(`${options.from}T00:00:00-06:00`) } : {}),
    ...(options.to ? { $lte: new Date(`${options.to}T23:59:59.999-06:00`) } : {}),
  };
  return {
    ...(Object.keys(range).length > 0 ? { createdAt: range } : {}),
    ...(withStatus && options.estado === "validas" ? { status: { $nin: ["cancelled", "refunded"] } } : {}),
    ...(options.facturacion === "sin" ? { requiresInvoice: { $ne: true } } : {}),
    ...(options.facturacion === "con" ? { requiresInvoice: true } : {}),
    ...(options.manuales ? {} : { source: { $ne: "manual" } }),
  };
}

/** Cuántos pedidos y cuánto dinero hay con estos filtros, separando lo válido de lo cancelado y reembolsado. */
async function salesSummary(options: SalesExportOptions) {
  const rows = await OrderModel.aggregate<{ _id: string; count: number; amount: number }>([
    { $match: salesFilter(options, { withStatus: false }) },
    { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$netAmount" } } },
  ]);
  const of = (status: string) => rows.find((r) => r._id === status);
  const cancelled = of("cancelled")?.count ?? 0;
  const refunded = of("refunded")?.count ?? 0;
  const valid = rows.filter((r) => r._id !== "cancelled" && r._id !== "refunded");
  const validCount = valid.reduce((sum, r) => sum + r.count, 0);
  return {
    count: options.estado === "todas" ? validCount + cancelled + refunded : validCount,
    validCount,
    revenue: Math.round(valid.reduce((sum, r) => sum + r.amount, 0) * 100) / 100,
    cancelled,
    refunded,
  };
}

function salesFileName(o: SalesExportOptions) {
  const period = o.from || o.to ? `${o.from || "inicio"}_a_${o.to || mexicoDate(new Date())}` : "todo";
  const extras = [o.facturacion === "sin" ? "sin-factura" : o.facturacion === "con" ? "con-factura" : "", o.estado === "todas" ? "con-canceladas" : "", o.manuales ? "" : "sin-manuales"].filter(Boolean);
  return `ventas-stopee_${[period, ...extras].join("_")}.csv`;
}
