import type { MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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

export async function loader() {
  await connectDB();
  const leads = await LeadModel.find().sort({ registeredAt: -1 }).lean();

  return json({
    leads: leads.map((l) => ({
      id: String(l._id),
      email: l.email,
      registeredAt: l.registeredAt,
      discountCodeAssigned: l.discountCodeAssigned,
      status: l.status,
      source: l.source,
    })),
  });
}

export default function AdminLeads() {
  const { leads } = useLoaderData<typeof loader>();

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
          href="/admin/leads/csv"
          className="min-h-11 rounded-full border border-carbon/15 px-5 py-2.5 text-sm font-semibold text-carbon hover:border-carbon/30"
        >
          Exportar CSV ↓
        </a>
      </div>

      {leads.length === 0 ? (
        <p className="mt-8 text-sm text-carbon/60">
          Todavía no hay correos registrados en la lista de espera.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-3xl border border-carbon/10 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-carbon/10 text-xs font-semibold uppercase tracking-wide text-carbon/50">
              <tr>
                <th className="px-5 py-3">Correo</th>
                <th className="px-5 py-3">Registrado</th>
                <th className="px-5 py-3">Canal</th>
                <th className="px-5 py-3">Código</th>
                <th className="px-5 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b border-carbon/5 last:border-0">
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
                        lead.status === "converted"
                          ? "bg-lima/20 text-bosque"
                          : "bg-carbon/10 text-carbon/60"
                      }`}
                    >
                      {lead.status === "converted" ? "Convertido" : "Pendiente"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
