import type { LoaderFunctionArgs } from "react-router";
import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { z } from "zod";
import { connectDB } from "~/lib/db.server";
import { TestimonialModel } from "~/models/testimonial.server";
import { ProductModel } from "~/models/product.server";
import { BundleModel } from "~/models/bundle.server";
import { parseCatalogFormData, uploadedFileToPublicUrl } from "~/lib/upload.server";
import { Field, inputClass } from "~/components/admin/MediaFields";
import { StarRating } from "~/components/ui/Icons";
import { requireAdmin } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Testimonios — Admin STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const [testimonials, products, bundles] = await Promise.all([
    TestimonialModel.find().sort({ createdAt: -1 }).lean(),
    ProductModel.find().sort({ name: 1 }).select("name sku").lean(),
    BundleModel.find().sort({ name: 1 }).select("name sku").lean(),
  ]);
  return data({
    // Todo lo que se puede etiquetar (incluye pausados, para no perder etiquetas al editar).
    taggable: [...products, ...bundles].map((item) => ({ sku: item.sku, name: item.name })),
    testimonials: testimonials.map((t) => ({
      id: String(t._id),
      customerName: t.customerName,
      quote: t.quote,
      rating: t.rating,
      photoUrl: t.photoUrl ?? "",
      isPublished: t.isPublished,
      productSkus: t.productSkus ?? [],
    })),
  });
}

