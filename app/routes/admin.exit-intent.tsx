import type { LoaderFunctionArgs } from "@remix-run/node";
import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { LINK_TARGET_ERROR, normalizeLinkTarget } from "~/lib/inputValidation";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { getExitIntentPopup, updateExitIntentPopup } from "~/models/exitIntentPopup.server";
import { parseCatalogFormData, uploadedFileToPublicUrl } from "~/lib/upload.server";
import { Field, inputClass } from "~/components/admin/MediaFields";
import { requireAdmin } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Popup de salida — Admin STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const popup = await getExitIntentPopup();
  return json({
    isEnabled: popup.isEnabled,
    title: popup.title ?? "",
    message: popup.message ?? "",
    imageUrl: popup.imageUrl ?? "",
    ctaText: popup.ctaText ?? "",
    ctaHref: popup.ctaHref ?? "/tienda",
    showOnHome: popup.showOnHome,
    showOnTienda: popup.showOnTienda,
    showOnBlog: popup.showOnBlog,
    snoozeDays: popup.snoozeDays ?? 7,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const formData = await parseCatalogFormData(request);
  const existing = await getExitIntentPopup();

  const uploadedImageUrl = uploadedFileToPublicUrl(formData.get("image") as File | null);
  const removeImage = formData.get("removeImage") === "on";
  const imageUrl = uploadedImageUrl ?? (removeImage ? "" : existing.imageUrl ?? "");

  const rawCtaHref = String(formData.get("ctaHref") ?? "").trim();
  const ctaHref = rawCtaHref ? normalizeLinkTarget(rawCtaHref) : "/tienda";
  if (!ctaHref) return json({ ok: false as const, error: LINK_TARGET_ERROR }, { status: 400 });

  await updateExitIntentPopup({
    isEnabled: formData.get("isEnabled") === "on",
    title: String(formData.get("title") ?? "").trim(),
    message: String(formData.get("message") ?? "").trim(),
    imageUrl,
    ctaText: String(formData.get("ctaText") ?? "").trim(),
    ctaHref,
    showOnHome: formData.get("showOnHome") === "on",
    showOnTienda: formData.get("showOnTienda") === "on",
    showOnBlog: formData.get("showOnBlog") === "on",
    snoozeDays: Number(formData.get("snoozeDays") ?? 7) || 7,
  });

  return json({ ok: true as const, error: null });
}

export default function AdminExitIntent() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <div className="w-full min-w-0 max-w-2xl">
      <h1 className="font-display text-2xl sm:text-3xl font-black text-carbon">Popup de salida</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Aparece cuando alguien está a punto de irse sin comprar (su cursor sube rápido hacia la barra del
        navegador o las pestañas; solo en computadora, nunca por hacer scroll). No vuelve a salirle a la
        misma persona hasta que pase el número de días que definas abajo.
      </p>

      <Form
        method="post"
        encType="multipart/form-data"
        className="mt-6 flex flex-col gap-4 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6"
      >
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-carbon/10 p-4">
          <div className="min-w-0">
            <label htmlFor="isEnabled" className="text-sm font-semibold text-carbon">
              Activar popup de salida
            </label>
            <p className="mt-1 text-xs text-carbon/50">
              Apagado por defecto — no aparece nada hasta que actives esto Y llenes un mensaje.
            </p>
          </div>
          <input
            id="isEnabled"
            name="isEnabled"
            type="checkbox"
            defaultChecked={data.isEnabled}
            className="h-6 w-6 shrink-0 accent-lima"
          />
        </div>

        <Field label="Título" htmlFor="title">
          <input
            id="title"
            name="title"
            type="text"
            defaultValue={data.title}
            placeholder="¿Ya te vas?"
            className={inputClass}
          />
        </Field>

        <Field label="Mensaje" htmlFor="message">
          <textarea
            id="message"
            name="message"
            rows={3}
            defaultValue={data.message}
            placeholder="Llévate 10% de descuento en tu primer pedido con el código BIENVENIDA."
            className={inputClass}
          />
        </Field>

        <Field label="Imagen (opcional)" htmlFor="image">
          <input id="image" name="image" type="file" accept="image/*" className={inputClass} />
          {data.imageUrl && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <img src={data.imageUrl} alt="" className="h-14 w-24 rounded-lg object-cover" />
              <label className="flex min-h-11 items-center gap-2 text-xs text-carbon/60">
                <input type="checkbox" name="removeImage" className="h-5 w-5 shrink-0 accent-red-500" />
                Quitar imagen actual
              </label>
            </div>
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Texto del botón (opcional)" htmlFor="ctaText">
            <input
              id="ctaText"
              name="ctaText"
              type="text"
              defaultValue={data.ctaText}
              placeholder="Comprar ahora"
              className={inputClass}
            />
          </Field>
          <Field label="Destino del botón" htmlFor="ctaHref">
            <input
              id="ctaHref"
              name="ctaHref"
              type="text"
              defaultValue={data.ctaHref}
              placeholder="/tienda"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="min-w-0 rounded-2xl border border-carbon/10 p-4">
          <p className="text-sm font-semibold text-carbon">¿En qué páginas puede salir?</p>
          <div className="mt-3 flex flex-col gap-2">
            <label className="flex min-h-11 items-center gap-2 text-sm text-carbon">
              <input type="checkbox" name="showOnHome" defaultChecked={data.showOnHome} className="h-5 w-5 shrink-0 accent-lima" />
              Inicio
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-carbon">
              <input type="checkbox" name="showOnTienda" defaultChecked={data.showOnTienda} className="h-5 w-5 shrink-0 accent-lima" />
              Tienda y fichas de producto
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-carbon">
              <input type="checkbox" name="showOnBlog" defaultChecked={data.showOnBlog} className="h-5 w-5 shrink-0 accent-lima" />
              Blog
            </label>
          </div>
          <p className="mt-2 text-xs text-carbon/50">Nunca aparece en /admin ni /cuenta.</p>
        </div>

        <Field label="No volver a mostrar por (días)" htmlFor="snoozeDays">
          <input
            id="snoozeDays"
            name="snoozeDays"
            type="number"
            min={1}
            defaultValue={data.snoozeDays}
            className={`${inputClass} max-w-[120px]`}
          />
        </Field>

        {actionData?.ok && <p className="text-sm font-semibold text-bosque">Guardado.</p>}
        {actionData && !actionData.ok && actionData.error && (
          <p role="alert" className="text-sm font-semibold text-red-600">{actionData.error}</p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60 sm:w-auto sm:self-start"
        >
          {isSubmitting ? "Guardando…" : "Guardar cambios"}
        </button>
      </Form>
    </div>
  );
}
