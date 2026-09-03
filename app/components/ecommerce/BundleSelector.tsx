import { useState } from "react";
import { PRODUCT_LIST } from "~/data/products";
import { ProductCard } from "~/components/ecommerce/ProductCard";

const TABS = [
  { id: "individuales", label: "Productos individuales" },
  { id: "packs", label: "Paquetes" },
] as const;

export function BundleSelector() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("individuales");

  const individuales = PRODUCT_LIST.filter((p) => !p.bundle);
  const packs = PRODUCT_LIST.filter((p) => p.bundle);
  const visible = tab === "individuales" ? individuales : packs;

  return (
    <div>
      <div className="inline-flex rounded-full bg-carbon/5 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-11 rounded-full px-5 text-sm font-bold transition-colors ${
              tab === t.id ? "bg-carbon text-hueso" : "text-carbon/60 hover:text-carbon"
            }`}
            aria-pressed={tab === t.id}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((product) => (
          <ProductCard key={product.sku} product={product} />
        ))}
      </div>
    </div>
  );
}
