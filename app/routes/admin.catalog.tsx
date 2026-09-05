import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { connectDB } from "~/lib/db.server";
import { ProductModel } from "~/models/product.server";
import { BundleModel } from "~/models/bundle.server";

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
      stock: p.stock,
      isAvailable: p.isAvailable,
    })),
    bundles: bundles.map((b) => ({
      id: String(b._id),
      name: b.name,
      bundlePrice: b.bundlePrice,
      isActive: b.isActive,
      products: (b.products as unknown as { product: { _id: unknown; name: string } | null; quantity: number }[])
        .filter((item) => item.product)
        .map((item) => ({
          name: item.product!.name,
          quantity: item.quantity,
        })),
    })),
  });
}

const productSchema = z.object({
  name: z.string().trim().min(2, "Ingresa un nombre."),
  sku: z.string().trim().min(2, "Ingresa un SKU.").toUpperCase(),
  price: z.coerce.number().min(0, "El precio no puede ser negativo."),
  stock: z.coerce.number().min(0, "El stock no puede ser negativo.").default(0),
  // FormData.get() da `null` (no `undefined`) cuando el campo no viene en
  // el formulario — z.optional() solo acepta undefined, así que sin
  // .nullish() esto rechazaba cualquier submit sin campo de descripción.
  description: z.string().trim().nullish().transform((v) => v ?? ""),
});

export async function action({ request }: ActionFunctionArgs) {
  await connectDB();
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create-product") {
    const parsed = productSchema.safeParse({
      name: formData.get("name"),
      sku: formData.get("sku"),
      price: formData.get("price"),
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

    await ProductModel.create(parsed.data);
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
    const bundlePrice = Number(formData.get("bundlePrice"));
    const productIds = formData.getAll("productId") as string[];
    const quantities = formData.getAll("quantity") as string[];

    if (!name || !Number.isFinite(bundlePrice) || bundlePrice < 0) {
      return json(
        { ok: false as const, error: "Completa el nombre y precio del paquete." },
        { status: 400 },
      );
    }

    const items = productIds
      .map((productId, i) => ({ product: productId, quantity: Number(quantities[i] ?? 0) }))
      .filter((item) => item.quantity > 0);

    if (items.length === 0) {
      return json(
        { ok: false as const, error: "Selecciona al menos un producto con cantidad mayor a 0." },
        { status: 400 },
      );
    }

    await BundleModel.create({ name, bundlePrice, products: items });
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

export default function AdminCatalog() {
  const { products, bundles } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submittingIntent =
    navigation.state !== "idle" ? navigation.formData?.get("intent") : null;

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
          className="mt-4 grid grid-cols-1 gap-4 rounded-3xl border border-carbon/10 bg-white p-6 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
        >
          <input type="hidden" name="intent" value="create-product" />
          <div>
            <label htmlFor="name" className="text-sm font-semibold text-carbon">
              Nombre
            </label>
            <input
              id="name"
              name="name"
              required
              placeholder="STOPee Concentrado 1L"
              className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="sku" className="text-sm font-semibold text-carbon">
              SKU
            </label>
            <input
              id="sku"
              name="sku"
              required
              placeholder="CONCENTRADO-1L"
              className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-3 uppercase focus:border-oliva focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="price" className="text-sm font-semibold text-carbon">
              Precio MXN
            </label>
            <input
              id="price"
              name="price"
              type="number"
              min={0}
              step="0.01"
              required
              className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="stock" className="text-sm font-semibold text-carbon">
              Stock
            </label>
            <input
              id="stock"
              name="stock"
              type="number"
              min={0}
              defaultValue={0}
              className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={submittingIntent === "create-product"}
            className="min-h-11 rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60"
          >
            {submittingIntent === "create-product" ? "Agregando…" : "Agregar producto"}
          </button>
        </Form>

        {products.length === 0 ? (
          <p className="mt-4 text-sm text-carbon/60">Todavía no hay productos.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-3xl border border-carbon/10 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-carbon/10 text-xs font-semibold uppercase tracking-wide text-carbon/50">
                <tr>
                  <th className="px-5 py-3">Nombre</th>
                  <th className="px-5 py-3">SKU</th>
                  <th className="px-5 py-3">Precio</th>
                  <th className="px-5 py-3">Stock</th>
                  <th className="px-5 py-3">Estado</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b border-carbon/5 last:border-0">
                    <td className="px-5 py-3 font-semibold text-carbon">{p.name}</td>
                    <td className="px-5 py-3 text-carbon/60">{p.sku}</td>
                    <td className="px-5 py-3 text-carbon/70">${p.price} MXN</td>
                    <td className="px-5 py-3 text-carbon/60">{p.stock}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          p.isAvailable ? "bg-lima/20 text-bosque" : "bg-carbon/10 text-carbon/50"
                        }`}
                      >
                        {p.isAvailable ? "Disponible" : "Pausado"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          <Form
            method="post"
            className="mt-4 flex flex-col gap-5 rounded-3xl border border-carbon/10 bg-white p-6"
          >
            <input type="hidden" name="intent" value="create-bundle" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="bundleName" className="text-sm font-semibold text-carbon">
                  Nombre del paquete
                </label>
                <input
                  id="bundleName"
                  name="bundleName"
                  required
                  placeholder="Pack Básico Urbano"
                  className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="bundlePrice" className="text-sm font-semibold text-carbon">
                  Precio del paquete (MXN)
                </label>
                <input
                  id="bundlePrice"
                  name="bundlePrice"
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none"
                />
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-carbon">Productos incluidos</p>
              <p className="text-xs text-carbon/50">
                Deja en 0 los productos que no formen parte del paquete.
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {products.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-carbon/10 px-4 py-2.5"
                  >
                    <span className="text-sm font-medium text-carbon">{p.name}</span>
                    <input type="hidden" name="productId" value={p.id} />
                    <input
                      name="quantity"
                      type="number"
                      min={0}
                      defaultValue={0}
                      className="min-h-11 w-20 rounded-lg border border-carbon/15 px-2 text-center focus:border-oliva focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={submittingIntent === "create-bundle"}
              className="min-h-11 self-start rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60"
            >
              {submittingIntent === "create-bundle" ? "Creando…" : "Crear paquete"}
            </button>
          </Form>
        )}

        {bundles.length === 0 ? (
          <p className="mt-4 text-sm text-carbon/60">Todavía no hay paquetes.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {bundles.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-carbon/10 bg-white p-5"
              >
                <div>
                  <p className="font-display font-bold text-carbon">{b.name}</p>
                  <p className="text-sm text-carbon/60">
                    {b.products.map((item) => `${item.quantity}× ${item.name}`).join(" + ")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-bosque">${b.bundlePrice} MXN</p>
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
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
