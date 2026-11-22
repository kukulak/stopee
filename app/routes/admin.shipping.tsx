import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { getShippingConfig, saveShippingConfig, type ShippingConfig } from "~/models/shipping.server";
import { SHIPPING_METHOD_IDS, type ShippingMethodId } from "~/lib/shippingMethods";
import { Field, inputClass } from "~/components/admin/MediaFields";
import { requireAdmin } from "~/lib/session.server";
import { cleanPlainText } from "~/lib/formGuard.server";

export const meta: MetaFunction = () => [{ title: "Envíos — Admin STOPee" }];

const METHOD_TITLES: Record<ShippingMethodId, string> = {
  pickup: "Opción 1 — Punto de entrega",
  home: "Opción 2 — Domicilio",
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return data({ config: await getShippingConfig() });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const formData = await request.formData();
  const current = await getShippingConfig();

  const readMoney = (name: string) => Number(String(formData.get(name) ?? "").replace(",", "."));

  const methods = { ...current.methods };
  for (const id of SHIPPING_METHOD_IDS) {
    const label = cleanPlainText(formData.get(`${id}_label`)).slice(0, 100);
    const note = cleanPlainText(formData.get(`${id}_note`)).slice(0, 200);
    const cost = readMoney(`${id}_cost`);
    if (!label) {
      return data({ ok: false as const, error: `Ponle nombre a "${METHOD_TITLES[id]}".` }, { status: 400 });
    }
    if (!Number.isFinite(cost) || cost < 0) {
      return data({ ok: false as const, error: `El costo de "${label}" no puede estar vacío ni ser negativo.` }, { status: 400 });
    }
    const deliveryTime = cleanPlainText(formData.get(`${id}_deliveryTime`)).slice(0, 120);
    const details = String(formData.get(`${id}_details`) ?? "").trim().slice(0, 4000);
    methods[id] = { label, note, cost, isActive: formData.get(`${id}_active`) === "on", deliveryTime, details };
  }

  const isEnabled = formData.get("isEnabled") === "on";
  const freeShippingEnabled = formData.get("freeShippingEnabled") === "on";
  const threshold = readMoney("freeShippingThreshold");
  if (freeShippingEnabled && (!Number.isFinite(threshold) || threshold <= 0)) {
    return data({ ok: false as const, error: "Escribe desde qué monto el envío es gratis (mayor a $0)." }, { status: 400 });
  }
  if (isEnabled && !SHIPPING_METHOD_IDS.some((id) => methods[id].isActive)) {
    return data(
      { ok: false as const, error: "Deja activa al menos una opción de envío, o apaga el cobro de envío." },
      { status: 400 },
    );
  }

  const next: ShippingConfig = {
    isEnabled,
    methods,
    freeShippingEnabled,
    // Si está apagado se conserva el monto que ya había en vez de borrarlo.
    freeShippingThreshold: Number.isFinite(threshold) && threshold > 0 ? threshold : current.freeShippingThreshold,
  };
  await saveShippingConfig(next);
  return data({ ok: true as const, error: null });
}

