import { connectDB } from "~/lib/db.server";
import { ProductModel, type ProductDoc } from "~/models/product.server";
import { BundleModel } from "~/models/bundle.server";

export type CatalogItem = {
  sku: string;
  name: string;
  shortDescription: string;
  longDescription: string;
  priceMxn: number;
  image: string | null;
  images: string[];
  videos: { url: string; source: string }[];
  /** Fotos de cómo se usa (sección "Así se usa" de la página del producto). */
  usageImages: string[];
  unitValue?: number;
  unit?: string;
  kind: "product" | "bundle";
  isFeatured: boolean;
  /** Si se puede armar como parte de una caja de auto-envío periódico — solo aplica a productos individuales, nunca a paquetes. */
  isSubscribable: boolean;
  /** "ALLY_ONLY": solo lo ve y compra un Punto de Recarga activo (precio de aliado). */
  visibility: "PUBLIC" | "ALLY_ONLY";
  /** Unidades que se pueden comprar ahora (existencia del producto; en un paquete, cuántos paquetes completos alcanzan con el stock de sus componentes). */
  stock: number;
};

type PopulatedBundleProduct = {
  product: (ProductDoc & { _id: unknown; name: string }) | null;
  quantity: number;
  discountPercentage: number;
};

function productToCatalogItem(p: ProductDoc): CatalogItem {
  return {
    sku: p.sku,
    name: p.name,
    // Tarjetas: usa la descripción secundaria; si aún no se capturó, cae a la principal.
    shortDescription: p.shortDescription || (p.description ?? ""),
    longDescription: p.description ?? "",
    priceMxn: p.price,
    image: p.images?.[0] ?? null,
    images: p.images ?? [],
    videos: (p.videos ?? []) as { url: string; source: string }[],
    usageImages: p.usageImages ?? [],
    unitValue: p.unitValue ?? undefined,
    unit: p.unit ?? undefined,
    kind: "product",
    isFeatured: Boolean(p.isFeatured),
    visibility: p.visibility === "ALLY_ONLY" ? "ALLY_ONLY" : "PUBLIC",
    // Un producto solo para aliados nunca va en una caja de auto-envío.
    isSubscribable: p.visibility === "ALLY_ONLY" ? false : (p.isSubscribable ?? true),
    stock: Math.max(0, Math.floor(p.stock ?? 0)),
  };
}

function bundleToCatalogItem(b: {
  sku: string;
  name: string;
  bundlePrice: number;
  images?: string[];
  videos?: { url: string; source: string }[];
  products: PopulatedBundleProduct[];
  isFeatured?: boolean;
}): CatalogItem {
  const composition = b.products
    .filter((item) => item.product)
    .map((item) => `${item.quantity}× ${item.product!.name}`)
    .join(" + ");

  return {
    sku: b.sku,
    name: b.name,
    shortDescription: composition,
    longDescription: composition,
    priceMxn: b.bundlePrice,
    image: b.images?.[0] ?? null,
    images: b.images ?? [],
    videos: b.videos ?? [],
    usageImages: [],
    kind: "bundle",
    visibility: "PUBLIC",
    isFeatured: Boolean(b.isFeatured),
    isSubscribable: false,
    // Un paquete se arma con sus componentes: se puede vender tantas veces
    // como alcance el componente que menos rinde (p. ej. 15 de stock y 2 por
    // paquete = 7 paquetes). Sin componentes válidos no hay nada que vender.
    stock: bundleStock(b.products),
  };
}

function bundleStock(products: PopulatedBundleProduct[]): number {
  const available = products.filter((item) => item.product);
  if (available.length === 0) return 0;
  return Math.max(
    0,
    Math.min(...available.map((item) => Math.floor((item.product!.stock ?? 0) / Math.max(1, item.quantity)))),
  );
}

/**
 * Qué productos puede ver quien mira el catálogo. Por defecto (visita, cliente, o cualquier llamada que no
 * diga lo contrario) NO incluye los de "solo aliados": esa es la regla segura. Solo un Punto de Recarga
 * activo los ve. Excluye "ALLY_ONLY" en vez de exigir "PUBLIC" para que los productos anteriores a
 * este campo (sin él) sigan siendo públicos.
 */
function visibilityFilter(viewerIsAlly: boolean | undefined) {
  return viewerIsAlly ? {} : { visibility: { $ne: "ALLY_ONLY" } };
}

