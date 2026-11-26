import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, Form, Link, useLoaderData, useNavigation } from "react-router";
import { Types } from "mongoose";
import { connectDB } from "~/lib/db.server";
import { requireAdmin } from "~/lib/session.server";
import { logAudit } from "~/lib/logger.server";
import { UserModel } from "~/models/user.server";
import { AllyRequestModel } from "~/models/allyRequest.server";
import { REQUEST_STATUSES, REQUEST_STATUS_LABELS, whatsappUrl, type RequestStatus } from "~/lib/refillPoints";

export const meta: MetaFunction = () => [{ title: "Puntos de recarga — Admin STOPee" }];

type View = "solicitudes" | "aliados";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const view: View = new URL(request.url).searchParams.get("vista") === "aliados" ? "aliados" : "solicitudes";

  const [requests, allies] = await Promise.all([
    AllyRequestModel.find().sort({ createdAt: -1 }).limit(300).lean(),
    UserModel.find({ isRefillAlly: true }).select("email allyStation").sort({ updatedAt: -1 }).lean(),
  ]);

  // ¿Quien pide ser punto ya tiene cuenta? Así el administrador va directo a su ficha a activarlo.
  const accounts = await UserModel.find({ email: { $in: requests.map((r) => r.email) } })
    .select("email isRefillAlly")
    .lean();
  const accountByEmail = new Map(accounts.map((a) => [a.email, { id: String(a._id), isRefillAlly: Boolean(a.isRefillAlly) }]));

  // Pendientes primero, y dentro de cada estado la más reciente arriba.
  const order: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
  const sorted = [...requests].sort(
    (a, b) => order[a.status] - order[b.status] || +new Date(b.createdAt) - +new Date(a.createdAt),
  );

  return data({
    view,
    pendingCount: requests.filter((r) => r.status === "pending").length,
    requests: sorted.map((r) => ({
      id: String(r._id),
      name: r.name,
      businessOrType: r.businessOrType,
      neighborhood: r.neighborhood,
      address: r.address,
      whatsapp: r.whatsapp,
      email: r.email,
      status: r.status as RequestStatus,
      createdAt: r.createdAt as unknown as string,
      account: accountByEmail.get(r.email) ?? null,
    })),
    allies: allies.map((u) => ({
      id: String(u._id),
      email: u.email,
      businessName: u.allyStation?.businessName ?? "",
      neighborhood: u.allyStation?.neighborhood ?? "",
      city: u.allyStation?.city ?? "",
      isPublic: Boolean(u.allyStation?.isPublic),
    })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireAdmin(request);
  await connectDB();
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = String(formData.get("id") ?? "");
  if (!Types.ObjectId.isValid(id)) return data({ ok: false, error: "Solicitud no encontrada." }, { status: 404 });

  if (intent === "set-status") {
    const status = String(formData.get("status") ?? "");
    if (!(REQUEST_STATUSES as readonly string[]).includes(status)) {
      return data({ ok: false, error: "Elige un estado válido." }, { status: 400 });
    }
    const done = await AllyRequestModel.updateOne({ _id: id }, { $set: { status } });
    if (done.matchedCount === 0) return data({ ok: false, error: "Solicitud no encontrada." }, { status: 404 });
    logAudit("ally_request.status_changed", { by: String(admin._id), requestId: id, status });
    return data({ ok: true });
  }

  if (intent === "delete") {
    // Quitar una solicitud borra los datos personales de quien la envió (derecho de cancelación).
    const done = await AllyRequestModel.deleteOne({ _id: id });
    if (done.deletedCount === 0) return data({ ok: false, error: "Solicitud no encontrada." }, { status: 404 });
    logAudit("ally_request.deleted", { by: String(admin._id), requestId: id });
    return data({ ok: true });
  }

  return data({ ok: false, error: "Acción no reconocida." }, { status: 400 });
}

const STATUS_STYLE: Record<RequestStatus, string> = {
  pending: "bg-lima text-carbon",
  approved: "bg-bosque/10 text-bosque",
  rejected: "bg-carbon/10 text-carbon/60",
};

const quietButton =
  "min-h-11 w-full rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30 sm:w-auto";

export default function AdminAliados() {
  const { view, pendingCount, requests, allies } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const busyId = navigation.state !== "idle" ? String(navigation.formData?.get("id") ?? "") : "";

  const tab = (to: string, label: string, active: boolean) => (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold ${
        active ? "bg-carbon text-hueso" : "border border-carbon/15 text-carbon hover:border-carbon/30"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div>
      <h1 className="font-display text-2xl font-black text-carbon sm:text-3xl">Puntos de recarga</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Solicitudes de /puntos-de-recarga y aliados activos. Para activar a un aliado, abre su ficha en Clientes.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {tab("/admin/aliados", `Solicitudes${pendingCount > 0 ? ` (${pendingCount} pendientes)` : ""}`, view === "solicitudes")}
        {tab("/admin/aliados?vista=aliados", `Aliados activos (${allies.length})`, view === "aliados")}
      </div>

      {view === "solicitudes" ? (
        requests.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-dashed border-carbon/20 p-5 text-center text-carbon/50 sm:p-8">
            Todavía no hay solicitudes del formulario de /puntos-de-recarga.
          </p>
        ) : (
          <ul className="mt-6 flex flex-col gap-3">
            {requests.map((r) => {
              const wa = whatsappUrl(r.whatsapp, `Hola ${r.name}, te escribimos de STOPee por tu solicitud de Punto de Recarga.`);
              const busy = busyId === r.id;
              return (
                <li
                  key={r.id}
                  className={`min-w-0 rounded-2xl border p-4 sm:p-5 ${r.status === "pending" ? "border-lima bg-lima/5" : "border-carbon/10 bg-white"}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-display font-bold text-carbon">
                        {r.name}
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[r.status]}`}>
                          {REQUEST_STATUS_LABELS[r.status]}
                        </span>
                      </p>
                      <p className="text-sm text-carbon/70">{r.businessOrType}</p>
                      <p className="mt-1 text-xs text-carbon/50">
                        {new Date(r.createdAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:flex-wrap sm:justify-end">
                      {(["approved", "rejected", "pending"] as const)
                        .filter((status) => status !== r.status)
                        .map((status) => (
                          <Form method="post" key={status} className="contents">
                            <input type="hidden" name="intent" value="set-status" />
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="status" value={status} />
                            <button type="submit" disabled={busy} className={quietButton}>
                              {status === "approved" ? "Aprobar" : status === "rejected" ? "Rechazar" : "Volver a pendiente"}
                            </button>
                          </Form>
                        ))}
                    </div>
                  </div>

                  <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="inline text-carbon/50">Colonia: </dt>
                      <dd className="inline break-words text-carbon/80">{r.neighborhood}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="inline text-carbon/50">Dirección: </dt>
                      <dd className="inline break-words text-carbon/80">{r.address}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="inline text-carbon/50">WhatsApp: </dt>
                      <dd className="inline text-carbon/80">
                        {wa ? (
                          <a href={wa} target="_blank" rel="noreferrer" className="text-bosque hover:underline">
                            {r.whatsapp}
                          </a>
                        ) : (
                          r.whatsapp
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="inline text-carbon/50">Correo: </dt>
                      <dd className="inline break-all text-carbon/80">
                        <a href={`mailto:${r.email}`} className="text-bosque hover:underline">
                          {r.email}
                        </a>
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-carbon/10 pt-3 text-sm">
                    {r.account ? (
                      <p className="text-carbon/70">
                        Ya tiene cuenta con este correo.{" "}
                        <Link to={`/admin/customers/${r.account.id}`} className="font-semibold text-bosque underline">
                          {r.account.isRefillAlly ? "Ver su ficha" : "Abrir su ficha para activarlo"}
                        </Link>
                      </p>
                    ) : (
                      <p className="text-carbon/60">Aún no tiene cuenta: pídele que se registre con este correo para activarlo.</p>
                    )}
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        type="submit"
                        disabled={busy}
                        onClick={(event) => {
                          if (!window.confirm("¿Eliminar esta solicitud y los datos de quien la envió? No se puede deshacer.")) event.preventDefault();
                        }}
                        className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon/60 hover:border-red-300 hover:text-red-600"
                      >
                        Eliminar
                      </button>
                    </Form>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : allies.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-carbon/20 p-5 text-center text-carbon/50 sm:p-8">
          Todavía no hay aliados activos. Activa uno desde la ficha de un cliente.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {allies.map((a) => (
            <li key={a.id} className="min-w-0 rounded-2xl border border-carbon/10 bg-white p-4 sm:p-5">
              <p className="flex flex-wrap items-center gap-2 font-display font-bold text-carbon">
                {a.businessName || "Sin nombre"}
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${a.isPublic ? "bg-bosque/10 text-bosque" : "bg-carbon/10 text-carbon/60"}`}
                >
                  {a.isPublic ? "Publicado" : "No publicado"}
                </span>
              </p>
              <p className="text-sm text-carbon/70">
                {[a.neighborhood, a.city].filter(Boolean).join(" · ") || "Sin colonia"}
              </p>
              <p className="mt-1 break-all text-xs text-carbon/50">{a.email}</p>
              <Link to={`/admin/customers/${a.id}`} className="mt-3 inline-block text-sm font-semibold text-bosque underline">
                Editar su punto
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
