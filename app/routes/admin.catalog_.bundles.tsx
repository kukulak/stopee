import type { LoaderFunctionArgs } from "react-router";
import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useMemo, useState } from "react";
import { connectDB } from "~/lib/db.server";
import { ProductModel } from "~/models/product.server";
import { BundleModel } from "~/models/bundle.server";
import { computeBundlePrice } from "~/lib/pricing";
import { collectMediaFromForm } from "~/lib/media.server";
import { parseCatalogFormData } from "~/lib/upload.server";
import { generateUniqueBundleSku } from "~/lib/catalog.server";
import { slugify } from "~/lib/slug";
import { Field, inputClass, MediaGallery, AddMediaForm } from "~/components/admin/MediaFields";
import { ArrowLink } from "~/components/ui/ArrowLink";
import { StarNote } from "~/components/admin/StarNote";
import { clearFeatured, getCurrentStarName, toggleFeatured } from "~/lib/featured.server";
import { requireAdmin } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Paquetes — Admin STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const [products, bundles, currentStarName] = await Promise.all([
    ProductModel.find().sort({ createdAt: -1 }).lean(),
    BundleModel.find().sort({ createdAt: -1 }).populate("products.product").lean(),
    getCurrentStarName(),
  ]);

  return data({
    currentStarName,
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
      isFeatured: b.isFeatured ?? false,
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
  await requireAdmin(request);
  await connectDB();
  const formData = await parseCatalogFormData(request);
  const intent = formData.get("intent");

  if (intent === "create-bundle" || intent === "update-bundle") {
    const name = String(formData.get("bundleName") ?? "").trim();
    if (!name) {
      return data({ ok: false as const, error: "Ponle un nombre al paquete." }, { status: 400 });
    }

    const selected = readBundleRows(formData);
    if (selected.length === 0) {
      return data(
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

    const isFeatured = formData.get("isFeatured") === "on";
    if (isFeatured) await clearFeatured(intent === "update-bundle" ? String(formData.get("id")) : undefined);

    if (intent === "update-bundle") {
      const id = String(formData.get("id"));
      await BundleModel.findByIdAndUpdate(id, { name, bundlePrice, products: bundleProducts, isFeatured });
      return data({ ok: true as const, error: null });
    }

    const sku = await generateUniqueBundleSku(name, slugify);
    const { images, videos } = collectMediaFromForm(formData);
    await BundleModel.create({ name, sku, bundlePrice, images, videos, products: bundleProducts, isFeatured });
    return data({ ok: true as const, error: null });
  }

  if (intent === "add-media-bundle") {
    const id = String(formData.get("id"));
    const { images, videos } = collectMediaFromForm(formData);
    if (images.length === 0 && videos.length === 0) {
      return data({ ok: false as const, error: "Elige al menos un archivo o pega una URL." }, { status: 400 });
    }
    await BundleModel.findByIdAndUpdate(id, { $push: { images: { $each: images }, videos: { $each: videos } } });
    return data({ ok: true as const, error: null });
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
    return data({ ok: true as const, error: null });
  }

  if (intent === "toggle-bundle-featured") {
    await toggleFeatured("bundle", String(formData.get("id")));
    return data({ ok: true as const, error: null });
  }

  if (intent === "toggle-bundle-active") {
    const bundle = await BundleModel.findById(String(formData.get("id")));
    if (bundle) {
      bundle.isActive = !bundle.isActive;
      await bundle.save();
    }
    return data({ ok: true as const, error: null });
  }

  if (intent === "delete-bundle") {
    await BundleModel.findByIdAndDelete(String(formData.get("id")));
    return data({ ok: true as const, error: null });
  }

  return data({ ok: false as const, error: "Acción no reconocida." }, { status: 400 });
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
      className="mt-4 flex flex-col gap-5 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6"
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
              className="grid grid-cols-1 items-center gap-2 rounded-xl border border-carbon/10 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
            >
              <span className="min-w-0 break-words text-sm font-medium text-carbon">
                {p.name} <span className="text-carbon/40">(${p.price})</span>
              </span>
              <input type="hidden" name="productId" value={p.id} />
              <label className="flex min-h-11 items-center gap-2 text-xs text-carbon/60">
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
              <label className="flex min-h-11 items-center gap-2 text-xs text-carbon/60">
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

      <label className="flex min-h-11 items-start gap-3 text-sm font-medium text-carbon">
        <input type="checkbox" name="isFeatured" defaultChecked={defaults?.isFeatured ?? false} className="mt-0.5 h-5 w-5 shrink-0 accent-lima" />
        Paquete estrella (destacado arriba del catálogo en /tienda; al marcarlo, la estrella actual se desmarca sola)
      </label>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 w-full rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60 sm:w-auto sm:self-start"
        >
          {submitting ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear paquete"}
        </button>
        {isEdit && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-full border border-carbon/15 px-6 text-sm font-semibold text-carbon hover:border-carbon/30 w-full sm:w-auto"
          >
            Cancelar
          </button>
        )}
      </div>
    </Form>
  );
}

export default function AdminCatalogBundles() {
  const { products, bundles, currentStarName } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submittingIntent = navigation.state !== "idle" ? navigation.formData?.get("intent") : null;
  const [expandedMediaFor, setExpandedMediaFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <ArrowLink to="/admin/catalog" direction="left" className="text-sm">Volver al catálogo</ArrowLink>
      <h1 className="mt-2 font-display text-2xl sm:text-3xl font-black text-carbon">Paquetes</h1>
      <p className="mt-1 text-sm text-carbon/60">Combina productos existentes en paquetes con precio automático.</p>

      {actionData?.error && <p className="mt-4 text-sm font-semibold text-red-600">{actionData.error}</p>}

      <StarNote currentStarName={currentStarName} />

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
            <li key={b.id} className="min-w-0 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words font-display font-bold text-carbon">{b.name}</p>
                    {b.isFeatured && (
                      <span className="rounded-full bg-lima px-2 py-0.5 text-xs font-bold text-carbon">Estrella</span>
                    )}
                  </div>
                  <p className="text-sm text-carbon/60">
                    {b.products
                      .map((item) => `${item.quantity}× ${item.name}${item.discountPercentage > 0 ? ` (-${item.discountPercentage}%)` : ""}`)
                      .join(" + ")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-bosque">${b.bundlePrice.toFixed(2)} MXN — calculado automáticamente</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center lg:shrink-0">
                  <span className={`col-span-2 justify-self-start sm:col-span-1 rounded-full px-2.5 py-1 text-xs font-semibold ${b.isActive ? "bg-lima/20 text-bosque" : "bg-carbon/10 text-carbon/50"}`}>
                    {b.isActive ? "Activo" : "Inactivo"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === b.id ? null : b.id)}
                    className="min-h-11 w-full rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30 sm:w-auto"
                  >
                    {editingId === b.id ? "Cerrar" : "Editar"}
                  </button>
                  <Form method="post" className="contents">
                    <input type="hidden" name="intent" value="toggle-bundle-featured" />
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30 w-full sm:w-auto">
                      {b.isFeatured ? "Quitar estrella" : "Hacer estrella"}
                    </button>
                  </Form>
                  <Form method="post" className="contents">
                    <input type="hidden" name="intent" value="toggle-bundle-active" />
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30 w-full sm:w-auto">
                      {b.isActive ? "Desactivar" : "Activar"}
                    </button>
                  </Form>
                  <Form method="post" className="contents">
                    <input type="hidden" name="intent" value="delete-bundle" />
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-red-600 hover:border-red-300 w-full sm:w-auto">
                      Eliminar
                    </button>
                  </Form>
                </div>
              </div>

              {editingId === b.id && (
                <>
                  <BundleBuilder
                    products={products}
                    submitting={submittingIntent === "update-bundle"}
                    defaults={b}
                    onCancel={() => setEditingId(null)}
                  />
                  <div className="mt-4 rounded-2xl border border-dashed border-carbon/20 p-4">
                    <p className="text-sm font-semibold text-carbon">Fotos y video</p>
                    <MediaGallery images={b.images} videos={b.videos} removeIntent="remove-media-bundle" ownerId={b.id} />
                    <button
                      type="button"
                      onClick={() => setExpandedMediaFor(expandedMediaFor === b.id ? null : b.id)}
                      className="mt-3 min-h-11 text-sm font-semibold text-bosque hover:underline"
                    >
                      {expandedMediaFor === b.id ? "Cerrar" : "+ Agregar fotos o video"}
                    </button>
                    {expandedMediaFor === b.id && <AddMediaForm ownerId={b.id} intent="add-media-bundle" />}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
