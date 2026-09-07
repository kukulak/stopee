import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireAdmin } from "~/lib/session.server";
import { connectDB } from "~/lib/db.server";
import { LeadModel } from "~/models/lead.server";

/**
 * Resource route (sin export default): bajo Remix single-fetch, una ruta
 * con componente UI siempre se renderiza para GETs normales aunque su
 * loader retorne un Response crudo, así que el CSV necesita vivir en su
 * propia ruta. El guion bajo en el nombre del archivo (`admin.leads_.csv`)
 * la saca de la anidación bajo `admin.leads.tsx`, así que el guard de
 * `/admin` se repite aquí explícitamente.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const query: Record<string, unknown> = {};
  if (from || to) {
    query.registeredAt = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(new Date(to).getTime() + 86399999) } : {}),
    };
  }

  const leads = await LeadModel.find(query).sort({ registeredAt: -1 }).lean();

  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const header = ["email", "registrado", "canal", "codigo_descuento", "estado"].join(",");
  const lines = leads.map((l) =>
    [
      escape(l.email),
      escape(new Date(l.registeredAt ?? new Date()).toISOString()),
      escape(l.source ?? "direct"),
      escape(l.discountCodeAssigned ?? ""),
      escape(l.status ?? "pending"),
    ].join(","),
  );
  const csv = [header, ...lines].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lista-de-espera-stopee.csv"`,
    },
  });
}
