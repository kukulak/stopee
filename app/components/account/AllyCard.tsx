import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { BrandText } from "~/components/ui/BrandText";
import { REQUEST_STATUS_LABELS, type RequestStatus } from "~/lib/refillPoints";

export type AllyInfo = {
  businessName: string;
  neighborhood: string;
  city: string;
  address: string;
  schedule: string;
  whatsapp: string;
  mapsUrl: string;
  isPublic: boolean;
};

export type AllyOrder = {
  id: string;
  createdAt: string;
  status: string;
  netAmount: number;
  items: { name: string; quantity: number }[];
};

type SaveResult = { ok: boolean; error: string | null; savedIntent: string | null };

const quietButton =
  "min-h-11 rounded-full border border-carbon/15 px-4 text-sm font-semibold text-carbon hover:border-carbon/30 disabled:opacity-60";
const inputClass =
  "mt-1 block min-h-11 w-full rounded-xl border border-carbon/15 bg-white px-3 text-base text-carbon focus:border-oliva focus:outline-none sm:text-sm";

/**
 * Lo que ve en «Mi cuenta» quien es (o pidió ser) Punto de Recarga: que se sienta un aliado de STOPee,
 * con su punto, su colonia, si ya aparece en el directorio y sus pedidos de bidón. Puede mantener al día
 * su horario, WhatsApp y enlace del mapa sin pasar por nosotros; el nombre y la dirección del punto y
 * publicarlo (o no) en el directorio siguen siendo de un administrador.
 */
export function AllyCard({
  ally,
  requestStatus,
  orders,
  orderStatusLabels,
}: {
  ally: AllyInfo | null;
  requestStatus: RequestStatus | null;
  orders: AllyOrder[];
  orderStatusLabels: Record<string, string>;
}) {
  if (!ally) {
    if (!requestStatus) return null;
    return (
      <div className="mt-8 rounded-3xl border border-carbon/10 bg-white p-6">
        <p className="font-display font-bold text-carbon">Tu solicitud de Punto de Recarga</p>
        <p className="mt-2 text-sm text-carbon/70">
          {requestStatus === "pending" && "Estamos revisando tu solicitud. Te escribimos por WhatsApp o por correo para platicar los siguientes pasos."}
          {requestStatus === "approved" && "Tu solicitud fue aprobada. En cuanto confirmes tu correo, tu cuenta se activa como Punto de Recarga."}
          {requestStatus === "rejected" && "Por ahora tu solicitud no avanzó. Si tienes dudas, escríbenos desde Contacto."}
        </p>
        <span className="mt-3 inline-block rounded-full bg-carbon/5 px-3 py-1 text-xs font-bold text-carbon/70">
          {REQUEST_STATUS_LABELS[requestStatus]}
        </span>
      </div>
    );
  }

  return <ActiveAllyCard ally={ally} orders={orders} orderStatusLabels={orderStatusLabels} />;
}

