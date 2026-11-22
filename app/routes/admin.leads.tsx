import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { useRef } from "react";
import { connectDB } from "~/lib/db.server";
import { LeadModel } from "~/models/lead.server";
import { DownloadIcon } from "~/components/ui/Icons";
import { requireAdmin } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Lista de espera — Admin STOPee" }];

const SOURCE_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google: "Google",
  blog: "Blog",
  direct: "Directo",
  other: "Otro",
};

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

  return data({
    leads: leads.map((l) => ({
      id: String(l._id),
      email: l.email,
      registeredAt: l.registeredAt,
      discountCodeAssigned: l.discountCodeAssigned,
      status: l.status,
      contactedAt: l.contactedAt ?? null,
      source: l.source,
    })),
    from: from ?? "",
    to: to ?? "",
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    await LeadModel.findByIdAndDelete(String(formData.get("id")));
    return data({ ok: true });
  }

  if (intent === "mark-contacted" || intent === "mark-uncontacted") {
    const ids = formData.getAll("ids") as string[];
    if (ids.length > 0) {
      await LeadModel.updateMany(
        { _id: { $in: ids } },
        intent === "mark-contacted" ? { contactedAt: new Date() } : { $unset: { contactedAt: 1 } },
      );
    }
    return data({ ok: true });
  }

  if (intent === "delete-selected") {
    const ids = formData.getAll("ids") as string[];
    if (ids.length > 0) {
      await LeadModel.deleteMany({ _id: { $in: ids } });
    }
    return data({ ok: true });
  }

  return data({ ok: false, error: "Acción no reconocida." }, { status: 400 });
}

