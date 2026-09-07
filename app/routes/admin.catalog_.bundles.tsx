import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useMemo, useState } from "react";
import { connectDB } from "~/lib/db.server";
import { ProductModel } from "~/models/product.server";
import { BundleModel } from "~/models/bundle.server";
import { computeBundlePrice } from "~/lib/pricing";
import { collectMediaFromForm } from "~/lib/media.server";
import { parseCatalogFormData } from "~/lib/upload.server";
import { Field, inputClass, MediaGallery, AddMediaForm } from "~/components/admin/MediaFields";

export const meta: MetaFunction = () => [{ title: "Paquetes — Admin STOPee" }];

export async function loader() {
  await connectDB();
  const [products, bundles] = await Promise.all([
    ProductModel.find().sort({ createdAt: -1 }).lean(),
    BundleModel.find().sort({ createdAt: -1 }).populate("products.product").lean(),
  ]);

  return json({
    products: products.map((p) => ({
      id: String(p._id),
      name: p.name,
      price: p.price,
    })),
    bundles: bundles.map((b) => ({
      id: String(b._id),
      name: b.name,
      bundlePrice: b.bundlePrice,
      isActive: b.isActive,
      images: b.images ?? [],
      videos: (b.videos ?? []) as { url: string; source: string }[],
      products: (
        b.products as unknown as {
          product: { _id: unknown; name: string; price: number } | null;
          quantity: number;
          discountPercentage: number;
        }[]
      )
        .filter((item) => item.product)
        .map((item) => ({
          id: String(item.product!._id),
          name: item.product!.name,
          price: item.product!.price,
          quantity: item.quantity,
          discountPercentage: item.discountPercentage,
        })),
    })),
  });
}

function readBundleRows(formData: FormData) {
  const productIds = formData.getAll("productId") as string[];
  const quantities = formData.getAll("quantity") as string[];
  const discounts = formData.getAll("discountPercentage") as string[];

  const rows = productIds.map((productId, i) => ({
    productId,
    quantity: Number(quantities[i] ?? 0),
    discountPercentage: Number(discounts[i] ?? 0),
  }));
  return rows.filter((r) => r.quantity > 0);
}

export async function action({ request }: ActionFunctionArgs) {
  await connectDB();
  const formData = await parseCatalogFormData(request);
  const intent = formData.get("intent");

  if (intent === "create-bundle" || intent === "update-bundle") {
    const name = String(formData.get("bundleName") ?? "").trim();
    if (!name) {
      return json({ ok: false as const, error: "Ponle un nombre al paquete." }, { status: 400 });
    }

    const selected = readBundleRows(formData);
    if (selected.length === 0) {
      return json(
        { ok: false as const, error: "Selecciona al menos un producto con cantidad mayor a 0." },
        { status: 400 },
      );
    }

    const products = await ProductModel.find({ _id: { $in: selected.map((r) => r.productId) } });
    const priceById = new Map(products.map((p) => [String(p._id), p.price]));

    const bundlePrice = computeBundlePrice(
      selected.map((r) => ({
        price: priceById.get(r.productId) ?? 0,
        quantity: r.quantity,
        discountPercentage: r.discountPercentage,
      })),
    );

    const bundleProducts = selected.map((r) => ({
      product: r.productId,
      quantity: r.quantity,
      discountPercentage: r.discountPercentage,
    }));

    if (intent === "update-bundle") {
      const id = String(formData.get("id"));
      await BundleModel.findByIdAndUpdate(id, { name, bundlePrice, products: bundleProducts });
      return json({ ok: true as const, error: null });
    }

    const { images, videos } = collectMediaFromForm(formData);
    await BundleModel.create({ name, bundlePrice, images, videos, products: bundleProducts });
    return json({ ok: true as const, error: null });
  }

  if (intent === "add-media-bundle") {
    const id = String(formData.get("id"));
    const { images, videos } = collectMediaFromForm(formData);
    if (images.length === 0 && videos.length === 0) {
      return json({ ok: false as const, error: "Elige al menos un archivo o pega una URL." }, { status: 400 });
    }
    await BundleModel.findByIdAndUpdate(id, { $push: { images: { $each: images }, videos: { $each: videos } } });
    return json({ ok: true as const, error: null });
  }

  if (intent === "remove-media-bundle") {
    const id = String(formData.get("id"));
    const mediaType = formData.get("mediaType");
    const value = String(formData.get("value"));
    if (mediaType === "image") {
      await BundleModel.findByIdAndUpdate(id, { $pull: { images: value } });
    } else {
      await BundleModel.findByIdAndUpdate(id, { $pull: { videos: { url: value } } });
    }
    return json({ ok: true as const, error: null });
  }

  if (intent === "toggle-bundle-active") {
    const bundle = await BundleModel.findById(String(formData.get("id")));
    if (bundle) {
      bundle.isActive = !bundle.isActive;
      await bundle.save();
    }
    return json({ ok: true as const, error: null });
  }

  if (intent === "delete-bundle") {
    await BundleModel.findByIdAndDelete(String(formData.get("id")));
    return json({ ok: true as const, error: null });
  }

  return json({ ok: false as const, error: "Acción no reconocida." }, { status: 400 });
}

