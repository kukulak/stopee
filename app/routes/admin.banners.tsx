import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { connectDB } from "~/lib/db.server";
import { SiteBannerModel } from "~/models/siteBanner.server";
import { parseCatalogFormData, uploadedFileToPublicUrl } from "~/lib/upload.server";
import { Field, inputClass } from "~/components/admin/MediaFields";

export const meta: MetaFunction = () => [{ title: "Banners — Admin STOPee" }];

export async function loader() {
  await connectDB();
  const banners = await SiteBannerModel.find().sort({ createdAt: -1 }).lean();
  return json({
    banners: banners.map((b) => ({
      id: String(b._id),
      name: b.name,
      imageUrl: b.imageUrl ?? "",
      text: b.text ?? "",
      ctaText: b.ctaText ?? "",
      ctaHref: b.ctaHref ?? "/tienda",
      isActive: b.isActive,
    })),
  });
}

function buildBannerDoc(formData: FormData, existingImageUrl?: string) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false as const, error: "Ponle un nombre interno al banner." };

  const uploadedImageUrl = uploadedFileToPublicUrl(formData.get("image") as File | null);
  const removeImage = formData.get("removeImage") === "on";
  const imageUrl = uploadedImageUrl ?? (removeImage ? "" : existingImageUrl ?? "");

  return {
    ok: true as const,
    doc: {
      name,
      imageUrl,
      text: String(formData.get("text") ?? "").trim(),
      ctaText: String(formData.get("ctaText") ?? "").trim(),
      ctaHref: String(formData.get("ctaHref") ?? "").trim() || "/tienda",
    },
  };
}

export async function action({ request }: ActionFunctionArgs) {
  await connectDB();
  const formData = await parseCatalogFormData(request);
  const intent = formData.get("intent");

  if (intent === "create") {
    const result = buildBannerDoc(formData);
    if (!result.ok) return json({ ok: false as const, error: result.error }, { status: 400 });
    await SiteBannerModel.create(result.doc);
    return json({ ok: true as const, error: null });
  }

  if (intent === "update") {
    const id = String(formData.get("id"));
    const existing = await SiteBannerModel.findById(id);
    if (!existing) return json({ ok: false as const, error: "Banner no encontrado." }, { status: 404 });
    const result = buildBannerDoc(formData, existing.imageUrl);
    if (!result.ok) return json({ ok: false as const, error: result.error }, { status: 400 });
    await SiteBannerModel.findByIdAndUpdate(id, result.doc);
    return json({ ok: true as const, error: null });
  }

  if (intent === "toggle-active") {
    const banner = await SiteBannerModel.findById(String(formData.get("id")));
    if (banner) {
      banner.isActive = !banner.isActive;
      await banner.save();
    }
    return json({ ok: true as const, error: null });
  }

  if (intent === "delete") {
    await SiteBannerModel.findByIdAndDelete(String(formData.get("id")));
    return json({ ok: true as const, error: null });
  }

  return json({ ok: false as const, error: "Acción no reconocida." }, { status: 400 });
}

type Banner = ReturnType<typeof useLoaderData<typeof loader>>["banners"][number];

function BannerFormFields({ defaults }: { defaults?: Banner }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Nombre interno" htmlFor="name">
        <input id="name" name="name" required defaultValue={defaults?.name} placeholder="Verano 2026" className={inputClass} />
      </Field>
      <Field label="Texto del banner" htmlFor="text">
        <input id="text" name="text" defaultValue={defaults?.text} placeholder="Ciudades limpias, paseos impecables." className={inputClass} />
      </Field>
      <Field label="Texto del botón (opcional)" htmlFor="ctaText">
        <input id="ctaText" name="ctaText" defaultValue={defaults?.ctaText} placeholder="Comprar ahora" className={inputClass} />
      </Field>
      <Field label="Destino del botón" htmlFor="ctaHref">
        <input id="ctaHref" name="ctaHref" defaultValue={defaults?.ctaHref ?? "/tienda"} placeholder="/tienda" className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Imagen de fondo" htmlFor="image">
          <input id="image" name="image" type="file" accept="image/*" className={inputClass} />
        </Field>
        {defaults?.imageUrl && (
          <div className="mt-2 flex items-center gap-2">
            <img src={defaults.imageUrl} alt="" className="h-16 w-28 rounded-lg object-cover" />
            <label className="flex items-center gap-1 text-xs text-carbon/60">
              <input type="checkbox" name="removeImage" className="h-4 w-4 accent-red-500" />
              Quitar imagen actual
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminBanners() {
  const { banners } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isCreating = navigation.state !== "idle" && navigation.formData?.get("intent") === "create";
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <h1 className="font-display text-2xl font-black text-carbon">Banners</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Portadas para el hero del home, independientes de las promociones. Si hay una promoción con
        banner activo al mismo tiempo, gana el que se haya activado/editado más recientemente.
      </p>

      <Form method="post" encType="multipart/form-data" className="mt-6 flex flex-col gap-4 rounded-3xl border border-carbon/10 bg-white p-6">
        <input type="hidden" name="intent" value="create" />
        <BannerFormFields />
        {actionData?.error && <p className="text-sm font-semibold text-red-600">{actionData.error}</p>}
        <button
          type="submit"
          disabled={isCreating}
          className="min-h-11 self-start rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60"
        >
          {isCreating ? "Creando…" : "Crear banner"}
        </button>
      </Form>

      {banners.length === 0 ? (
        <p className="mt-6 text-sm text-carbon/60">Todavía no has creado ningún banner.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {banners.map((b) => (
            <li key={b.id} className="rounded-3xl border border-carbon/10 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {b.imageUrl && <img src={b.imageUrl} alt="" className="h-12 w-20 rounded-lg object-cover" />}
                  <div>
                    <p className="font-display font-bold text-carbon">{b.name}</p>
                    <p className="text-sm text-carbon/60">{b.text || "Sin texto"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${b.isActive ? "bg-lima/20 text-bosque" : "bg-carbon/10 text-carbon/50"}`}>
                    {b.isActive ? "Activo" : "Inactivo"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === b.id ? null : b.id)}
                    className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30"
                  >
                    {editingId === b.id ? "Cerrar" : "Editar"}
                  </button>
                  <Form method="post">
                    <input type="hidden" name="intent" value="toggle-active" />
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30">
                      {b.isActive ? "Desactivar" : "Activar"}
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-red-600 hover:border-red-300">
                      Eliminar
                    </button>
                  </Form>
                </div>
              </div>

              {editingId === b.id && (
                <Form method="post" encType="multipart/form-data" className="mt-4 flex flex-col gap-4 rounded-2xl border border-dashed border-carbon/20 p-4">
                  <input type="hidden" name="intent" value="update" />
                  <input type="hidden" name="id" value={b.id} />
                  <BannerFormFields defaults={b} />
                  <button type="submit" className="min-h-11 self-start rounded-full bg-carbon px-6 text-sm font-bold text-hueso">
                    Guardar cambios
                  </button>
                </Form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
