import type { LoaderFunctionArgs } from "react-router";
import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { LINK_TARGET_ERROR, normalizeLinkTarget } from "~/lib/inputValidation";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { connectDB } from "~/lib/db.server";
import { SiteBannerModel, parseBannerPlacement, type BannerPlacement } from "~/models/siteBanner.server";
import { parseCatalogFormData, uploadedFileToPublicUrl } from "~/lib/upload.server";
import { Field, inputClass } from "~/components/admin/MediaFields";
import { requireAdmin } from "~/lib/session.server";

const SUBTITLE_MAX = 160;

const PLACEMENT_LABEL: Record<BannerPlacement, string> = { home: "Inicio", tienda: "Tienda" };

export const meta: MetaFunction = () => [{ title: "Banners — Admin STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const banners = await SiteBannerModel.find().sort({ createdAt: -1 }).lean();

  return data({
    banners: banners.map((b) => ({
      id: String(b._id),
      name: b.name,
      placement: parseBannerPlacement(b.placement),
      imageUrl: b.imageUrl ?? "",
      imageAlt: b.imageAlt ?? "",
      text: b.text ?? "",
      subtitle: b.subtitle ?? "",
      ctaText: b.ctaText ?? "",
      ctaHref: b.ctaHref ?? "",
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

  // El destino es del botón o, si el banner es solo imagen, de toda la imagen. Vacío: con botón cae a
  // /tienda; sin botón, el banner simplemente no es clicable.
  const ctaText = String(formData.get("ctaText") ?? "").trim();
  const rawCtaHref = String(formData.get("ctaHref") ?? "").trim();
  const ctaHref = rawCtaHref ? normalizeLinkTarget(rawCtaHref) : ctaText ? "/tienda" : "";
  if (ctaHref === null) return { ok: false as const, error: LINK_TARGET_ERROR };

  return {
    ok: true as const,
    doc: {
      name,
      placement: parseBannerPlacement(formData.get("placement")),
      imageUrl,
      imageAlt: String(formData.get("imageAlt") ?? "").trim(),
      text: String(formData.get("text") ?? "").trim(),
      subtitle: String(formData.get("subtitle") ?? "").trim().slice(0, SUBTITLE_MAX),
      ctaText,
      ctaHref,
    },
  };
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const formData = await parseCatalogFormData(request);
  const intent = formData.get("intent");

  if (intent === "create") {
    const result = buildBannerDoc(formData);
    if (!result.ok) return data({ ok: false as const, error: result.error }, { status: 400 });
    const isActive = formData.get("isActive") === "on";
    await SiteBannerModel.create({ ...result.doc, isActive });
    return data({ ok: true as const, error: null });
  }

  if (intent === "update") {
    const id = String(formData.get("id"));
    const existing = await SiteBannerModel.findById(id);
    if (!existing) return data({ ok: false as const, error: "Banner no encontrado." }, { status: 404 });
    const result = buildBannerDoc(formData, existing.imageUrl);
    if (!result.ok) return data({ ok: false as const, error: result.error }, { status: 400 });
    const isActive = formData.get("isActive") === "on";
    await SiteBannerModel.findByIdAndUpdate(id, { ...result.doc, isActive });
    return data({ ok: true as const, error: null });
  }

  if (intent === "toggle-active") {
    const banner = await SiteBannerModel.findById(String(formData.get("id")));
    if (banner) {
      banner.isActive = !banner.isActive;
      await banner.save();
    }
    return data({ ok: true as const, error: null });
  }

  if (intent === "delete") {
    await SiteBannerModel.findByIdAndDelete(String(formData.get("id")));
    return data({ ok: true as const, error: null });
  }

  return data({ ok: false as const, error: "Acción no reconocida." }, { status: 400 });
}

type Banner = ReturnType<typeof useLoaderData<typeof loader>>["banners"][number];

function BannerFormFields({ defaults }: { defaults?: Banner }) {
  const [placement, setPlacement] = useState<BannerPlacement>(defaults?.placement ?? "home");
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Nombre interno" htmlFor="name">
        <input id="name" name="name" required defaultValue={defaults?.name} placeholder="Verano 2026" className={inputClass} />
      </Field>
      <Field label="Dónde se muestra" htmlFor="placement">
        <select
          id="placement"
          name="placement"
          value={placement}
          onChange={(e) => setPlacement(e.target.value as BannerPlacement)}
          className={inputClass}
        >
          <option value="home">Inicio (carrusel grande, de borde a borde)</option>
          <option value="tienda">Tienda (carrusel con productos y promociones)</option>
        </select>
        <p className="mt-1 text-xs text-carbon/60">
          {placement === "home"
            ? "En Inicio habla de beneficios y de quién eres. Si hay varios activos, rotan en un carrusel: el más nuevo primero."
            : "En Tienda habla de productos, paquetes u ofertas. Pueden rotar varios a la vez."}
        </p>
      </Field>
      <Field label="Texto del banner" htmlFor="text">
        <input id="text" name="text" defaultValue={defaults?.text} placeholder="Tu perro disfruta el paseo. Tu calle también." className={inputClass} />
      </Field>
      {placement === "home" && (
        <Field label="Frase de apoyo (opcional)" htmlFor="subtitle">
          <input
            id="subtitle"
            name="subtitle"
            maxLength={SUBTITLE_MAX}
            defaultValue={defaults?.subtitle}
            placeholder="Elimina el olor desde el primer uso."
            className={inputClass}
          />
        </Field>
      )}
      <Field label="Texto del botón (opcional)" htmlFor="ctaText">
        <input id="ctaText" name="ctaText" defaultValue={defaults?.ctaText} placeholder="Comprar ahora" className={inputClass} />
      </Field>
      <Field label="Destino (del botón o de la imagen)" htmlFor="ctaHref">
        <input id="ctaHref" name="ctaHref" defaultValue={defaults ? defaults.ctaHref : "/tienda"} placeholder="/puntos-de-recarga" className={inputClass} />
        <p className="mt-1 text-xs text-carbon/60">
          Si el banner es <strong>solo imagen</strong>, toda la imagen lleva a este destino: no hace falta dibujar un botón.
          Déjalo vacío para que no sea clicable. Usa una ruta del sitio (/tienda) o una dirección https://.
        </p>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Imagen de fondo" htmlFor="image">
          <input id="image" name="image" type="file" accept="image/*" className={inputClass} />
        </Field>
        {defaults?.imageUrl && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <img src={defaults.imageUrl} alt="" className="h-16 w-28 rounded-lg object-cover" />
            <label className="flex min-h-11 items-center gap-2 text-xs text-carbon/60">
              <input type="checkbox" name="removeImage" className="h-5 w-5 shrink-0 accent-red-500" />
              Quitar imagen actual
            </label>
          </div>
        )}
        <input
          type="text"
          name="imageAlt"
          defaultValue={defaults?.imageAlt}
          placeholder="Texto alternativo de la imagen (importa sobre todo si el banner no lleva texto)"
          className={`${inputClass} mt-2`}
        />
      </div>
      <label className="col-span-full flex min-h-11 items-center gap-2 text-sm font-medium text-carbon">
        <input type="checkbox" name="isActive" defaultChecked={defaults?.isActive ?? false} className="h-5 w-5 shrink-0 accent-lima" />
        Activo{defaults ? "" : " desde que lo crees"}: se muestra en {PLACEMENT_LABEL[placement]}
      </label>
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
      <h1 className="font-display text-2xl sm:text-3xl font-black text-carbon">Banners</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Cada banner se muestra en un solo lugar. <strong>Inicio:</strong> banners a todo lo ancho que rotan en un
        carrusel (con uno solo se queda fijo). <strong>Tienda:</strong> el carrusel, junto con las promociones que tengan su propio
        banner activado en <a href="/admin/discounts" className="underline">Descuentos</a>; pueden estar varios activos.
      </p>

      <Form method="post" encType="multipart/form-data" className="mt-6 flex flex-col gap-4 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
        <input type="hidden" name="intent" value="create" />
        <BannerFormFields />
        {actionData?.error && <p className="text-sm font-semibold text-red-600">{actionData.error}</p>}
        <button
          type="submit"
          disabled={isCreating}
          className="min-h-11 w-full rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60 sm:w-auto sm:self-start"
        >
          {isCreating ? "Creando…" : "Crear banner"}
        </button>
      </Form>

      {banners.length === 0 ? (
        <p className="mt-6 text-sm text-carbon/60">Todavía no has creado ningún banner.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {banners.map((b) => (
            <li key={b.id} className="min-w-0 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  {b.imageUrl && <img src={b.imageUrl} alt="" className="h-12 w-20 shrink-0 rounded-lg object-cover" />}
                  <div className="min-w-0">
                    <p className="min-w-0 break-words font-display font-bold text-carbon">{b.name}</p>
                    <p className="text-sm text-carbon/60">{b.text || "Sin texto"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center lg:shrink-0">
                  <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1">
                    <span className="rounded-full border border-carbon/15 px-2.5 py-1 text-xs font-semibold text-carbon/70">
                      {PLACEMENT_LABEL[b.placement]}
                    </span>
                    {b.isActive && b.placement === "tienda" && (
                      <span className="rounded-full bg-lima px-2.5 py-1 text-xs font-bold text-carbon">En el carrusel</span>
                    )}
                    {b.isActive && b.placement === "home" && (
                      <span className="rounded-full bg-lima px-2.5 py-1 text-xs font-bold text-carbon">En el carrusel de Inicio</span>
                    )}
                    {!b.text && !b.ctaText && b.imageUrl && b.ctaHref && (
                      <span className="rounded-full border border-carbon/15 px-2.5 py-1 text-xs font-semibold text-carbon/70">
                        Imagen clicable → {b.ctaHref}
                      </span>
                    )}
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${b.isActive ? "bg-lima/20 text-bosque" : "bg-carbon/10 text-carbon/50"}`}>
                      {b.isActive ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === b.id ? null : b.id)}
                    className="min-h-11 w-full rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30 sm:w-auto"
                  >
                    {editingId === b.id ? "Cerrar" : "Editar"}
                  </button>
                  <Form method="post" className="contents">
                    <input type="hidden" name="intent" value="toggle-active" />
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30 w-full sm:w-auto">
                      {b.isActive ? "Desactivar" : "Activar"}
                    </button>
                  </Form>
                  <Form method="post" className="contents">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-red-600 hover:border-red-300 w-full sm:w-auto">
                      Eliminar
                    </button>
                  </Form>
                </div>
              </div>

              {editingId === b.id && (
                <Form method="post" encType="multipart/form-data" className="mt-4 flex min-w-0 flex-col gap-4 rounded-2xl border border-dashed border-carbon/20 p-3 sm:p-4">
                  <input type="hidden" name="intent" value="update" />
                  <input type="hidden" name="id" value={b.id} />
                  <BannerFormFields defaults={b} />
                  <button type="submit" className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso sm:w-auto sm:self-start">
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
