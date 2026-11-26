import type { LoaderFunctionArgs } from "react-router";
import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { z } from "zod";
import { connectDB } from "~/lib/db.server";
import { ProductModel } from "~/models/product.server";
import { parseCatalogFormData } from "~/lib/upload.server";
import { collectMediaFromForm } from "~/lib/media.server";
import { Field, inputClass, MediaGallery, AddMediaForm, AddPhotosForm } from "~/components/admin/MediaFields";
import { UNIT_OPTIONS, formatPresentation, type ProductUnit } from "~/lib/productUnit";
import { ArrowLink } from "~/components/ui/ArrowLink";
import { StarNote } from "~/components/admin/StarNote";
import { clearFeatured, getCurrentStarName, toggleFeatured } from "~/lib/featured.server";
import { requireAdmin } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Productos — Admin STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const [products, currentStarName] = await Promise.all([
    ProductModel.find().sort({ createdAt: -1 }).lean(),
    getCurrentStarName(),
  ]);
  return data({
    currentStarName,
    products: products.map((p) => ({
      id: String(p._id),
      name: p.name,
      sku: p.sku,
      price: p.price,
      costPrice: p.costPrice ?? 0,
      description: p.description ?? "",
      shortDescription: p.shortDescription ?? "",
      stock: p.stock,
      isAvailable: p.isAvailable,
      isFeatured: p.isFeatured ?? false,
      isSubscribable: p.isSubscribable ?? true,
      isIndividuallySellable: p.isIndividuallySellable ?? true,
      visibility: (p.visibility === "ALLY_ONLY" ? "ALLY_ONLY" : "PUBLIC") as "PUBLIC" | "ALLY_ONLY",
      unitValue: p.unitValue ?? 1,
      unit: (p.unit ?? "pieza") as ProductUnit,
      lowStockThreshold: p.lowStockThreshold ?? 10,
      images: p.images ?? [],
      videos: (p.videos ?? []) as { url: string; source: string }[],
      usageImages: p.usageImages ?? [],
    })),
  });
}

