import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { connectDB } from "~/lib/db.server";
import { ProductModel } from "~/models/product.server";
import { BundleModel } from "~/models/bundle.server";
import { computeBundlePrice } from "~/lib/pricing";
import { parseCatalogFormData, uploadedFileToPublicUrl } from "~/lib/upload.server";

export const meta: MetaFunction = () => [{ title: "Catálogo — Admin STOPee" }];

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
      sku: p.sku,
      price: p.price,
      costPrice: p.costPrice ?? 0,
      stock: p.stock,
      isAvailable: p.isAvailable,
      isIndividuallySellable: p.isIndividuallySellable ?? true,
      images: p.images ?? [],
      videos: (p.videos ?? []) as { url: string; source: string }[],
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

const productSchema = z.object({
  name: z.string().trim().min(2, "Ingresa un nombre."),
  sku: z.string().trim().min(2, "Ingresa un SKU.").toUpperCase(),
  price: z.coerce.number().min(0, "El precio no puede ser negativo."),
  costPrice: z.coerce.number().min(0, "El costo no puede ser negativo.").default(0),
  stock: z.coerce.number().min(0, "El stock no puede ser negativo.").default(0),
  description: z.string().trim().nullish().transform((v) => v ?? ""),
});

function collectMediaFromForm(formData: FormData) {
  const images = formData
    .getAll("images")
    .map((f) => uploadedFileToPublicUrl(f as File))
    .filter((url): url is string => Boolean(url));

  const videos: { url: string; source: "youtube" | "upload" }[] = [];
  const youtubeUrl = String(formData.get("videoYoutubeUrl") ?? "").trim();
  if (youtubeUrl) videos.push({ url: youtubeUrl, source: "youtube" });
  const videoFileUrl = uploadedFileToPublicUrl(formData.get("videoFile") as File | null);
  if (videoFileUrl) videos.push({ url: videoFileUrl, source: "upload" });

  return { images, videos };
}