export default function AdminLeads() {
  const { leads, from, to } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const listFormRef = useRef<HTMLFormElement>(null);

  const withoutContact = leads.filter((l) => !l.contactedAt).length;
  const purchased = leads.filter((l) => l.status === "converted").length;
  const query = searchParams.toString();

  return (
    <div className="min-w-0">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-black text-carbon sm:text-3xl">Lista de espera</h1>
        <p className="mt-1 text-sm text-carbon/60">
          {leads.length} {leads.length === 1 ? "correo registrado" : "correos registrados"}
          {leads.length > 0 && ` · ${withoutContact} sin contactar · ${purchased} ya compraron`}.
        </p>
      </div>

      <div className="mt-5 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Form
            method="post"
            action={`/admin/leads/csv?${query}`}
            reloadDocument
            onSubmit={() => {
              // La descarga no recarga la página: se vuelve a consultar para que los correos exportados pasen a "Contactado".
              setTimeout(() => revalidator.revalidate(), 1200);
            }}
          >
            <button
              type="submit"
              disabled={withoutContact === 0}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-lima px-5 py-2.5 text-sm font-bold text-carbon hover:bg-limaNeon disabled:cursor-not-allowed disabled:opacity-50"
            >
              <DownloadIcon className="h-4 w-4" />
              Exportar sin contactar ({withoutContact})
            </button>
          </Form>
          <a
            href={`/admin/leads/csv?${query}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-carbon/15 px-5 py-2.5 text-sm font-semibold text-carbon hover:border-carbon/30"
          >
            Exportar todos
          </a>
        </div>
        <p className="mt-3 text-xs text-carbon/60">
          &ldquo;Exportar sin contactar&rdquo; descarga solo los correos a los que aún no les escribes y los marca como
          contactados. &ldquo;Exportar todos&rdquo; descarga la lista completa sin cambiar nada.
        </p>
      </div>

      <Form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 sm:flex-none">
          <label htmlFor="from" className="text-xs font-semibold text-carbon/60">
            Desde
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from}
            className="mt-1 box-border min-h-11 w-full rounded-xl border border-carbon/15 px-3 text-sm focus:border-oliva focus:outline-none"
          />
        </div>
        <div className="min-w-0 flex-1 sm:flex-none">
          <label htmlFor="to" className="text-xs font-semibold text-carbon/60">
            Hasta
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to}
            className="mt-1 box-border min-h-11 w-full rounded-xl border border-carbon/15 px-3 text-sm focus:border-oliva focus:outline-none"
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
        <Form method="post" ref={listFormRef}>
          <label className="mt-6 flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold text-carbon">
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-lima"
              onChange={(e) => {
                listFormRef.current
                  ?.querySelectorAll<HTMLInputElement>('input[name="ids"]')
                  .forEach((box) => {
                    box.checked = e.target.checked;
                  });
              }}
            />
            Seleccionar todos
          </label>
          <div className="mt-2 rounded-3xl border border-carbon/10 bg-white md:overflow-x-auto">
            <table className="block w-full text-left text-sm md:table">
              <thead className="hidden border-b border-carbon/10 text-xs font-semibold uppercase tracking-wide text-carbon/50 md:table-header-group">
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
              <tbody className="block md:table-row-group">
                {leads.map((lead) => (
                  <LeadRow key={lead.id} lead={lead} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="submit"
              name="intent"
              value="mark-contacted"
              className="min-h-11 rounded-full border border-carbon/15 px-5 text-sm font-semibold text-carbon hover:border-carbon/30"
            >
              Marcar como contactados
            </button>
            <button
              type="submit"
              name="intent"
              value="mark-uncontacted"
              className="min-h-11 rounded-full border border-carbon/15 px-5 text-sm font-semibold text-carbon hover:border-carbon/30"
            >
              Marcar sin contactar
            </button>
            <button
              type="submit"
              name="intent"
              value="delete-selected"
              onClick={(e) => {
                if (!confirm("¿Eliminar los correos seleccionados?")) e.preventDefault();
              }}
              className="min-h-11 rounded-full border border-carbon/15 px-5 text-sm font-semibold text-red-600 hover:border-red-300"
            >
              Eliminar seleccionados
            </button>
          </div>
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
    <tr
      className={`grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 border-b border-carbon/5 px-3 py-3 last:border-0 md:table-row md:p-0 ${isDeleting ? "opacity-40" : ""}`}
    >
      <td className="row-span-6 flex min-h-11 items-start justify-center pt-3 md:table-cell md:px-5 md:py-3 md:pt-3">
        <input type="checkbox" name="ids" value={lead.id} aria-label={`Seleccionar ${lead.email}`} className="h-5 w-5 shrink-0 accent-lima" />
      </td>
      <td className="col-start-2 break-all font-semibold text-carbon md:table-cell md:break-words md:px-5 md:py-3">{lead.email}</td>
      <td className="col-start-2 text-xs text-carbon/60 before:mr-1 before:content-['Registrado:'] md:table-cell md:px-5 md:py-3 md:text-sm md:before:content-none">
        {new Date(lead.registeredAt).toLocaleDateString("es-MX", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </td>
      <td className="col-start-2 text-xs text-carbon/60 before:mr-1 before:content-['Canal:'] md:table-cell md:px-5 md:py-3 md:text-sm md:before:content-none">{SOURCE_LABELS[lead.source] ?? lead.source}</td>
      <td className="col-start-2 break-all text-xs text-carbon/60 before:mr-1 before:content-['Código:'] md:table-cell md:break-words md:px-5 md:py-3 md:text-sm md:before:content-none">{lead.discountCodeAssigned}</td>
      <td className="col-start-2 md:table-cell md:px-5 md:py-3">
        <div className="flex flex-wrap gap-1.5">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              lead.status === "converted" ? "bg-lima/20 text-bosque" : "bg-carbon/10 text-carbon/60"
            }`}
          >
            {lead.status === "converted" ? "Compró" : "Sin compra"}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              lead.contactedAt ? "border border-carbon/15 text-carbon/60" : "bg-civicBlue/10 text-civicBlue"
            }`}
          >
            {lead.contactedAt
              ? `Contactado ${new Date(lead.contactedAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}`
              : "Sin contactar"}
          </span>
        </div>
      </td>
      <td className="col-start-2 md:table-cell md:px-5 md:py-3 md:text-right">
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
