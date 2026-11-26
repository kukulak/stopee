import { connectDB } from "~/lib/db.server";
import { ProductModel } from "~/models/product.server";
import { BundleModel } from "~/models/bundle.server";

/**
 * La tienda destaca UN solo artículo ("estrella") entre productos y paquetes.
 * Estas funciones mantienen esa regla desde el backoffice: al marcar uno, el
 * anterior se desmarca solo — el admin nunca tiene que ir a quitarlo a mano.
 */
export type FeaturedKind = "product" | "bundle";

/** Quita la estrella a todo (menos, opcionalmente, al artículo que se está guardando). */
export async function clearFeatured(exceptId?: string) {
  await connectDB();
  const filter = { isFeatured: true, ...(exceptId ? { _id: { $ne: exceptId } } : {}) };
  await Promise.all([
    ProductModel.updateMany(filter, { $set: { isFeatured: false } }),
    BundleModel.updateMany(filter, { $set: { isFeatured: false } }),
  ]);
}

/** Alterna la estrella de un artículo: si no la tenía, se la quita al resto y se la pone a él. */
export async function toggleFeatured(kind: FeaturedKind, id: string) {
  await connectDB();
  const item = kind === "product" ? await ProductModel.findById(id) : await BundleModel.findById(id);
  if (!item) return;
  // Un producto solo para aliados no puede ser la estrella pública de la tienda.
  if (kind === "product" && (item as { visibility?: string }).visibility === "ALLY_ONLY") return;
  if (item.isFeatured) {
    item.isFeatured = false;
  } else {
    await clearFeatured(id);
    item.isFeatured = true;
  }
  await item.save();
}

/** Nombre de la estrella actual (para avisarle al admin cuál es), o null si no hay. */
export async function getCurrentStarName(): Promise<string | null> {
  await connectDB();
  const [product, bundle] = await Promise.all([
    ProductModel.findOne({ isFeatured: true }).select("name").lean(),
    BundleModel.findOne({ isFeatured: true }).select("name").lean(),
  ]);
  return product?.name ?? bundle?.name ?? null;
}