export async function action({ request }: ActionFunctionArgs) {
  await connectDB();
  const formData = await parseCatalogFormData(request);
  const intent = formData.get("intent");

  if (intent === "create-product") {
    const parsed = productSchema.safeParse({
      name: formData.get("name"),
      sku: formData.get("sku"),
      price: formData.get("price"),
      costPrice: formData.get("costPrice"),
      stock: formData.get("stock"),
      description: formData.get("description"),
    });

    if (!parsed.success) {
      return json(
        { ok: false as const, error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
        { status: 400 },
      );
    }

    const exists = await ProductModel.findOne({ sku: parsed.data.sku });
    if (exists) {
      return json(
        { ok: false as const, error: "Ya existe un producto con ese SKU." },
        { status: 409 },
      );
    }

    const { images, videos } = collectMediaFromForm(formData);

    await ProductModel.create({
      ...parsed.data,
      images,
      videos,
      isIndividuallySellable: formData.get("isIndividuallySellable") === "on",
    });
    return json({ ok: true as const, error: null });
  }

  if (intent === "add-media-product") {
    const id = String(formData.get("id"));
    const { images, videos } = collectMediaFromForm(formData);
    if (images.length === 0 && videos.length === 0) {
      return json({ ok: false as const, error: "Elige al menos un archivo o pega una URL." }, { status: 400 });
    }
    await ProductModel.findByIdAndUpdate(id, {
      $push: { images: { $each: images }, videos: { $each: videos } },
    });
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

  if (intent === "create-bundle") {
    const name = String(formData.get("bundleName") ?? "").trim();
    const productIds = formData.getAll("productId") as string[];
    const quantities = formData.getAll("quantity") as string[];
    const discounts = formData.getAll("discountPercentage") as string[];

    if (!name) {
      return json({ ok: false as const, error: "Ponle un nombre al paquete." }, { status: 400 });
    }

    const rows = productIds.map((productId, i) => ({
      productId,
      quantity: Number(quantities[i] ?? 0),
      discountPercentage: Number(discounts[i] ?? 0),
    }));
    const selected = rows.filter((r) => r.quantity > 0);

    if (selected.length === 0) {
      return json(
        { ok: false as const, error: "Selecciona al menos un producto con cantidad mayor a 0." },
        { status: 400 },
      );
    }

    const products = await ProductModel.find({ _id: { $in: selected.map((r) => r.productId) } });
    const priceBySkuId = new Map(products.map((p) => [String(p._id), p.price]));

    const bundlePrice = computeBundlePrice(
      selected.map((r) => ({
        price: priceBySkuId.get(r.productId) ?? 0,
        quantity: r.quantity,
        discountPercentage: r.discountPercentage,
      })),
    );

    const { images, videos } = collectMediaFromForm(formData);

    await BundleModel.create({
      name,
      bundlePrice,
      images,
      videos,
      products: selected.map((r) => ({
        product: r.productId,
        quantity: r.quantity,
        discountPercentage: r.discountPercentage,
      })),
    });
    return json({ ok: true as const, error: null });
  }

  if (intent === "add-media-bundle") {
    const id = String(formData.get("id"));
    const { images, videos } = collectMediaFromForm(formData);
    if (images.length === 0 && videos.length === 0) {
      return json({ ok: false as const, error: "Elige al menos un archivo o pega una URL." }, { status: 400 });
    }
    await BundleModel.findByIdAndUpdate(id, {
      $push: { images: { $each: images }, videos: { $each: videos } },
    });
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

type LoaderProduct = {
  id: string;
  name: string;
  sku: string;
  price: number;
  costPrice: number;
  stock: number;
  isAvailable: boolean;
  isIndividuallySellable: boolean;
  images: string[];
  videos: { url: string; source: string }[];
};

export default function AdminCatalog() {
  const { products, bundles } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submittingIntent =
    navigation.state !== "idle" ? navigation.formData?.get("intent") : null;
  const [expandedMediaFor, setExpandedMediaFor] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="font-display text-2xl font-black text-carbon">Catálogo</h1>
        <p className="mt-1 text-sm text-carbon/60">Productos individuales y paquetes.</p>
      </div>

      {actionData?.error && (
        <p className="-mb-4 text-sm font-semibold text-red-600">{actionData.error}</p>
      )}

      {/* PRODUCTOS */}
      <section>
        <h2 className="font-display text-lg font-bold text-carbon">Productos</h2>

        <Form
          method="post"
          encType="multipart/form-data"
          className="mt-4 flex flex-col gap-4 rounded-3xl border border-carbon/10 bg-white p-6"
        >
          <input type="hidden" name="intent" value="create-product" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Nombre" htmlFor="name">
              <input
                id="name"
                name="name"
                required
                placeholder="STOPee Concentrado 1L"
                className={inputClass}
              />
            </Field>
            <Field label="SKU" htmlFor="sku">
              <input
                id="sku"
                name="sku"
                required
                placeholder="CONCENTRADO-1L"
                className={`${inputClass} uppercase`}
              />
            </Field>
            <Field label="Precio de venta MXN" htmlFor="price">
              <input id="price" name="price" type="number" min={0} step="0.01" required className={inputClass} />
            </Field>
            <Field label="Costo MXN" htmlFor="costPrice">
              <input
                id="costPrice"
                name="costPrice"
                type="number"
                min={0}
                step="0.01"
                defaultValue={0}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-carbon/50">Para calcular margen neto.</p>
            </Field>
            <Field label="Stock" htmlFor="stock">
              <input id="stock" name="stock" type="number" min={0} defaultValue={0} className={inputClass} />
            </Field>
            <Field label="Fotos" htmlFor="images">
              <input id="images" name="images" type="file" accept="image/*" multiple className={inputClass} />
            </Field>
            <Field label="Video de YouTube (opcional)" htmlFor="videoYoutubeUrl">
              <input
                id="videoYoutubeUrl"
                name="videoYoutubeUrl"
                type="url"
                placeholder="https://youtube.com/watch?v=..."
                className={inputClass}
              />
            </Field>
            <Field label="O sube un video (opcional)" htmlFor="videoFile">
              <input id="videoFile" name="videoFile" type="file" accept="video/*" className={inputClass} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-carbon">
            <input
              type="checkbox"
              name="isIndividuallySellable"
              defaultChecked
              className="h-5 w-5 accent-lima"
            />
            Se vende de forma individual en la tienda
          </label>
          <p className="-mt-3 text-xs text-carbon/50">
            Desmárcalo para artículos que solo existen para ir dentro de un paquete (por ejemplo,
            un squishable de regalo más chico que nunca se vende suelto).
          </p>

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
                      <span className="rounded-full bg-carbon/5 px-2 py-0.5 text-xs text-carbon/50">
                        {p.sku}
                      </span>
                      {!p.isIndividuallySellable && (
                        <span className="rounded-full bg-oliva/15 px-2 py-0.5 text-xs font-semibold text-oliva">
                          No para venta individual
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-carbon/60">
                      Precio ${p.price} · Costo ${p.costPrice} · Margen $
                      {(p.price - p.costPrice).toFixed(2)} · Stock {p.stock}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        p.isAvailable ? "bg-lima/20 text-bosque" : "bg-carbon/10 text-carbon/50"
                      }`}
                    >
                      {p.isAvailable ? "Disponible" : "Pausado"}
                    </span>
                    <Form method="post">
                      <input type="hidden" name="intent" value="toggle-product-available" />
                      <input type="hidden" name="id" value={p.id} />
                      <button
                        type="submit"
                        className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30"
                      >
                        {p.isAvailable ? "Pausar" : "Activar"}
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete-product" />
                      <input type="hidden" name="id" value={p.id} />
                      <button
                        type="submit"
                        className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-red-600 hover:border-red-300"
                      >
                        Eliminar
                      </button>
                    </Form>
                  </div>
                </div>

                <MediaGallery
                  images={p.images}
                  videos={p.videos}
                  removeIntent="remove-media-product"
                  ownerId={p.id}
                />

                <button
                  type="button"
                  onClick={() => setExpandedMediaFor(expandedMediaFor === p.id ? null : p.id)}
                  className="mt-3 min-h-11 text-sm font-semibold text-bosque hover:underline"
                >
                  {expandedMediaFor === p.id ? "Cerrar" : "+ Agregar fotos o video"}
                </button>

                {expandedMediaFor === p.id && (
                  <AddMediaForm ownerId={p.id} intent="add-media-product" />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* PAQUETES */}
      <section>
        <h2 className="font-display text-lg font-bold text-carbon">Paquetes</h2>

        {products.length === 0 ? (
          <p className="mt-4 text-sm text-carbon/60">
            Agrega al menos un producto para poder armar paquetes.
          </p>
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
                        .map(
                          (item) =>
                            `${item.quantity}× ${item.name}${
                              item.discountPercentage > 0 ? ` (-${item.discountPercentage}%)` : ""
                            }`,
                        )
                        .join(" + ")}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-bosque">
                      ${b.bundlePrice.toFixed(2)} MXN — calculado automáticamente
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        b.isActive ? "bg-lima/20 text-bosque" : "bg-carbon/10 text-carbon/50"
                      }`}
                    >
                      {b.isActive ? "Activo" : "Inactivo"}
                    </span>
                    <Form method="post">
                      <input type="hidden" name="intent" value="toggle-bundle-active" />
                      <input type="hidden" name="id" value={b.id} />
                      <button
                        type="submit"
                        className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30"
                      >
                        {b.isActive ? "Desactivar" : "Activar"}
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete-bundle" />
                      <input type="hidden" name="id" value={b.id} />
                      <button
                        type="submit"
                        className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-red-600 hover:border-red-300"
                      >
                        Eliminar
                      </button>
                    </Form>
                  </div>
                </div>

                <MediaGallery
                  images={b.images}
                  videos={b.videos}
                  removeIntent="remove-media-bundle"
                  ownerId={b.id}
                />

                <button
                  type="button"
                  onClick={() => setExpandedMediaFor(expandedMediaFor === b.id ? null : b.id)}
                  className="mt-3 min-h-11 text-sm font-semibold text-bosque hover:underline"
                >
                  {expandedMediaFor === b.id ? "Cerrar" : "+ Agregar fotos o video"}
                </button>

                {expandedMediaFor === b.id && (
                  <AddMediaForm ownerId={b.id} intent="add-media-bundle" />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const inputClass =
  "mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-carbon">
        {label}
      </label>
      {children}
    </div>
  );
}

function MediaGallery({
  images,
  videos,
  removeIntent,
  ownerId,
}: {
  images: string[];
  videos: { url: string; source: string }[];
  removeIntent: "remove-media-product" | "remove-media-bundle";
  ownerId: string;
}) {
  if (images.length === 0 && videos.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-3">
      {images.map((url) => (
        <div key={url} className="group relative h-20 w-20 overflow-hidden rounded-xl border border-carbon/10">
          <img src={url} alt="" className="h-full w-full object-cover" />
          <RemoveMediaButton removeIntent={removeIntent} ownerId={ownerId} mediaType="image" value={url} />
        </div>
      ))}
      {videos.map((v) => (
        <div
          key={v.url}
          className="group relative flex h-20 w-32 items-center justify-center overflow-hidden rounded-xl border border-carbon/10 bg-carbon/5 px-2 text-center text-xs text-carbon/60"
        >
          <span className="line-clamp-3">{v.source === "youtube" ? "▶ YouTube" : "▶ Video"}</span>
          <RemoveMediaButton removeIntent={removeIntent} ownerId={ownerId} mediaType="video" value={v.url} />
        </div>
      ))}
    </div>
  );
}

function RemoveMediaButton({
  removeIntent,
  ownerId,
  mediaType,
  value,
}: {
  removeIntent: string;
  ownerId: string;
  mediaType: "image" | "video";
  value: string;
}) {
  return (
    <Form method="post" className="absolute inset-0 flex items-start justify-end p-1 opacity-0 transition-opacity group-hover:opacity-100">
      <input type="hidden" name="intent" value={removeIntent} />
      <input type="hidden" name="id" value={ownerId} />
      <input type="hidden" name="mediaType" value={mediaType} />
      <input type="hidden" name="value" value={value} />
      <button
        type="submit"
        aria-label="Quitar"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-carbon/80 text-xs font-bold text-hueso"
      >
        ×
      </button>
    </Form>
  );
}

function AddMediaForm({ ownerId, intent }: { ownerId: string; intent: string }) {
  return (
    <Form
      method="post"
      encType="multipart/form-data"
      className="mt-3 flex flex-col gap-3 rounded-2xl border border-dashed border-carbon/20 p-4 sm:flex-row sm:items-end"
    >
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={ownerId} />
      <Field label="Fotos" htmlFor={`images-${ownerId}`}>
        <input id={`images-${ownerId}`} name="images" type="file" accept="image/*" multiple className={inputClass} />
      </Field>
      <Field label="Video de YouTube" htmlFor={`yt-${ownerId}`}>
        <input id={`yt-${ownerId}`} name="videoYoutubeUrl" type="url" placeholder="https://youtube.com/..." className={inputClass} />
      </Field>
      <Field label="O sube un video" htmlFor={`vf-${ownerId}`}>
        <input id={`vf-${ownerId}`} name="videoFile" type="file" accept="video/*" className={inputClass} />
      </Field>
      <button
        type="submit"
        className="min-h-11 shrink-0 rounded-full bg-carbon px-5 text-sm font-bold text-hueso"
      >
        Agregar
      </button>
    </Form>
  );
}

function BundleBuilder({
  products,
  submitting,
}: {
  products: LoaderProduct[];
  submitting: boolean;
}) {
  const [rows, setRows] = useState<Record<string, { quantity: number; discountPercentage: number }>>(
    () => Object.fromEntries(products.map((p) => [p.id, { quantity: 0, discountPercentage: 0 }])),
  );

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
    () =>
      products.reduce((sum, p) => sum + p.price * (rows[p.id]?.quantity ?? 0), 0),
    [products, rows],
  );

  function updateRow(id: string, patch: Partial<{ quantity: number; discountPercentage: number }>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  return (
    <Form
      method="post"
      encType="multipart/form-data"
      className="mt-4 flex flex-col gap-5 rounded-3xl border border-carbon/10 bg-white p-6"
    >
      <input type="hidden" name="intent" value="create-bundle" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nombre del paquete" htmlFor="bundleName">
          <input
            id="bundleName"
            name="bundleName"
            required
            placeholder="Pack Básico Urbano"
            className={inputClass}
          />
        </Field>
        <Field label="Fotos del paquete" htmlFor="bundleImages">
          <input id="bundleImages" name="images" type="file" accept="image/*" multiple className={inputClass} />
        </Field>
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
                = $
                {(
                  p.price *
                  (rows[p.id]?.quantity ?? 0) *
                  (1 - (rows[p.id]?.discountPercentage ?? 0) / 100)
                ).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Video de YouTube (opcional)" htmlFor="bundleYt">
          <input id="bundleYt" name="videoYoutubeUrl" type="url" placeholder="https://youtube.com/..." className={inputClass} />
        </Field>
        <Field label="O sube un video (opcional)" htmlFor="bundleVf">
          <input id="bundleVf" name="videoFile" type="file" accept="video/*" className={inputClass} />
        </Field>
      </div>

      <div className="rounded-2xl bg-bosque/5 p-4">
        <p className="text-sm text-carbon/70">
          Precio de lista (sin descuento): <span className="font-semibold">${rawTotal.toFixed(2)} MXN</span>
        </p>
        <p className="font-display text-xl font-black text-carbon">
          Precio final del paquete: ${total.toFixed(2)} MXN
        </p>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="min-h-11 self-start rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60"
      >
        {submitting ? "Creando…" : "Crear paquete"}
      </button>
    </Form>
  );
}
