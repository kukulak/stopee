import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { PRODUCTS, type ProductSku } from "~/data/products";
import { formatPresentation } from "~/lib/productUnit";
import { renderMarkdown } from "~/lib/markdown.server";
import { addToCart, getCart } from "~/lib/cart.server";
import { trackEvent } from "~/lib/trackClient";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const sku = params.sku ?? "";
  const product = PRODUCTS[sku as ProductSku];
  if (!product) {
    throw new Response("Producto no encontrado", { status: 404 });
  }

  const cart = await getCart(request);
  return json({
    product: {
      ...product,
      longDescriptionHtml: product.longDescription ? renderMarkdown(product.longDescription) : null,
    },
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Producto no encontrado — STOPee" }];
  return [
    { title: `${data.product.name} — STOPee` },
    { name: "description", content: data.product.shortDescription },
  ];
};

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const sku = formData.get("sku");
  if (typeof sku !== "string" || !(sku in PRODUCTS)) {
    return json({ error: "Producto no válido." }, { status: 400 });
  }
  const requestedQuantity = Number(formData.get("quantity") ?? 1);
  const quantity = Number.isFinite(requestedQuantity) && requestedQuantity > 0 ? Math.floor(requestedQuantity) : 1;
  const { cookie } = await addToCart(request, sku, quantity);
  return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}

export default function ProductDetail() {
  const { product, cartCount } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const isAdding = fetcher.state !== "idle";
  const wasAdding = useRef(false);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    trackEvent("view_item", product.sku);
  }, [product.sku]);

  useEffect(() => {
    if (wasAdding.current && !isAdding && fetcher.data?.ok) {
      trackEvent("add_to_cart", product.sku);
      setQuantity(1);
    }
    wasAdding.current = isAdding;
  }, [isAdding, fetcher.data, product.sku]);

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <Link to="/tienda" className="text-sm font-semibold text-bosque hover:underline">
            ← Volver a la tienda
          </Link>

          <div className="mt-6 grid grid-cols-1 gap-10 sm:grid-cols-2">
            <div className="flex aspect-square items-center justify-center rounded-3xl bg-gradient-to-br from-lima/20 to-bosque/10">
              <div className="font-display text-2xl font-black text-bosque/40">STOPee</div>
            </div>

            <div className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-black text-carbon sm:text-3xl">{product.name}</h1>
                {product.unitValue && product.unit && (
                  <span className="rounded-full bg-bosque/10 px-2 py-0.5 text-xs font-semibold text-bosque">
                    {formatPresentation(product.unitValue, product.unit)}
                  </span>
                )}
              </div>
              <p className="mt-2 text-carbon/70">{product.shortDescription}</p>

              <p className="mt-6 font-display text-3xl font-black text-carbon">
                ${product.priceMxn} <span className="text-sm font-medium text-carbon/50">MXN</span>
              </p>

              <div className="mt-5 flex items-center gap-3">
                <div className="flex items-center rounded-full border border-carbon/15">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    aria-label="Reducir cantidad"
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon hover:bg-carbon/5"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm font-semibold text-carbon" aria-live="polite">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                    aria-label="Aumentar cantidad"
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon hover:bg-carbon/5"
                  >
                    +
                  </button>
                </div>

                <fetcher.Form method="post" className="min-w-0 flex-1">
                  <input type="hidden" name="sku" value={product.sku} />
                  <input type="hidden" name="quantity" value={quantity} />
                  <button
                    type="submit"
                    disabled={isAdding}
                    className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
                  >
                    {isAdding ? "Agregando…" : "Agregar al carrito"}
                  </button>
                </fetcher.Form>
              </div>

              {fetcher.data?.ok && (
                <p className="mt-3 text-sm font-semibold text-bosque">
                  Agregado al carrito.{" "}
                  <Link to="/tienda#carrito" className="underline">
                    Ver carrito →
                  </Link>
                </p>
              )}
            </div>
          </div>

          {product.longDescriptionHtml && (
            <div
              className="prose prose-lg mt-14 max-w-none border-t border-carbon/10 pt-10 text-carbon/80 prose-headings:font-display prose-headings:text-carbon prose-a:text-bosque"
              dangerouslySetInnerHTML={{ __html: product.longDescriptionHtml }}
            />
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
