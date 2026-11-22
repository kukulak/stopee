import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { requireAdmin } from "~/lib/session.server";
import { connectDB } from "~/lib/db.server";
import { LeadModel } from "~/models/lead.server";
import { csvCell } from "~/lib/csv";

/**
 * Resource route (sin export default): bajo Remix single-fetch, una ruta
 * con componente UI siempre se renderiza para GETs normales aunque su
 * loader retorne un Response crudo, así que el CSV necesita vivir en su
 * propia ruta. El guion bajo en el nombre del archivo (`admin.leads_.csv`)
 * la saca de la anidación bajo `admin.leads.tsx`, así que el guard de
 * `/admin` se repite aquí explícitamente.
 */
function dateRangeQuery(url: URL): Record<string, unknown> {
  const parse = (raw: string | null) => {
    const date = raw ? new Date(raw) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };
  const from = parse(url.searchParams.get("from"));
  const to = parse(url.searchParams.get("to"));
  if (!from && !to) return {};
  return {
    registeredAt: {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: new Date(to.getTime() + 86399999) } : {}),
    },
  };
}

type ExportableLead = {
  email: string;
  registeredAt?: Date | null;
  source?: string | null;
  discountCodeAssigned?: string | null;
  status?: string | null;
  contactedAt?: Date | null;
};

function buildCsvResponse(leads: ExportableLead[], filename: string) {
  const escape = csvCell;
  const header = ["email", "registrado", "canal", "codigo_descuento", "compro", "contactado"].join(",");
  const lines = leads.map((l) =>
    [
      escape(l.email),
      escape(new Date(l.registeredAt ?? new Date()).toISOString()),
      escape(l.source ?? "direct"),
      escape(l.discountCodeAssigned ?? ""),
      escape(l.status === "converted" ? "si" : "no"),
      escape(l.contactedAt ? new Date(l.contactedAt).toISOString() : ""),
    ].join(","),
  );
  return new Response([header, ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/** Exporta todos los correos del rango, sin cambiar nada (descarga segura de repetir). */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const leads = await LeadModel.find(dateRangeQuery(new URL(request.url))).sort({ registeredAt: -1 }).lean();
  return buildCsvResponse(leads, "lista-de-espera-stopee.csv");
}

/**
 * Exporta solo los correos sin contactar y los marca como contactados.
 * Es POST (no GET) porque cambia datos: un prefetch o reintento del navegador
 * no debe marcar correos por accidente.
 */
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const query = { ...dateRangeQuery(new URL(request.url)), contactedAt: { $exists: false } };
  const leads = await LeadModel.find(query).sort({ registeredAt: -1 }).lean();
  if (leads.length > 0) {
    await LeadModel.updateMany(
      { _id: { $in: leads.map((l) => l._id) } },
      { contactedAt: new Date() },
    );
  }
  return buildCsvResponse(
    leads.map((l) => ({ ...l, contactedAt: new Date() })),
    "lista-de-espera-nuevos-stopee.csv",
  );
}