const productSchema = z.object({
  name: z.string().trim().min(2, "Ingresa un nombre."),
  sku: z.string().trim().min(2, "Ingresa un SKU.").toUpperCase(),
  price: z.coerce.number().min(0, "El precio no puede ser negativo."),
  costPrice: z.coerce.number().min(0, "El costo no puede ser negativo.").default(0),
  stock: z.coerce.number().min(0, "El stock no puede ser negativo.").default(0),
  description: z.string().trim().nullish().transform((v) => v ?? ""),
  shortDescription: z.string().trim().max(160, "La descripción secundaria no puede pasar de 160 caracteres.").nullish().transform((v) => v ?? ""),
  unitValue: z.coerce.number().min(0.01, "La cantidad debe ser mayor a 0.").default(1),
  unit: z.enum(UNIT_OPTIONS.map((o) => o.value) as [ProductUnit, ...ProductUnit[]]).default("pieza"),
  lowStockThreshold: z.coerce.number().min(0, "El umbral no puede ser negativo.").default(10),
});

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const formData = await parseCatalogFormData(request);
  const intent = formData.get("intent");

  if (intent === "create-product" || intent === "update-product") {
    const parsed = productSchema.safeParse({
      name: formData.get("name"),
      sku: formData.get("sku"),
      price: formData.get("price"),
      costPrice: formData.get("costPrice"),
      stock: formData.get("stock"),
      description: formData.get("description"),
      shortDescription: formData.get("shortDescription"),
      unitValue: formData.get("unitValue"),
      unit: formData.get("unit"),
      lowStockThreshold: formData.get("lowStockThreshold"),
    });

    if (!parsed.success) {
      return data({ ok: false as const, error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    }

    const id = String(formData.get("id") ?? "");
    const exists = await ProductModel.findOne({
      sku: parsed.data.sku,
      ...(id ? { _id: { $ne: id } } : {}),
    });
    if (exists) {
      return data({ ok: false as const, error: "Ya existe un producto con ese SKU." }, { status: 409 });
    }

    const isIndividuallySellable = formData.get("isIndividuallySellable") === "on";
    const visibility = formData.get("visibility") === "ALLY_ONLY" ? "ALLY_ONLY" : "PUBLIC";
    // Un producto solo para aliados no se destaca en la tienda ni va en el auto-envío: sería mostrárselo a todos.
    const isFeatured = visibility === "PUBLIC" && formData.get("isFeatured") === "on";
    const isSubscribable = visibility === "PUBLIC" && formData.get("isSubscribable") === "on";

    if (isFeatured) await clearFeatured(intent === "update-product" ? id : undefined);

    if (intent === "update-product") {
      await ProductModel.findByIdAndUpdate(id, { ...parsed.data, isIndividuallySellable, isFeatured, isSubscribable, visibility });
      return data({ ok: true as const, error: null });
    }

    const { images, videos } = collectMediaFromForm(formData);
    await ProductModel.create({ ...parsed.data, images, videos, isIndividuallySellable, isFeatured, isSubscribable, visibility });
    return data({ ok: true as const, error: null });
  }

  if (intent === "add-media-product") {
    const id = String(formData.get("id"));
    const { images, videos } = collectMediaFromForm(formData);
    if (images.length === 0 && videos.length === 0) {
      return data({ ok: false as const, error: "Elige al menos un archivo o pega una URL." }, { status: 400 });
    }
    await ProductModel.findByIdAndUpdate(id, { $push: { images: { $each: images }, videos: { $each: videos } } });
    return data({ ok: true as const, error: null });
  }

  if (intent === "remove-media-product") {
    const id = String(formData.get("id"));
    const mediaType = formData.get("mediaType");
    const value = String(formData.get("value"));
    if (mediaType === "image") {
      await ProductModel.findByIdAndUpdate(id, { $pull: { images: value } });
    } else {
      await ProductModel.findByIdAndUpdate(id, { $pull: { videos: { url: value } } });
    }
    return data({ ok: true as const, error: null });
  }

  if (intent === "add-usage-images-product") {
    const id = String(formData.get("id"));
    const { images } = collectMediaFromForm(formData);
    if (images.length === 0) {
      return data({ ok: false as const, error: "Elige al menos una foto." }, { status: 400 });
    }
    await ProductModel.findByIdAndUpdate(id, { $push: { usageImages: { $each: images } } });
    return data({ ok: true as const, error: null });
  }

  if (intent === "remove-usage-image-product") {
    await ProductModel.findByIdAndUpdate(String(formData.get("id")), { $pull: { usageImages: String(formData.get("value")) } });
    return data({ ok: true as const, error: null });
  }

  if (intent === "toggle-product-featured") {
    await toggleFeatured("product", String(formData.get("id")));
    return data({ ok: true as const, error: null });
  }

  if (intent === "toggle-product-available") {
    const product = await ProductModel.findById(String(formData.get("id")));
    if (product) {
      product.isAvailable = !product.isAvailable;
      await product.save();
    }
    return data({ ok: true as const, error: null });
  }

  if (intent === "delete-product") {
    await ProductModel.findByIdAndDelete(String(formData.get("id")));
    return data({ ok: true as const, error: null });
  }

  return data({ ok: false as const, error: "Acción no reconocida." }, { status: 400 });
}

type Product = ReturnType<typeof useLoaderData<typeof loader>>["products"][number];

function ProductFormFields({ defaults }: { defaults?: Product }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Nombre" htmlFor="name">
        <input id="name" name="name" required defaultValue={defaults?.name} placeholder="STOPee Concentrado 1L" className={inputClass} />
      </Field>
      <Field label="SKU" htmlFor="sku">
        <input id="sku" name="sku" required defaultValue={defaults?.sku} placeholder="CONCENTRADO-1L" className={`${inputClass} uppercase`} />
      </Field>
      <Field label="Precio de venta MXN" htmlFor="price">
        <input id="price" name="price" type="number" min={0} step="0.01" required defaultValue={defaults?.price} className={inputClass} />
      </Field>
      <Field label="Costo MXN" htmlFor="costPrice">
        <input id="costPrice" name="costPrice" type="number" min={0} step="0.01" defaultValue={defaults?.costPrice ?? 0} className={inputClass} />
        <p className="mt-1 text-xs text-carbon/50">Para calcular margen neto.</p>
      </Field>
      <Field label="Stock" htmlFor="stock">
        <input id="stock" name="stock" type="number" min={0} defaultValue={defaults?.stock ?? 0} className={inputClass} />
      </Field>
      <Field label="Cantidad" htmlFor="unitValue">
        <input id="unitValue" name="unitValue" type="number" min={0.01} step="0.01" defaultValue={defaults?.unitValue ?? 1} className={inputClass} />
      </Field>
      <Field label="Unidad" htmlFor="unit">
        <select id="unit" name="unit" defaultValue={defaults?.unit ?? "pieza"} className={inputClass}>
          {Object.entries(
            UNIT_OPTIONS.reduce<Record<string, typeof UNIT_OPTIONS[number][]>>((acc, o) => {
              (acc[o.group] ??= []).push(o);
              return acc;
            }, {}),
          ).map(([group, options]) => (
            <optgroup key={group} label={group}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="mt-1 text-xs text-carbon/50">
          Ej. 1 L para el concentrado, 500 g para un limpiador en polvo, 30 piezas para bolsas.
        </p>
      </Field>
      <Field label="Umbral de stock bajo" htmlFor="lowStockThreshold">
        <input
          id="lowStockThreshold"
          name="lowStockThreshold"
          type="number"
          min={0}
          defaultValue={defaults?.lowStockThreshold ?? 10}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-carbon/50">El dashboard avisa cuando el stock baje de este número.</p>
      </Field>
      <div className="col-span-full">
        <Field label="Descripción secundaria (tarjeta de producto)" htmlFor="shortDescription">
          <textarea
            id="shortDescription"
            name="shortDescription"
            rows={2}
            maxLength={160}
            defaultValue={defaults?.shortDescription}
            placeholder="Una frase corta: es lo único que se ve en la tarjeta de la tienda."
            className={inputClass}
          />
        </Field>
        <p className="mt-1 text-xs text-carbon/50">Máximo 160 caracteres. Si la dejas vacía, la tarjeta usa la descripción principal.</p>
      </div>
      <div className="col-span-full">
        <Field label="Descripción principal (página del producto)" htmlFor="description">
          <textarea
            id="description"
            name="description"
            rows={12}
            defaultValue={defaults?.description}
            placeholder="Todo lo que quieras contar del producto: beneficios, modo de uso, ingredientes…"
            className={`${inputClass} min-h-64 resize-y py-3 leading-relaxed`}
          />
        </Field>
        <p className="mt-1 text-xs text-carbon/50">
          Va abajo del producto, en la página completa. Puedes usar formato: ## para títulos, - para listas y **texto** para negritas.
        </p>
      </div>
      {!defaults && (
        <>
          <Field label="Fotos" htmlFor="images">
            <input id="images" name="images" type="file" accept="image/*" multiple className={inputClass} />
          </Field>
          <Field label="Video de YouTube (opcional)" htmlFor="videoYoutubeUrl">
            <input id="videoYoutubeUrl" name="videoYoutubeUrl" type="url" placeholder="https://youtube.com/watch?v=..." className={inputClass} />
          </Field>
          <Field label="O sube un video (opcional)" htmlFor="videoFile">
            <input id="videoFile" name="videoFile" type="file" accept="video/*" className={inputClass} />
          </Field>
        </>
      )}
      <Field label="¿Quién puede verlo y comprarlo?" htmlFor="visibility">
        <select id="visibility" name="visibility" defaultValue={defaults?.visibility ?? "PUBLIC"} className={inputClass}>
          <option value="PUBLIC">Público: todos los visitantes</option>
          <option value="ALLY_ONLY">Solo aliados / mayoreo: Puntos de Recarga activos</option>
        </select>
      </Field>
      <p className="col-span-full -mt-3 text-xs text-carbon/50">
        Un producto solo para aliados no aparece para nadie más (ni en la tienda, ni por su enlace, ni en el sitemap), no
        puede ser producto estrella ni ir en el auto-envío o en un paquete.
      </p>
      <label className="col-span-full flex min-h-11 items-center gap-2 text-sm font-medium text-carbon">
        <input type="checkbox" name="isIndividuallySellable" defaultChecked={defaults?.isIndividuallySellable ?? true} className="h-5 w-5 shrink-0 accent-lima" />
        Se vende de forma individual en la tienda
      </label>
      {!defaults && (
        <p className="col-span-full -mt-3 text-xs text-carbon/50">
          Desmárcalo para artículos que solo existen para ir dentro de un paquete (por ejemplo, un
          botella aplicadora de regalo más chica que nunca se vende suelto).
        </p>
      )}
      <label className="col-span-full flex min-h-11 items-center gap-2 text-sm font-medium text-carbon">
        <input type="checkbox" name="isFeatured" defaultChecked={defaults?.isFeatured ?? false} className="h-5 w-5 shrink-0 accent-lima" />
        Producto estrella (destacado arriba del catálogo en /tienda; al marcarlo, la estrella actual se desmarca sola)
      </label>
      <label className="col-span-full flex min-h-11 items-center gap-2 text-sm font-medium text-carbon">
        <input type="checkbox" name="isSubscribable" defaultChecked={defaults?.isSubscribable ?? true} className="h-5 w-5 shrink-0 accent-lima" />
        Se puede incluir en el auto-envío periódico
      </label>
    </div>
  );
}

export default function AdminCatalogProducts() {
  const { products, currentStarName } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submittingIntent = navigation.state !== "idle" ? navigation.formData?.get("intent") : null;
  const [expandedMediaFor, setExpandedMediaFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <ArrowLink to="/admin/catalog" direction="left" className="text-sm">Volver al catálogo</ArrowLink>
      <h1 className="mt-2 font-display text-2xl sm:text-3xl font-black text-carbon">Productos</h1>
      <p className="mt-1 text-sm text-carbon/60">Productos individuales del catálogo.</p>

      <StarNote currentStarName={currentStarName} />

      {actionData?.error && <p className="mt-4 text-sm font-semibold text-red-600">{actionData.error}</p>}

      <Form method="post" encType="multipart/form-data" className="mt-6 flex flex-col gap-4 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
        <input type="hidden" name="intent" value="create-product" />
        <ProductFormFields />
        <button
          type="submit"
          disabled={submittingIntent === "create-product"}
          className="min-h-11 w-full rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60 sm:w-auto sm:self-start"
        >
          {submittingIntent === "create-product" ? "Agregando…" : "Agregar producto"}
        </button>
      </Form>

      {products.length === 0 ? (
        <p className="mt-4 text-sm text-carbon/60">Todavía no hay productos.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {products.map((p) => (
            <li key={p.id} className="min-w-0 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words font-display font-bold text-carbon">{p.name}</p>
                    <span className="rounded-full bg-carbon/5 px-2 py-0.5 text-xs text-carbon/50">{p.sku}</span>
                    <span className="rounded-full bg-bosque/10 px-2 py-0.5 text-xs font-semibold text-bosque">
                      {formatPresentation(p.unitValue, p.unit)}
                    </span>
                    {!p.isIndividuallySellable && (
                      <span className="rounded-full bg-oliva/15 px-2 py-0.5 text-xs font-semibold text-oliva">
                        No para venta individual
                      </span>
                    )}
                    {p.isFeatured && (
                      <span className="rounded-full bg-lima px-2 py-0.5 text-xs font-bold text-carbon">Estrella</span>
                    )}
                    {p.visibility === "ALLY_ONLY" && (
                      <span className="rounded-full bg-carbon px-2 py-0.5 text-xs font-bold text-hueso">Solo aliados</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-carbon/60">
                    Precio ${p.price} · Costo ${p.costPrice} · Margen ${(p.price - p.costPrice).toFixed(2)} · Stock{" "}
                    {p.stock} · Alerta bajo {p.lowStockThreshold}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center lg:shrink-0">
                  <span className={`col-span-2 justify-self-start sm:col-span-1 rounded-full px-2.5 py-1 text-xs font-semibold ${p.isAvailable ? "bg-lima/20 text-bosque" : "bg-carbon/10 text-carbon/50"}`}>
                    {p.isAvailable ? "Disponible" : "Pausado"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                    className="min-h-11 w-full rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30 sm:w-auto"
                  >
                    {editingId === p.id ? "Cerrar" : "Editar"}
                  </button>
                  <Form method="post" className="contents">
                    <input type="hidden" name="intent" value="toggle-product-featured" />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30 w-full sm:w-auto">
                      {p.isFeatured ? "Quitar estrella" : "Hacer estrella"}
                    </button>
                  </Form>
                  <Form method="post" className="contents">
                    <input type="hidden" name="intent" value="toggle-product-available" />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30 w-full sm:w-auto">
                      {p.isAvailable ? "Pausar" : "Activar"}
                    </button>
                  </Form>
                  <Form method="post" className="contents">
                    <input type="hidden" name="intent" value="delete-product" />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-red-600 hover:border-red-300 w-full sm:w-auto">
                      Eliminar
                    </button>
                  </Form>
                </div>
              </div>

              {editingId === p.id && (
                <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-dashed border-carbon/20 p-4">
                  <Form method="post" className="flex flex-col gap-4">
                    <input type="hidden" name="intent" value="update-product" />
                    <input type="hidden" name="id" value={p.id} />
                    <ProductFormFields defaults={p} />
                    <button type="submit" className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso sm:w-auto sm:self-start">
                      Guardar cambios
                    </button>
                  </Form>

                  <div className="border-t border-carbon/10 pt-4">
                    <p className="text-sm font-semibold text-carbon">Fotos y video</p>
                    <MediaGallery images={p.images} videos={p.videos} removeIntent="remove-media-product" ownerId={p.id} />
                    <button
                      type="button"
                      onClick={() => setExpandedMediaFor(expandedMediaFor === p.id ? null : p.id)}
                      className="mt-3 min-h-11 text-sm font-semibold text-bosque hover:underline"
                    >
                      {expandedMediaFor === p.id ? "Cerrar" : "+ Agregar fotos o video"}
                    </button>
                    {expandedMediaFor === p.id && <AddMediaForm ownerId={p.id} intent="add-media-product" />}
                  </div>

                  <div className="border-t border-carbon/10 pt-4">
                    <p className="text-sm font-semibold text-carbon">Fotos de uso (cómo se usa)</p>
                    <p className="mt-1 text-xs text-carbon/50">
                      Aparecen en la sección “Así se usa” de la página del producto. Las fotos de arriba son las del producto.
                      Sin fotos aquí, la sección no se muestra.
                    </p>
                    <MediaGallery images={p.usageImages} videos={[]} removeIntent="remove-usage-image-product" ownerId={p.id} />
                    <AddPhotosForm ownerId={p.id} intent="add-usage-images-product" label="Agregar fotos de uso" />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