const testimonialSchema = z.object({
  customerName: z.string().trim().min(1, "Ponle el nombre del cliente."),
  quote: z.string().trim().min(10, "El testimonio debe tener al menos 10 caracteres."),
  rating: z.coerce.number().min(1).max(5),
});

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const formData = await parseCatalogFormData(request);
  const intent = formData.get("intent");

  if (intent === "create" || intent === "update") {
    const parsed = testimonialSchema.safeParse({
      customerName: formData.get("customerName"),
      quote: formData.get("quote"),
      rating: formData.get("rating"),
    });
    if (!parsed.success) {
      return data({ ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." }, { status: 400 });
    }
    const isPublished = formData.get("isPublished") === "on";
    const productSkus = formData.getAll("productSkus").map(String).filter(Boolean);
    const uploadedPhotoUrl = uploadedFileToPublicUrl(formData.get("photo") as File | null);

    if (intent === "update") {
      const id = String(formData.get("id"));
      const removePhoto = formData.get("removePhoto") === "on";
      const existing = await TestimonialModel.findById(id);
      const photoUrl = uploadedPhotoUrl ?? (removePhoto ? "" : existing?.photoUrl ?? "");
      await TestimonialModel.findByIdAndUpdate(id, { ...parsed.data, photoUrl, isPublished, productSkus });
      return data({ ok: true, error: null as string | null });
    }

    await TestimonialModel.create({ ...parsed.data, photoUrl: uploadedPhotoUrl ?? "", isPublished, productSkus });
    return data({ ok: true, error: null as string | null });
  }

  if (intent === "toggle-published") {
    const id = String(formData.get("id"));
    const isPublished = formData.get("isPublished") === "true";
    await TestimonialModel.findByIdAndUpdate(id, { isPublished });
    return data({ ok: true, error: null as string | null });
  }

  if (intent === "delete") {
    await TestimonialModel.findByIdAndDelete(String(formData.get("id")));
    return data({ ok: true, error: null as string | null });
  }

  return data({ ok: false, error: "Acción no reconocida." }, { status: 400 });
}

type Testimonial = ReturnType<typeof useLoaderData<typeof loader>>["testimonials"][number];

function TestimonialFormFields({ defaults, taggable }: { defaults?: Testimonial; taggable: { sku: string; name: string }[] }) {
  return (
    <>
      <Field label="Nombre del cliente" htmlFor="customerName">
        <input id="customerName" name="customerName" type="text" required defaultValue={defaults?.customerName} placeholder="María G." className={inputClass} />
      </Field>
      <Field label="Testimonio" htmlFor="quote">
        <textarea id="quote" name="quote" rows={3} required defaultValue={defaults?.quote} placeholder="Lo que dijo tu cliente, tal cual." className={inputClass} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Calificación (1-5)" htmlFor="rating">
          <input id="rating" name="rating" type="number" min={1} max={5} defaultValue={defaults?.rating ?? 5} className={inputClass} />
        </Field>
        <Field label="Foto del cliente (opcional)" htmlFor="photo">
          <input id="photo" name="photo" type="file" accept="image/*" className={inputClass} />
        </Field>
      </div>
      {defaults?.photoUrl && (
        <div className="flex items-center gap-2">
          <img src={defaults.photoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
          <label className="flex min-h-11 items-center gap-2 text-xs text-carbon/60">
            <input type="checkbox" name="removePhoto" className="h-5 w-5 shrink-0 accent-red-500" />
            Quitar foto actual
          </label>
        </div>
      )}
      {taggable.length > 0 && (
        <fieldset className="min-w-0">
          <legend className="text-sm font-semibold text-carbon">Mostrar también en la página de (opcional)</legend>
          <p className="mt-1 text-xs text-carbon/50">
            Cada producto muestra sus 3 testimonios más recientes. Sin marcar, solo aparece en la sección general del inicio.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {taggable.map((item) => (
              <label
                key={item.sku}
                className="flex min-h-11 min-w-0 max-w-full cursor-pointer items-center gap-2 break-words rounded-full border border-carbon/15 px-4 text-sm text-carbon has-[:checked]:border-lima has-[:checked]:bg-lima/15"
              >
                <input
                  type="checkbox"
                  name="productSkus"
                  value={item.sku}
                  defaultChecked={defaults?.productSkus.includes(item.sku)}
                  className="h-5 w-5 shrink-0 accent-lima"
                />
                {item.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-carbon">
        <input type="checkbox" name="isPublished" defaultChecked={defaults?.isPublished ?? false} className="h-5 w-5 shrink-0 accent-lima" />
        Publicar en el sitio {defaults ? "" : "de inmediato"}
      </label>
    </>
  );
}

export default function AdminTestimonials() {
  const { testimonials, taggable } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isCreating = navigation.state !== "idle" && navigation.formData?.get("intent") === "create";
  const publishedCount = testimonials.filter((t) => t.isPublished).length;
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="min-w-0">
      <h1 className="font-display text-2xl sm:text-3xl font-black text-carbon">Testimonios</h1>
      <p className="mt-1 text-sm text-carbon/60">
        {testimonials.length} en total · {publishedCount} publicados en el sitio. Solo captura reseñas
        reales que te hayan dado tus clientes — nunca se generan aquí.
      </p>

      <Form method="post" encType="multipart/form-data" className="mt-6 flex flex-col gap-4 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
        <input type="hidden" name="intent" value="create" />
        <h2 className="font-display text-lg font-bold text-carbon">Agregar testimonio</h2>
        <TestimonialFormFields taggable={taggable} />
        {actionData?.error && <p className="text-sm font-semibold text-red-600">{actionData.error}</p>}
        <button
          type="submit"
          disabled={isCreating}
          className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60 sm:w-auto sm:self-start"
        >
          {isCreating ? "Guardando…" : "Agregar testimonio"}
        </button>
      </Form>

      {testimonials.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-carbon/20 p-5 sm:p-8 text-center text-carbon/50">
          Todavía no hay testimonios capturados.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {testimonials.map((t) => (
            <li key={t.id} className="min-w-0 rounded-2xl border border-carbon/10 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  {t.photoUrl && <img src={t.photoUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />}
                  <div className="min-w-0">
                    <p className="font-display font-bold text-carbon">
                      {t.customerName} <span className="ml-1 text-carbon/50"><StarRating rating={t.rating} className="h-3.5 w-3.5" /></span>
                    </p>
                    <p className="mt-1 break-words text-sm text-carbon/70">{t.quote}</p>
                    {t.productSkus.length > 0 && (
                      <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
                        {t.productSkus.map((sku) => (
                          <span key={sku} className="rounded-full bg-bosque/10 px-2 py-0.5 font-semibold text-bosque">
                            {taggable.find((item) => item.sku === sku)?.name ?? sku}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:flex lg:shrink-0">
                  <Form method="post" className="contents">
                    <input type="hidden" name="intent" value="toggle-published" />
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="isPublished" value={(!t.isPublished).toString()} />
                    <button
                      type="submit"
                      className={`min-h-11 w-full rounded-full border px-3 text-xs font-semibold sm:w-auto ${
                        t.isPublished ? "border-lima bg-lima/20 text-bosque" : "border-carbon/15 text-carbon/60"
                      }`}
                    >
                      {t.isPublished ? "Publicado" : "Publicar"}
                    </button>
                  </Form>
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === t.id ? null : t.id)}
                    className="min-h-11 w-full rounded-full border border-carbon/15 px-3 text-xs font-semibold text-carbon/60 hover:border-carbon/30 sm:w-auto"
                  >
                    {editingId === t.id ? "Cerrar" : "Editar"}
                  </button>
                  <Form method="post" className="contents" onSubmit={(e) => { if (!confirm(`¿Eliminar el testimonio de ${t.customerName}?`)) e.preventDefault(); }}>
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-3 text-xs font-semibold text-carbon/60 hover:border-red-300 hover:text-red-600 w-full sm:w-auto">
                      Eliminar
                    </button>
                  </Form>
                </div>
              </div>

              {editingId === t.id && (
                <Form method="post" encType="multipart/form-data" className="mt-4 flex min-w-0 flex-col gap-4 rounded-2xl border border-dashed border-carbon/20 p-3 sm:p-4">
                  <input type="hidden" name="intent" value="update" />
                  <input type="hidden" name="id" value={t.id} />
                  <TestimonialFormFields defaults={t} taggable={taggable} />
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
