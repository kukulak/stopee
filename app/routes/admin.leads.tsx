import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import { connectDB } from "~/lib/db.server";
import { LeadModel } from "~/models/lead.server";

export const meta: MetaFunction = () => [{ title: "Lista de espera — Admin STOPee" }];

const SOURCE_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google: "Google",
  blog: "Blog",
  direct: "Directo",
  other: "Otro",
};

export async function loader({ request }: LoaderFunctionArgs) {
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

  return json({
    leads: leads.map((l) => ({
      id: String(l._id),
      email: l.email,
      registeredAt: l.registeredAt,
      discountCodeAssigned: l.discountCodeAssigned,
      status: l.status,
      source: l.source,
    })),
    from: from ?? "",
    to: to ?? "",
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await connectDB();
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    await LeadModel.findByIdAndDelete(String(formData.get("id")));
    return json({ ok: true });
  }

  if (intent === "delete-selected") {
    const ids = formData.getAll("ids") as string[];
    if (ids.length > 0) {
      await LeadModel.deleteMany({ _id: { $in: ids } });
    }
    return json({ ok: true });
  }

  return json({ ok: false, error: "Acción no reconocida." }, { status: 400 });
}

export default function AdminLeads() {
  const { leads, from, to } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-black text-carbon">Lista de espera</h1>
          <p className="mt-1 text-sm text-carbon/60">
            {leads.length} {leads.length === 1 ? "correo registrado" : "correos registrados"}.
          </p>
        </div>
        <a
          href={`/admin/leads/csv?${searchParams.toString()}`}
          className="min-h-11 rounded-full border border-carbon/15 px-5 py-2.5 text-sm font-semibold text-carbon hover:border-carbon/30"
        >
          Exportar CSV ↓
        </a>
      </div>

      <Form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="from" className="text-xs font-semibold text-carbon/60">
            Desde
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from}
            className="mt-1 min-h-11 rounded-xl border border-carbon/15 px-3 text-sm focus:border-oliva focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="to" className="text-xs font-semibold text-carbon/60">
            Hasta
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to}
            className="mt-1 min-h-11 rounded-xl border border-carbon/15 px-3 text-sm focus:border-oliva focus:outline-none"
          />
        </div>
        <button type="submit" className="min-h-11 rounded-full bg-carbon px-5 text-sm font-semibold text-hueso">
          Filtrar
        </button>
        {(from || to) && (
          <a href="/admin/leads" className="flex min-h-11 items-center text-sm font-semibold text-carbon/60 hover:underline">
            Limpiar filtro
          </a>
        )}
      </Form>

      {leads.length === 0 ? (
        <p className="mt-8 text-sm text-carbon/60">
          No hay correos registrados {from || to ? "en este rango de fechas" : "en la lista de espera"}.
        </p>
      ) : (
        <Form
          method="post"
          onSubmit={(e) => {
            if (!confirm("¿Eliminar los correos seleccionados?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="delete-selected" />
          <div className="mt-6 overflow-x-auto rounded-3xl border border-carbon/10 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-carbon/10 text-xs font-semibold uppercase tracking-wide text-carbon/50">
                <tr>
                  <th className="px-5 py-3" />
                  <th className="px-5 py-3">Correo</th>
                  <th className="px-5 py-3">Registrado</th>
                  <th className="px-5 py-3">Canal</th>
                  <th className="px-5 py-3">Código</th>
                  <th className="px-5 py-3">Estado</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <LeadRow key={lead.id} lead={lead} />
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="submit"
            className="mt-4 min-h-11 rounded-full border border-carbon/15 px-5 text-sm font-semibold text-red-600 hover:border-red-300"
          >
            Eliminar seleccionados
          </button>
        </Form>
      )}
    </div>
  );
}

type Lead = ReturnType<typeof useLoaderData<typeof loader>>["leads"][number];

function LeadRow({ lead }: { lead: Lead }) {
  const fetcher = useFetcher();
  const isDeleting = fetcher.state !== "idle";

  return (
    <tr className={`border-b border-carbon/5 last:border-0 ${isDeleting ? "opacity-40" : ""}`}>
      <td className="px-5 py-3">
        <input type="checkbox" name="ids" value={lead.id} className="h-5 w-5 accent-lima" />
      </td>
      <td className="px-5 py-3 font-semibold text-carbon">{lead.email}</td>
      <td className="px-5 py-3 text-carbon/60">
        {new Date(lead.registeredAt).toLocaleDateString("es-MX", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </td>
      <td className="px-5 py-3 text-carbon/60">{SOURCE_LABELS[lead.source] ?? lead.source}</td>
      <td className="px-5 py-3 text-carbon/60">{lead.discountCodeAssigned}</td>
      <td className="px-5 py-3">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            lead.status === "converted" ? "bg-lima/20 text-bosque" : "bg-carbon/10 text-carbon/60"
          }`}
        >
          {lead.status === "converted" ? "Convertido" : "Pendiente"}
        </span>
      </td>
      <td className="px-5 py-3 text-right">
        <button
          type="button"
          disabled={isDeleting}
          onClick={() => {
            if (confirm(`¿Eliminar ${lead.email} de la lista?`)) {
              fetcher.submit({ intent: "delete", id: lead.id }, { method: "post" });
            }
          }}
          className="min-h-11 rounded-full border border-carbon/15 px-3 text-xs font-semibold text-red-600 hover:border-red-300 disabled:opacity-60"
        >
          Eliminar
        </button>
      </td>
    </tr>
  );
}
