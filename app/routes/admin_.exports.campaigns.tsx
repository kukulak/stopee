import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { requireAdmin } from "~/lib/session.server";
import { csvCell } from "~/lib/csv";
import { buildAudience } from "~/lib/campaignAudiences.server";
import { isAudience } from "~/lib/campaignAudiences";

const mexicoDate = (d: Date | null) => (d ? d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }) : "");

/**
 * Lista de personas para una campaña de correo. Solo salen quienes aceptaron recibir promociones (y confirmaron su
 * correo, si tienen cuenta). Con `resumen=1` no baja el archivo: dice cuántas personas salen y cuántas se dejaron
 * fuera por no haber aceptado.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const audience = url.searchParams.get("lista");
  if (!isAudience(audience)) return data({ error: "Elige una lista." }, { status: 400 });

  const { people, excluded } = await buildAudience(audience);
  if (url.searchParams.get("resumen") === "1") return data({ count: people.length, excluded });

  const header = ["email", "nombre", "origen", "registro", "pedidos", "ultima_compra", "total_gastado", "acepto_el"].join(",");
  const lines = people.map((p) =>
    [
      csvCell(p.email),
      csvCell(p.name),
      csvCell(p.origin),
      csvCell(mexicoDate(p.registeredAt)),
      String(p.orders),
      csvCell(mexicoDate(p.lastOrderAt)),
      p.totalSpent.toFixed(2),
      csvCell(mexicoDate(p.optInAt)),
    ].join(","),
  );
  return new Response([header, ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campana-${audience}_${mexicoDate(new Date())}.csv"`,
    },
  });
}
