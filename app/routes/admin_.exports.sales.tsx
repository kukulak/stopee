import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireAdmin } from "~/lib/session.server";
import { connectDB } from "~/lib/db.server";
import { csvCell } from "~/lib/csv";
import { OrderModel } from "~/models/order.server";

const csvEscape = csvCell;

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();

  const orders = await OrderModel.find().sort({ createdAt: -1 }).lean();

  const header = [
    "fecha",
    "email",
    "items",
    "tipo",
    "estado",
    "bruto",
    "descuento",
    "neto",
    "guia",
    "utm_source",
  ].join(",");

  const lines = orders.map((o) =>
    [
      csvEscape(new Date(o.createdAt as unknown as string).toISOString()),
      csvEscape(o.email),
      csvEscape(o.items.map((i) => `${i.quantity}x ${i.name}`).join(" | ")),
      csvEscape(o.type),
      csvEscape(o.status),
      String(o.totalAmount),
      String(o.discountAmount),
      String(o.netAmount),
      csvEscape(o.trackingNumber ?? ""),
      csvEscape(o.attribution?.utm_source ?? ""),
    ].join(","),
  );

  const csv = [header, ...lines].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ventas-stopee.csv"`,
    },
  });
}
