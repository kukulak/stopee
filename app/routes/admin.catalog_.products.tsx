import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { z } from "zod";
import { connectDB } from "~/lib/db.server";
import { ProductModel } from "~/models/product.server";
import { parseCatalogFormData } from "~/lib/upload.server";
import { collectMediaFromForm } from "~/lib/media.server";
import { Field, inputClass, MediaGallery, AddMediaForm } from "~/components/admin/MediaFields";
import { UNIT_OPTIONS, formatPresentation, type ProductUnit } from "~/lib/productUnit";

export const meta: MetaFunction = () => [{ title: "Productos — Admin STOPee" }];

export async function loader() {
  await connectDB();
  const products = await ProductModel.find().sort({ createdAt: -1 }).lean();
  return json({
    products: products.map((p) => ({
      id: String(p._id),
      name: p.name,
      sku: p.sku,
      price: p.price,
      costPrice: p.costPrice ?? 0,
      description: p.description ?? "",
      stock: p.stock,
      isAvailable: p.isAvailable,
      isIndividuallySellable: p.isIndividuallySellable ?? true,
      unitValue: p.unitValue ?? 1,
      unit: (p.unit ?? "pieza") as ProductUnit,
      lowStockThreshold: p.lowStockThreshold ?? 10,
      images: p.images ?? [],
      videos: (p.videos ?? []) as { url: string; source: string }[],
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
  unitValue: z.coerce.number().min(0.01, "La cantidad debe ser mayor a 0.").default(1),
  unit: z.enum(UNIT_OPTIONS.map((o) => o.value) as [ProductUnit, ...ProductUnit[]]).default("pieza"),
  lowStockThreshold: z.coerce.number().min(0, "El umbral no puede ser negativo.").default(10),
});

export async function action({ request }: ActionFunctionArgs) {
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
      unitValue: formData.get("unitValue"),
      unit: formData.get("unit"),
      lowStockThreshold: formData.get("lowStockThreshold"),
    });

    if (!parsed.success) {
      return json({ ok: false as const, error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    }

    const id = String(formData.get("id") ?? "");
    const exists = await ProductModel.findOne({
      sku: parsed.data.sku,
      ...(id ? { _id: { $ne: id } } : {}),
    });
    if (exists) {
      return json({ ok: false as const, error: "Ya existe un producto con ese SKU." }, { status: 409 });
    }

    const isIndividuallySellable = formData.get("isIndividuallySellable") === "on";

    if (intent === "update-product") {
      await ProductModel.findByIdAndUpdate(id, { ...parsed.data, isIndividuallySellable });
      return json({ ok: true as const, error: null });
    }

    const { images, videos } = collectMediaFromForm(formData);
    await ProductModel.create({ ...parsed.data, images, videos, isIndividuallySellable });
    return json({ ok: true as const, error: null });
  }

  if (intent === "add-media-product") {
    const id = String(formData.get("id"));
    const { images, videos } = collectMediaFromForm(formData);
    if (images.length === 0 && videos.length === 0) {
      return json({ ok: false as const, error: "Elige al menos un archivo o pega una URL." }, { status: 400 });
    }
    await ProductModel.findByIdAndUpdate(id, { $push: { images: { $each: images }, videos: { $each: videos } } });
    return json({ ok: true as const, error: null });
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
    return json({ ok: true as const, error: null });
  }

  if (intent === "toggle-product-available") {
    const product = await ProductModel.findById(String(formData.get("id")));
    if (product) {
      product.isAvailable = !product.isAvailable;
      await product.save();
    }
    return json({ ok: true as const, error: null });
  }

  if (intent === "delete-product") {
    await ProductModel.findByIdAndDelete(String(formData.get("id")));
    return json({ ok: true as const, error: null });
  }

  return json({ ok: false as const, error: "Acción no reconocida." }, { status: 400 });
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
      <Field label="Descripción (opcional)" htmlFor="description">
        <input id="description" name="description" defaultValue={defaults?.description} className={inputClass} />
      </Field>
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
      <label className="col-span-full flex items-center gap-2 text-sm font-medium text-carbon">
        <input type="checkbox" name="isIndividuallySellable" defaultChecked={defaults?.isIndividuallySellable ?? true} className="h-5 w-5 accent-lima" />
        Se vende de forma individual en la tienda
      </label>
      {!defaults && (
        <p className="col-span-full -mt-3 text-xs text-carbon/50">
          Desmárcalo para artículos que solo existen para ir dentro de un paquete (por ejemplo, un
          squishable de regalo más chico que nunca se vende suelto).
        </p>
      )}
    </div>
  );
}

export default function AdminCatalogProducts() {
  const { products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submittingIntent = navigation.state !== "idle" ? navigation.formData?.get("intent") : null;
  const [expandedMediaFor, setExpandedMediaFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <Link to="/admin/catalog" className="text-sm font-semibold text-bosque hover:underline">
        ← Catálogo
      </Link>
      <h1 className="mt-2 font-display text-2xl font-black text-carbon">Productos</h1>
      <p className="mt-1 text-sm text-carbon/60">Productos individuales del catálogo.</p>

      {actionData?.error && <p className="mt-4 text-sm font-semibold text-red-600">{actionData.error}</p>}

      <Form method="post" encType="multipart/form-data" className="mt-6 flex flex-col gap-4 rounded-3xl border border-carbon/10 bg-white p-6">
        <input type="hidden" name="intent" value="create-product" />
        <ProductFormFields />
        <button
          type="submit"
          disabled={submittingIntent === "create-product"}
          className="min-h-11 self-start rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60"
        >
          {submittingIntent === "create-product" ? "Agregando…" : "Agregar producto"}
        </button>
      </Form>

      {products.length === 0 ? (
        <p className="mt-4 text-sm text-carbon/60">Todavía no hay productos.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {products.map((p) => (
            <li key={p.id} className="rounded-3xl border border-carbon/10 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display font-bold text-carbon">{p.name}</p>
                    <span className="rounded-full bg-carbon/5 px-2 py-0.5 text-xs text-carbon/50">{p.sku}</span>
                    <span className="rounded-full bg-bosque/10 px-2 py-0.5 text-xs font-semibold text-bosque">
                      {formatPresentation(p.unitValue, p.unit)}
                    </span>
                    {!p.isIndividuallySellable && (
                      <span className="rounded-full bg-oliva/15 px-2 py-0.5 text-xs font-semibold text-oliva">
                        No para venta individual
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-carbon/60">
                    Precio ${p.price} · Costo ${p.costPrice} · Margen ${(p.price - p.costPrice).toFixed(2)} · Stock{" "}
                    {p.stock} · Alerta bajo {p.lowStockThreshold}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${p.isAvailable ? "bg-lima/20 text-bosque" : "bg-carbon/10 text-carbon/50"}`}>
                    {p.isAvailable ? "Disponible" : "Pausado"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                    className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30"
                  >
                    {editingId === p.id ? "Cerrar" : "Editar"}
                  </button>
                  <Form method="post">
                    <input type="hidden" name="intent" value="toggle-product-available" />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30">
                      {p.isAvailable ? "Pausar" : "Activar"}
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete-product" />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-red-600 hover:border-red-300">
                      Eliminar
                    </button>
                  </Form>
                </div>
              </div>

              {editingId === p.id && (
                <Form method="post" className="mt-4 flex flex-col gap-4 rounded-2xl border border-dashed border-carbon/20 p-4">
                  <input type="hidden" name="intent" value="update-product" />
                  <input type="hidden" name="id" value={p.id} />
                  <ProductFormFields defaults={p} />
                  <button type="submit" className="min-h-11 self-start rounded-full bg-carbon px-6 text-sm font-bold text-hueso">
                    Guardar cambios
                  </button>
                </Form>
              )}

              <MediaGallery images={p.images} videos={p.videos} removeIntent="remove-media-product" ownerId={p.id} />

              <button
                type="button"
                onClick={() => setExpandedMediaFor(expandedMediaFor === p.id ? null : p.id)}
                className="mt-3 min-h-11 text-sm font-semibold text-bosque hover:underline"
              >
                {expandedMediaFor === p.id ? "Cerrar" : "+ Agregar fotos o video"}
              </button>

              {expandedMediaFor === p.id && <AddMediaForm ownerId={p.id} intent="add-media-product" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
