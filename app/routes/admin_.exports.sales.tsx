import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "~/lib/session.server";
import { connectDB } from "~/lib/db.server";
import { csvCell } from "~/lib/csv";
import { OrderModel } from "~/models/order.server";
import { orderNumber } from "~/lib/fiscal";

const csvEscape = csvCell;

/**
 * Ventas en CSV. Con `?factura=1` solo salen los pedidos que pidieron factura (lo que necesita quien las emite).
 * Los datos fiscales van en columnas aparte, con la clave del SAT (601, G03…) tal como se captura en el sistema de facturación.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();

  const onlyInvoices = new URL(request.url).searchParams.get("factura") === "1";
  const orders = await OrderModel.find(onlyInvoices ? { requiresInvoice: true } : {})
    .sort({ createdAt: -1 })
    .lean();

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
      "Content-Disposition": `attachment; filename="${onlyInvoices ? "facturas-stopee" : "ventas-stopee"}.csv"`,
    },
  });
}
