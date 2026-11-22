import type { LoaderFunctionArgs } from "@remix-run/node";
import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { connectDB } from "~/lib/db.server";
import { PasswordGateModel } from "~/models/passwordGate.server";
import { DEFAULT_GATE_COPY } from "~/lib/passwordGateCopy";
import { PromotionModel } from "~/models/promotion.server";
import { getCatalogItems } from "~/lib/catalog.server";
import { Field, inputClass } from "~/components/admin/MediaFields";
import { requireAdmin } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Acceso privado — Admin STOPee" }];

function toDatetimeLocalValue(date?: Date | string | null) {
  if (!date) return "";
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const [gate, coupons, catalogItems] = await Promise.all([
    PasswordGateModel.findOne().lean(),
    PromotionModel.find({ type: "coupon" }).select("name coupon").lean(),
    getCatalogItems({ includeUnavailable: true }),
  ]);

  return json({
    gate: gate
      ? {
          isActive: gate.isActive,
          startsAt: gate.startsAt ?? null,
          endsAt: gate.endsAt ?? null,
          scopeType: gate.scopeType,
          scopeRoutes: gate.scopeRoutes ?? [],
          scopeProductSkus: gate.scopeProductSkus ?? [],
          password: gate.password ?? "",
          linkedPromotionId: gate.linkedPromotionId ? String(gate.linkedPromotionId) : "",
          kicker: gate.kicker ?? "",
          title: gate.title ?? "",
          description: gate.description ?? "",
          passwordPlaceholder: gate.passwordPlaceholder ?? "",
          buttonText: gate.buttonText ?? "",
          errorMessage: gate.errorMessage ?? "",
          cartBannerMessage: gate.cartBannerMessage ?? "",
        }
      : null,
    coupons: coupons
      .filter((p) => p.coupon?.code)
      .map((p) => ({ id: String(p._id), label: `${p.name} (${p.coupon!.code} · ${p.coupon!.percentage}%)` })),
    products: catalogItems.filter((i) => i.kind === "product").map((i) => ({ sku: i.sku, name: i.name })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const formData = await request.formData();

  const scopeRoutes = String(formData.get("scopeRoutes") ?? "")
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  const scopeProductSkus = formData.getAll("scopeProductSkus") as string[];
  const linkedPromotionIdRaw = String(formData.get("linkedPromotionId") ?? "");
  const startsAtRaw = String(formData.get("startsAt") ?? "");
  const endsAtRaw = String(formData.get("endsAt") ?? "");

  const doc = {
    isActive: formData.get("isActive") === "on",
    startsAt: startsAtRaw ? new Date(startsAtRaw) : undefined,
    endsAt: endsAtRaw ? new Date(endsAtRaw) : undefined,
    scopeType: String(formData.get("scopeType") ?? "all_store"),
    scopeRoutes,
    scopeProductSkus,
    password: String(formData.get("password") ?? "").trim(),
    linkedPromotionId: linkedPromotionIdRaw || undefined,
    kicker: String(formData.get("kicker") ?? "").trim(),
    title: String(formData.get("title") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    passwordPlaceholder: String(formData.get("passwordPlaceholder") ?? "").trim(),
    buttonText: String(formData.get("buttonText") ?? "").trim(),
    errorMessage: String(formData.get("errorMessage") ?? "").trim(),
    cartBannerMessage: String(formData.get("cartBannerMessage") ?? "").trim(),
  };

  const existing = await PasswordGateModel.findOne();
  if (existing) {
    Object.assign(existing, doc);
    if (!linkedPromotionIdRaw) existing.linkedPromotionId = undefined;
    await existing.save();
  } else {
    await PasswordGateModel.create(doc);
  }

  return json({ ok: true, error: null as string | null });
}

export default function AdminPasswordGate() {
  const { gate, coupons, products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state !== "idle";

  return (
    <div className="w-full min-w-0 max-w-3xl">
      <h1 className="font-display text-2xl sm:text-3xl font-black text-carbon">Acceso privado (Password Gate)</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Ventas privadas con contraseña — actívalo, prográmalo y reutilízalo para cualquier campaña
        futura sin tocar código. Todos los textos de abajo se pueden dejar en blanco: si no escribes
        nada, se usa el texto por defecto que aparece como ejemplo (placeholder).
      </p>

      {actionData?.ok && <p className="mt-4 text-sm font-semibold text-bosque">Configuración guardada.</p>}
      {actionData?.error && <p className="mt-4 text-sm font-semibold text-red-600">{actionData.error}</p>}

      <Form method="post" className="mt-6 flex w-full min-w-0 flex-col gap-6 sm:gap-8">
        {/* Estado y calendario */}
        <section className="min-w-0 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
          <h2 className="font-display text-lg font-bold text-carbon">Estado y calendario</h2>
          <label className="mt-4 flex min-h-11 items-start gap-3 text-sm font-medium text-carbon">
            <input type="checkbox" name="isActive" defaultChecked={gate?.isActive ?? false} className="mt-0.5 h-5 w-5 shrink-0 accent-lima" />
            Forzar activa ahora mismo (ignora las fechas de abajo)
          </label>
          <p className="mt-1 text-xs text-carbon/50">
            Si lo dejas sin marcar, la compuerta sigue el rango de fechas — si tampoco hay fechas, queda inactiva.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Inicia (opcional)" htmlFor="startsAt">
              <input id="startsAt" name="startsAt" type="datetime-local" defaultValue={toDatetimeLocalValue(gate?.startsAt)} className={inputClass} />
            </Field>
            <Field label="Termina (opcional)" htmlFor="endsAt">
              <input id="endsAt" name="endsAt" type="datetime-local" defaultValue={toDatetimeLocalValue(gate?.endsAt)} className={inputClass} />
            </Field>
          </div>
        </section>

        {/* Alcance */}
        <section className="min-w-0 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
          <h2 className="font-display text-lg font-bold text-carbon">Qué bloquea</h2>
          <ScopePicker defaultScopeType={gate?.scopeType ?? "all_store"} defaultRoutes={gate?.scopeRoutes ?? []} products={products} defaultSkus={gate?.scopeProductSkus ?? []} />
        </section>

        {/* Seguridad y descuento */}
        <section className="min-w-0 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
          <h2 className="font-display text-lg font-bold text-carbon">Clave y descuento</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Contraseña de acceso" htmlFor="password">
              <input id="password" name="password" type="text" required defaultValue={gate?.password} placeholder="BIENVENIDOS2026" className={inputClass} />
            </Field>
            <Field label="Cupón que se aplica automáticamente (opcional)" htmlFor="linkedPromotionId">
              <select id="linkedPromotionId" name="linkedPromotionId" defaultValue={gate?.linkedPromotionId ?? ""} className={inputClass}>
                <option value="">Sin descuento automático</option>
                {coupons.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-carbon/50">
                Crea o edita cupones en <a href="/admin/discounts" className="underline">Descuentos y promociones</a>.
              </p>
            </Field>
          </div>
        </section>

        {/* CMS dinámico */}
        <section className="min-w-0 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
          <h2 className="font-display text-lg font-bold text-carbon">Textos de la pantalla de desbloqueo</h2>
          <div className="mt-4 flex flex-col gap-4">
            <Field label="Etiqueta superior (kicker)" htmlFor="kicker">
              <input id="kicker" name="kicker" defaultValue={gate?.kicker} placeholder={DEFAULT_GATE_COPY.kicker} className={inputClass} />
            </Field>
            <Field label="Título principal" htmlFor="title">
              <input id="title" name="title" defaultValue={gate?.title} placeholder={DEFAULT_GATE_COPY.title} className={inputClass} />
            </Field>
            <Field label="Texto descriptivo" htmlFor="description">
              <textarea id="description" name="description" rows={4} defaultValue={gate?.description} placeholder={DEFAULT_GATE_COPY.description} className={inputClass} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Placeholder del campo de clave" htmlFor="passwordPlaceholder">
                <input id="passwordPlaceholder" name="passwordPlaceholder" defaultValue={gate?.passwordPlaceholder} placeholder={DEFAULT_GATE_COPY.passwordPlaceholder} className={inputClass} />
              </Field>
              <Field label="Texto del botón" htmlFor="buttonText">
                <input id="buttonText" name="buttonText" defaultValue={gate?.buttonText} placeholder={DEFAULT_GATE_COPY.buttonText} className={inputClass} />
              </Field>
            </div>
            <Field label="Mensaje de clave incorrecta" htmlFor="errorMessage">
              <textarea id="errorMessage" name="errorMessage" rows={2} defaultValue={gate?.errorMessage} placeholder={DEFAULT_GATE_COPY.errorMessage} className={inputClass} />
            </Field>
            <Field label="Banner de confirmación en carrito/checkout" htmlFor="cartBannerMessage">
              <input id="cartBannerMessage" name="cartBannerMessage" defaultValue={gate?.cartBannerMessage} placeholder={DEFAULT_GATE_COPY.cartBannerMessage} className={inputClass} />
            </Field>
          </div>
        </section>

        <button
          type="submit"
          disabled={isSaving}
          className="min-h-11 w-full rounded-full bg-lima px-8 text-sm font-bold text-carbon disabled:opacity-60 sm:w-auto sm:self-start"
        >
          {isSaving ? "Guardando…" : "Guardar configuración"}
        </button>
      </Form>
    </div>
  );
}

function ScopePicker({
  defaultScopeType,
  defaultRoutes,
  defaultSkus,
  products,
}: {
  defaultScopeType: string;
  defaultRoutes: string[];
  defaultSkus: string[];
  products: { sku: string; name: string }[];
}) {
  return (
    <div className="mt-4 flex flex-col gap-4">
      <Field label="Alcance de la protección" htmlFor="scopeType">
        <select id="scopeType" name="scopeType" defaultValue={defaultScopeType} className={inputClass}>
          <option value="all_store">Tienda completa (/tienda y todas sus fichas de producto)</option>
          <option value="specific_routes">Rutas específicas</option>
          <option value="specific_products">Productos seleccionados</option>
        </select>
      </Field>

      <Field label="Rutas a proteger (una por línea, ej. /tienda o /blog) — solo aplica con 'Rutas específicas'" htmlFor="scopeRoutes">
        <textarea
          id="scopeRoutes"
          name="scopeRoutes"
          rows={3}
          defaultValue={defaultRoutes.join("\n")}
          placeholder={"/tienda\n/blog"}
          className={`${inputClass} font-mono text-sm`}
        />
      </Field>

      <div>
        <p className="text-sm font-semibold text-carbon">Productos a proteger — solo aplica con "Productos seleccionados"</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {products.map((p) => (
            <label
              key={p.sku}
              className="flex min-h-11 min-w-0 max-w-full cursor-pointer items-center gap-2 break-words rounded-full border border-carbon/15 px-3 py-1.5 text-sm text-carbon has-[:checked]:border-lima has-[:checked]:bg-lima/20"
            >
              <input
                type="checkbox"
                name="scopeProductSkus"
                value={p.sku}
                defaultChecked={defaultSkus.includes(p.sku)}
                className="h-5 w-5 shrink-0 accent-lima"
              />
              {p.name}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