function ActiveAllyCard({
  ally,
  orders,
  orderStatusLabels,
}: {
  ally: AllyInfo;
  orders: AllyOrder[];
  orderStatusLabels: Record<string, string>;
}) {
  const fetcher = useFetcher<SaveResult>();
  const [editing, setEditing] = useState(false);
  const saving = fetcher.state !== "idle";
  const result = fetcher.data?.savedIntent === "ally-update" ? fetcher.data : null;
  const place = [ally.neighborhood, ally.city].filter(Boolean).join(" · ");

  return (
    <div className="mt-8 rounded-3xl border-2 border-lima bg-lima/10 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-carbon px-3 py-1 text-xs font-bold uppercase tracking-wide text-lima">
          <BrandText>Aliado STOPee</BrandText>
        </span>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${ally.isPublic ? "bg-bosque/10 text-bosque" : "bg-carbon/10 text-carbon/60"}`}
        >
          {ally.isPublic ? "Visible en el directorio" : "Aún no aparece en el directorio"}
        </span>
      </div>

      <p className="mt-3 font-display text-xl font-black text-carbon">{ally.businessName || "Tu Punto de Recarga"}</p>
      {place && <p className="text-sm font-semibold text-carbon/70">{place}</p>}
      <p className="mt-2 text-sm text-carbon/70">
        Eres parte de la red de Puntos de Recarga STOPee: tu comunidad recarga cerca de casa, sin envases desechables.
      </p>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-carbon/50">Dirección</dt>
          <dd className="break-words text-carbon/80">{ally.address || "Sin registrar"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-carbon/50">Horario de recarga</dt>
          <dd className="break-words text-carbon/80">{ally.schedule || "Sin registrar"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-carbon/50">WhatsApp del punto</dt>
          <dd className="text-carbon/80">{ally.whatsapp || "Sin registrar"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-carbon/50">Enlace del mapa</dt>
          <dd className="break-all text-carbon/80">{ally.mapsUrl || "Se busca por tu dirección"}</dd>
        </div>
      </dl>

      {!ally.isPublic && (
        <p className="mt-4 rounded-2xl bg-white/70 p-3 text-xs text-carbon/70">
          Tu punto no se publica hasta que tú lo autorices: cuando quieras aparecer en el directorio, avísanos y lo
          activamos.
        </p>
      )}

      {editing ? (
        <fetcher.Form
          method="post"
          action="/cuenta"
          className="mt-4 flex flex-col gap-3 rounded-2xl bg-white/70 p-4"
          onSubmit={() => setEditing(false)}
        >
          <input type="hidden" name="intent" value="ally-update" />
          <div>
            <label htmlFor="ally-schedule" className="text-sm font-semibold text-carbon">
              Horario de recarga
            </label>
            <input id="ally-schedule" name="schedule" defaultValue={ally.schedule} maxLength={120} placeholder="Lunes a sábado, 10:00 a 18:00" className={inputClass} />
          </div>
          <div>
            <label htmlFor="ally-whatsapp" className="text-sm font-semibold text-carbon">
              WhatsApp del punto
            </label>
            <input id="ally-whatsapp" name="whatsapp" type="tel" inputMode="tel" defaultValue={ally.whatsapp} maxLength={20} className={inputClass} />
          </div>
          <div>
            <label htmlFor="ally-maps" className="text-sm font-semibold text-carbon">
              Enlace de Google Maps <span className="font-normal text-carbon/50">(opcional)</span>
            </label>
            <input id="ally-maps" name="mapsUrl" type="url" inputMode="url" defaultValue={ally.mapsUrl} maxLength={500} placeholder="https://maps.app.goo.gl/…" className={inputClass} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className="min-h-11 rounded-full bg-carbon px-5 text-sm font-bold text-hueso disabled:opacity-60">
              {saving ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={quietButton}>
              Cancelar
            </button>
          </div>
        </fetcher.Form>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setEditing(true)} className={quietButton}>
            Actualizar horario y contacto
          </button>
          {ally.isPublic && (
            <Link to="/puntos-de-recarga" className={`${quietButton} inline-flex items-center`}>
              Ver el directorio
            </Link>
          )}
        </div>
      )}

      {result && (
        <p role={result.ok ? "status" : "alert"} className={`mt-3 text-sm font-semibold ${result.ok ? "text-bosque" : "text-red-600"}`}>
          {result.ok ? "Datos de tu punto actualizados." : result.error}
        </p>
      )}

      <div className="mt-6 border-t border-carbon/10 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-display font-bold text-carbon">Tus pedidos de bidón</p>
          <Link to="/tienda" className="text-sm font-semibold text-bosque hover:underline">
            Pedir bidón
          </Link>
        </div>
        {orders.length === 0 ? (
          <p className="mt-2 text-sm text-carbon/60">Aún no has pedido bidones. Aparecen en la tienda con tu precio de aliado.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {orders.map((order) => (
              <li key={order.id} className="flex flex-wrap items-baseline justify-between gap-x-4 rounded-2xl bg-white/70 px-4 py-3 text-sm">
                <span className="min-w-0 text-carbon">
                  {order.items.map((item) => `${item.quantity}× ${item.name}`).join(", ")}
                </span>
                <span className="text-carbon/60">
                  {new Date(order.createdAt).toLocaleDateString("es-MX", { dateStyle: "medium" })} ·{" "}
                  {orderStatusLabels[order.status] ?? order.status} · ${Math.round(order.netAmount).toLocaleString("es-MX")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
