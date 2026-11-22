import type { CatalogItem } from "~/lib/catalog.server";
import { ProductCard } from "~/components/ecommerce/ProductCard";
import { FeaturedProductShowcase } from "~/components/ecommerce/FeaturedProductShowcase";

function CatalogSection({
  title,
  items,
  onAdded,
  inCart,
}: {
  title: string;
  items: CatalogItem[];
  onAdded?: (name: string) => void;
  inCart: Record<string, number>;
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <h2 className="font-display text-xl font-black text-carbon">{title}</h2>
      <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((product) => (
          <ProductCard key={product.sku} product={product} onAdded={onAdded} inCartQuantity={inCart[product.sku] ?? 0} />
        ))}
      </div>
    </div>
  );
}

export function BundleSelector({
  products,
  onAdded,
  inCart = {},
}: {
  products: CatalogItem[];
  onAdded?: (name: string) => void;
  /** Unidades por SKU que ya están en el carrito (para respetar la existencia al agregar más). */
  inCart?: Record<string, number>;
}) {
  if (products.length === 0) {
    return <p className="text-sm text-carbon/60">Todavía no hay productos disponibles en la tienda.</p>;
  }

  // El "glorificador": el producto/paquete marcado como estrella en el admin
  // se destaca primero y no se repite en su sección normal.
  const featured = products.find((p) => p.isFeatured);
  const rest = featured ? products.filter((p) => p.sku !== featured.sku) : products;
  const individuales = rest.filter((p) => p.kind === "product");
  const paquetes = rest.filter((p) => p.kind === "bundle");

  return (
    <div className="flex flex-col gap-12">
      {featured && <FeaturedProductShowcase product={featured} onAdded={onAdded} inCartQuantity={inCart[featured.sku] ?? 0} />}
      <CatalogSection title="Productos" items={individuales} onAdded={onAdded} inCart={inCart} />
      <CatalogSection title="Paquetes" items={paquetes} onAdded={onAdded} inCart={inCart} />
    </div>
  );
}