function MethodCard({ id, config }: { id: ShippingMethodId; config: ShippingConfig }) {
  const method = config.methods[id];
  return (
    <fieldset className="w-full min-w-0 max-w-full rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
      <legend className="sr-only">{METHOD_TITLES[id]}</legend>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-carbon">{METHOD_TITLES[id]}</h2>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-carbon">
          <input type="checkbox" name={`${id}_active`} defaultChecked={method.isActive} className="h-5 w-5 shrink-0 accent-lima" />
          Ofrecer en el carrito
        </label>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field label="Nombre que ve el cliente" htmlFor={`${id}_label`}>
          <input id={`${id}_label`} name={`${id}_label`} required maxLength={100} defaultValue={method.label} className={inputClass} />
        </Field>
        <Field label="Costo (MXN)" htmlFor={`${id}_cost`}>
          <input
            id={`${id}_cost`}
            name={`${id}_cost`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            required
            defaultValue={method.cost}
            className={inputClass}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Nota debajo del nombre (opcional)" htmlFor={`${id}_note`}>
            <input id={`${id}_note`} name={`${id}_note`} maxLength={200} defaultValue={method.note} className={inputClass} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Tiempo estimado de entrega (opcional)" htmlFor={`${id}_deliveryTime`}>
            <input
              id={`${id}_deliveryTime`}
              name={`${id}_deliveryTime`}
              maxLength={120}
              defaultValue={method.deliveryTime}
              placeholder="Ej. 3 a 5 días hábiles después del despacho"
              className={inputClass}
            />
          </Field>
          <p className="mt-1 text-xs text-carbon/50">
            Si lo dejas vacío, la página de envíos no muestra ese dato. Escríbelo solo cuando estés seguro del plazo.
          </p>
        </div>
        <div className="sm:col-span-2">
          <Field label="Explicación para la página de envíos" htmlFor={`${id}_details`}>
            <textarea
              id={`${id}_details`}
              name={`${id}_details`}
              rows={9}
              maxLength={4000}
              defaultValue={method.details}
              className={`${inputClass} font-mono text-xs`}
            />
          </Field>
          <p className="mt-1 text-xs text-carbon/50">
            Aquí explicas qué es y cómo funciona. Puedes usar <code>## Título</code> para encabezados, <code>- </code> para
            viñetas y <code>**negritas**</code>.
          </p>
        </div>
      </div>
    </fieldset>
  );
}

export default function AdminShipping() {
  const { config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state !== "idle";

  return (
    <div className="w-full min-w-0 max-w-3xl">
      <h1 className="font-display text-2xl font-black text-carbon sm:text-3xl">Envíos</h1>
      <p className="mt-1 text-sm text-carbon/60">
        El cliente elige entre estas opciones en el carrito. El costo se suma al total en el pago, y la opción elegida
        con la dirección de entrega queda en cada pedido.{" "}
        <a href="/envios" target="_blank" rel="noreferrer" className="font-semibold text-bosque underline">
          Ver la página pública de envíos
        </a>
        .
      </p>

      {/* key: al guardar, los campos se vuelven a leer de la base de datos. */}
      <Form method="post" className="mt-6 flex w-full min-w-0 flex-col gap-5" key={JSON.stringify(config)}>
        <label className="flex min-h-11 items-start gap-3 text-sm font-medium text-carbon">
          <input type="checkbox" name="isEnabled" defaultChecked={config.isEnabled} className="mt-0.5 h-5 w-5 shrink-0 accent-lima" />
          Cobrar envío (desmárcalo para que todos los pedidos salgan sin costo de envío)
        </label>

        {SHIPPING_METHOD_IDS.map((id) => (
          <MethodCard key={id} id={id} config={config} />
        ))}

        <fieldset className="w-full min-w-0 max-w-full rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
          <legend className="sr-only">Envío gratis</legend>
          <h2 className="font-display text-lg font-bold text-carbon">Envío gratis</h2>
          <label className="mt-3 flex min-h-11 items-start gap-3 text-sm font-medium text-carbon">
            <input type="checkbox" name="freeShippingEnabled" defaultChecked={config.freeShippingEnabled} className="mt-0.5 h-5 w-5 shrink-0 accent-lima" />
            Envío gratis a partir de un monto de compra
          </label>
          <div className="mt-3 max-w-xs">
            <Field label="Monto mínimo (MXN)" htmlFor="freeShippingThreshold">
              <input
                id="freeShippingThreshold"
                name="freeShippingThreshold"
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                defaultValue={config.freeShippingThreshold}
                className={inputClass}
              />
            </Field>
          </div>
          <p className="mt-2 text-xs text-carbon/50">
            Se compara contra el subtotal de productos ya con descuentos, sin envío. Al alcanzarlo, la opción que el
            cliente elija cuesta $0. Mientras no llegue, el carrito le muestra cuánto le falta.
          </p>
        </fieldset>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button type="submit" disabled={isSaving} className="min-h-11 w-full rounded-full bg-carbon px-8 text-sm font-bold text-hueso disabled:opacity-60 sm:w-auto">
            {isSaving ? "Guardando…" : "Guardar cambios"}
          </button>
          {actionData?.error && <p className="text-sm font-semibold text-red-600">{actionData.error}</p>}
          {actionData?.ok && !isSaving && <p className="text-sm font-semibold text-bosque">Cambios guardados.</p>}
        </div>
      </Form>
    </div>
  );
}
