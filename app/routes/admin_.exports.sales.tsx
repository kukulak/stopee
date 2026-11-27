import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "~/lib/session.server";
import { connectDB } from "~/lib/db.server";
import { csvCell } from "~/lib/csv";
import { OrderModel } from "~/models/order.server";
import { REGIMENES_FISCALES, USOS_CFDI, ivaBreakdown, orderNumber } from "~/lib/fiscal";
import { parseCutoff, pendingInvoiceFilter } from "~/lib/invoiceQueue.server";

const csvEscape = csvCell;

/** Fecha y hora de México (no UTC), que es como se ve el día de una venta en la práctica. */
const mexicoDateTime = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "America/Mexico_City" });
const mexicoDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

/**
 * CSV de lo que se vende.
 *
 * - `?factura=1`: la lista de trabajo de quien factura. SOLO los pedidos que pidieron factura y todavía no
 *   se marcan como emitidas (sin cancelados ni reembolsados), con únicamente lo que hace falta para emitirlas.
 *   `&hasta=<fecha ISO>` fija el corte para que coincida con lo que se marca después como facturado.
 * - Sin parámetros: todas las ventas, con las columnas de factura al final.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();

  const url = new URL(request.url);
  if (url.searchParams.get("factura") === "1") return invoiceQueueCsv(parseCutoff(url.searchParams.get("hasta")));

  const orders = await OrderModel.find({}).sort({ createdAt: -1 }).lean();

  const header = [
    "fecha",
    "pedido",
    "email",
    "items",
    "tipo",
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
      "Content-Disposition": `attachment; filename="ventas-stopee.csv"`,
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