type LoaderProduct = { id: string; name: string; price: number };
type LoaderBundle = ReturnType<typeof useLoaderData<typeof loader>>["bundles"][number];

function BundleBuilder({
  products,
  submitting,
  defaults,
  onCancel,
}: {
  products: LoaderProduct[];
  submitting: boolean;
  defaults?: LoaderBundle;
  onCancel?: () => void;
}) {
  const initialRows = useMemo(() => {
    const base: Record<string, { quantity: number; discountPercentage: number }> = Object.fromEntries(
      products.map((p) => [p.id, { quantity: 0, discountPercentage: 0 }]),
    );
    defaults?.products.forEach((item) => {
      base[item.id] = { quantity: item.quantity, discountPercentage: item.discountPercentage };
    });
    return base;
  }, [products, defaults]);

  const [rows, setRows] = useState(initialRows);

  const total = useMemo(() => {
    return computeBundlePrice(
      products.map((p) => ({
        price: p.price,
        quantity: rows[p.id]?.quantity ?? 0,
        discountPercentage: rows[p.id]?.discountPercentage ?? 0,
      })),
    );
  }, [products, rows]);

  const rawTotal = useMemo(
    () => products.reduce((sum, p) => sum + p.price * (rows[p.id]?.quantity ?? 0), 0),
    [products, rows],
  );

  function updateRow(id: string, patch: Partial<{ quantity: number; discountPercentage: number }>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const isEdit = Boolean(defaults);

  return (
    <Form
      method="post"
      encType={isEdit ? undefined : "multipart/form-data"}
      className="mt-4 flex flex-col gap-5 rounded-3xl border border-carbon/10 bg-white p-6"
    >
      <input type="hidden" name="intent" value={isEdit ? "update-bundle" : "create-bundle"} />
      {isEdit && <input type="hidden" name="id" value={defaults!.id} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nombre del paquete" htmlFor="bundleName">
          <input
            id="bundleName"
            name="bundleName"
            required
            defaultValue={defaults?.name}
            placeholder="Pack Básico Urbano"
            className={inputClass}
          />
        </Field>
        {!isEdit && (
          <Field label="Fotos del paquete" htmlFor="bundleImages">
            <input id="bundleImages" name="images" type="file" accept="image/*" multiple className={inputClass} />
          </Field>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold text-carbon">Productos incluidos</p>
        <p className="text-xs text-carbon/50">
          El precio se calcula solo: (precio × cantidad × (1 − % descuento)) de cada producto, sumado.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {products.map((p) => (
            <div
              key={p.id}
              className="grid grid-cols-1 items-center gap-2 rounded-xl border border-carbon/10 px-4 py-3 sm:grid-cols-[1fr_auto_auto_auto]"
            >
              <span className="text-sm font-medium text-carbon">
                {p.name} <span className="text-carbon/40">(${p.price})</span>
              </span>
              <input type="hidden" name="productId" value={p.id} />
              <label className="flex items-center gap-2 text-xs text-carbon/60">
                Cant.
                <input
                  name="quantity"
                  type="number"
                  min={0}
                  value={rows[p.id]?.quantity ?? 0}
                  onChange={(e) => updateRow(p.id, { quantity: Number(e.target.value) })}
                  className="min-h-11 w-16 rounded-lg border border-carbon/15 px-2 text-center focus:border-oliva focus:outline-none"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-carbon/60">
                Desc. %
                <input
                  name="discountPercentage"
                  type="number"
                  min={0}
                  max={100}
                  value={rows[p.id]?.discountPercentage ?? 0}
                  onChange={(e) => updateRow(p.id, { discountPercentage: Number(e.target.value) })}
                  className="min-h-11 w-16 rounded-lg border border-carbon/15 px-2 text-center focus:border-oliva focus:outline-none"
                />
              </label>
              <span className="text-right text-xs text-carbon/50 sm:text-left">
                = ${(p.price * (rows[p.id]?.quantity ?? 0) * (1 - (rows[p.id]?.discountPercentage ?? 0) / 100)).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {!isEdit && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Video de YouTube (opcional)" htmlFor="bundleYt">
            <input id="bundleYt" name="videoYoutubeUrl" type="url" placeholder="https://youtube.com/..." className={inputClass} />
          </Field>
          <Field label="O sube un video (opcional)" htmlFor="bundleVf">
            <input id="bundleVf" name="videoFile" type="file" accept="video/*" className={inputClass} />
          </Field>
        </div>
      )}

      <div className="rounded-2xl bg-bosque/5 p-4">
        <p className="text-sm text-carbon/70">
          Precio de lista (sin descuento): <span className="font-semibold">${rawTotal.toFixed(2)} MXN</span>
        </p>
        <p className="font-display text-xl font-black text-carbon">Precio final del paquete: ${total.toFixed(2)} MXN</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 self-start rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60"
        >
          {submitting ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear paquete"}
        </button>
        {isEdit && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-full border border-carbon/15 px-6 text-sm font-semibold text-carbon hover:border-carbon/30"
          >
            Cancelar
          </button>
        )}
      </div>
    </Form>
  );
}

export default function AdminCatalogBundles() {
  const { products, bundles } = useLoaderData<typeof loader>();
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
      <h1 className="mt-2 font-display text-2xl font-black text-carbon">Paquetes</h1>
      <p className="mt-1 text-sm text-carbon/60">Combina productos existentes en paquetes con precio automático.</p>

      {actionData?.error && <p className="mt-4 text-sm font-semibold text-red-600">{actionData.error}</p>}

      {products.length === 0 ? (
        <p className="mt-4 text-sm text-carbon/60">Agrega al menos un producto para poder armar paquetes.</p>
      ) : (
        <BundleBuilder products={products} submitting={submittingIntent === "create-bundle"} />
      )}

      {bundles.length === 0 ? (
        <p className="mt-4 text-sm text-carbon/60">Todavía no hay paquetes.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {bundles.map((b) => (
            <li key={b.id} className="rounded-3xl border border-carbon/10 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display font-bold text-carbon">{b.name}</p>
                  <p className="text-sm text-carbon/60">
                    {b.products
                      .map((item) => `${item.quantity}× ${item.name}${item.discountPercentage > 0 ? ` (-${item.discountPercentage}%)` : ""}`)
                      .join(" + ")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-bosque">${b.bundlePrice.toFixed(2)} MXN — calculado automáticamente</p>
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
                    <input type="hidden" name="intent" value="toggle-bundle-active" />
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30">
                      {b.isActive ? "Desactivar" : "Activar"}
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete-bundle" />
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-red-600 hover:border-red-300">
                      Eliminar
                    </button>
                  </Form>
                </div>
              </div>

              {editingId === b.id && (
                <BundleBuilder
                  products={products}
                  submitting={submittingIntent === "update-bundle"}
                  defaults={b}
                  onCancel={() => setEditingId(null)}
                />
              )}

              <MediaGallery images={b.images} videos={b.videos} removeIntent="remove-media-bundle" ownerId={b.id} />

              <button
                type="button"
                onClick={() => setExpandedMediaFor(expandedMediaFor === b.id ? null : b.id)}
                className="mt-3 min-h-11 text-sm font-semibold text-bosque hover:underline"
              >
                {expandedMediaFor === b.id ? "Cerrar" : "+ Agregar fotos o video"}
              </button>

              {expandedMediaFor === b.id && <AddMediaForm ownerId={b.id} intent="add-media-bundle" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