/** ¿Esta cuenta es un Punto de Recarga activo? Se lee de la base de datos en cada petición, nunca de la cookie. */
export function isRefillAlly(user: { isRefillAlly?: boolean | null } | null | undefined): boolean {
  return Boolean(user?.isRefillAlly);
}

/**
 * Catálogo real vendible en /tienda — productos y paquetes que el admin
 * marcó como disponibles. Reemplaza el antiguo app/data/products.ts
 * estático: ahora todo lo que se vende viene de MongoDB (~/models/product.server,
 * ~/models/bundle.server), así que crear/editar/pausar en /admin/catalog se
 * refleja de inmediato en la tienda, el carrito y el checkout.
 */
export async function getCatalogItems(
  options: { includeUnavailable?: boolean; viewerIsAlly?: boolean } = {},
): Promise<CatalogItem[]> {
  await connectDB();
  const [products, bundles] = await Promise.all([
    ProductModel.find(
      options.includeUnavailable
        ? {}
        : { isAvailable: true, isIndividuallySellable: true, ...visibilityFilter(options.viewerIsAlly) },
    ).lean(),
    BundleModel.find(options.includeUnavailable ? {} : { isActive: true })
      .populate("products.product")
      .lean(),
  ]);

  return [
    ...products.map((p) => productToCatalogItem(p as unknown as ProductDoc)),
    ...bundles.map((b) => bundleToCatalogItem(b as unknown as Parameters<typeof bundleToCatalogItem>[0])),
  ];
}

/**
 * Precio del concentrado para la página de pre-lanzamiento (donde todavía no
 * se carga el catálogo completo). Es el producto individual disponible que se
 * vende por litro; si hay varios, el destacado y, si no, el más barato. Sin
 * producto no se inventa un precio: devuelve null y la página no lo muestra.
 */
export async function getConcentratePrice(): Promise<{ priceMxn: number; unitValue: number } | null> {
  await connectDB();
  // Precio público: el bidón de aliados nunca cuenta como "el precio del concentrado".
  const products = await ProductModel.find({ isAvailable: true, isIndividuallySellable: true, unit: "L", visibility: { $ne: "ALLY_ONLY" } })
    .select("price unitValue isFeatured")
    .lean();
  if (products.length === 0) return null;
  const [best] = [...products].sort(
    (a, b) => Number(Boolean(b.isFeatured)) - Number(Boolean(a.isFeatured)) || a.price - b.price,
  );
  return { priceMxn: best.price, unitValue: best.unitValue ?? 1 };
}

export async function getCatalogItemBySku(
  sku: string,
  options: { includeUnavailable?: boolean; viewerIsAlly?: boolean } = {},
): Promise<CatalogItem | null> {
  await connectDB();
  const product = await ProductModel.findOne(
    options.includeUnavailable
      ? { sku }
      : { sku, isAvailable: true, isIndividuallySellable: true, ...visibilityFilter(options.viewerIsAlly) },
  ).lean();
  if (product) return productToCatalogItem(product as unknown as ProductDoc);

  const bundle = await BundleModel.findOne(options.includeUnavailable ? { sku } : { sku, isActive: true })
    .populate("products.product")
    .lean();
  if (bundle) return bundleToCatalogItem(bundle as unknown as Parameters<typeof bundleToCatalogItem>[0]);

  return null;
}

/** Nombre de un producto o paquete por SKU, exista o no todavía / ya no esté disponible — para mostrar historial (pedidos, timeline de cliente) sin romperse si luego se pausa o elimina. */
export async function getCatalogItemNameBySku(sku: string): Promise<string | null> {
  await connectDB();
  const product = await ProductModel.findOne({ sku }).select("name").lean();
  if (product) return product.name;
  const bundle = await BundleModel.findOne({ sku }).select("name").lean();
  if (bundle) return bundle.name;
  return null;
}

/** Genera un SKU único (slug) para un paquete nuevo a partir de su nombre, evitando choques con productos o con otros paquetes. */
export async function generateUniqueBundleSku(name: string, slugify: (s: string) => string, excludeId?: string) {
  await connectDB();
  const base = slugify(name) || "paquete";
  let candidate = base;
  let n = 2;
  // El universo de SKUs es compartido entre Product y Bundle (el carrito y el
  // checkout resuelven por SKU sin importar el tipo), así que ambas
  // colecciones deben revisarse antes de aceptar un candidato.
  while (
    (await ProductModel.exists({ sku: candidate.toUpperCase() })) ||
    (await BundleModel.exists({ sku: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }))
  ) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}
