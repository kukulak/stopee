import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireAdmin } from "~/lib/session.server";
import { connectDB } from "~/lib/db.server";
import { csvCell } from "~/lib/csv";
import { SubscriptionModel } from "~/models/subscription.server";

const csvEscape = csvCell;

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();

  const subscriptions = await SubscriptionModel.find().populate("user").sort({ createdAt: -1 }).lean();

  const header = [
    "email",
    "frecuencia",
    "estado",
    "descuento",
    "proxima_entrega",
    "pedidos_generados",
  ].join(",");

  const lines = subscriptions.map((s) => {
    const user = s.user as unknown as { email?: string } | null;
    return [
      csvEscape(user?.email ?? ""),
      csvEscape(s.frequency),
      csvEscape(s.status),
      String(s.discountPercent ?? 0),
      csvEscape(s.nextDeliveryDate ? new Date(s.nextDeliveryDate as unknown as string).toISOString() : ""),
      String(s.totalOrdersGenerated ?? 0),
    ].join(",");
  });

  const csv = [header, ...lines].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="suscriptores-stopee.csv"`,
    },
  });
}
