import { requireStoreAccess } from "~/lib/storeAccess.server";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Navbar } from "~/components/layout/Navbar";
import { getSubscriptionConfig } from "~/models/subscriptionSettings.server";
import { describeFrequencies } from "~/lib/subscriptionConfig";
import { Footer } from "~/components/layout/Footer";
import { getCatalogItemBySku } from "~/lib/catalog.server";
import { formatPresentation } from "~/lib/productUnit";
import { renderMarkdown } from "~/lib/markdown.server";
import { addToCart, getCart } from "~/lib/cart.server";
import { trackEvent } from "~/lib/trackClient";
import { buildOgMeta, buildProductJsonLd, buildBreadcrumbJsonLd, DEFAULT_OG_IMAGE } from "~/lib/seo";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { ShareButton } from "~/components/ui/ShareButton";
import { existsSync } from "node:fs";
import path from "node:path";
import { ArrowLink } from "~/components/ui/ArrowLink";
import { ProductGallery } from "~/components/ecommerce/ProductGallery";
import { remainingToAdd, soldOutMessage } from "~/lib/stock";
import { getTestimonialsForSku } from "~/models/testimonial.server";
import { siteOrigin } from "~/lib/siteOrigin.server";

export async function loader({ params, request }: LoaderFunctionArgs) {
  await requireStoreAccess(request);
  const sku = params.sku ?? "";
  const product = await getCatalogItemBySku(sku);
  if (!product) {
    throw new Response("Producto no encontrado", { status: 404 });
  }

  const cart = await getCart(request);
  const origin = siteOrigin(request);
  // Las imágenes subidas desde el admin viven en public/uploads — si el
  // producto todavía no tiene ninguna, og:image y el JSON-LD caen al
  // default en vez de apuntar a un 404.
  const isRemoteImage = Boolean(product.image?.startsWith("https://")); // bucket de Cloud Storage
  const hasRealImage =
    Boolean(product.image) && (isRemoteImage || existsSync(path.join(process.cwd(), "public", product.image!)));

  const [testimonials, subscriptionConfig] = await Promise.all([getTestimonialsForSku(product.sku), getSubscriptionConfig()]);

  return data({
    testimonials: testimonials.map((t) => ({
      id: String(t._id),
      customerName: t.customerName,
      quote: t.quote,
      photoUrl: t.photoUrl ?? "",
    })),
    product: {
      ...product,
      longDescriptionHtml: product.longDescription ? renderMarkdown(product.longDescription) : null,
    },
    subscription: {
      discountPercent: subscriptionConfig.discountPercent,
      frequencies: describeFrequencies(subscriptionConfig),
    },
    origin,
    imagePath: hasRealImage ? product.image! : DEFAULT_OG_IMAGE,
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
    inCartQuantity: cart.find((item) => item.sku === product.sku)?.quantity ?? 0,
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Producto no encontrado — STOPee" }];
  const { product, origin, imagePath } = data;
  const url = `${origin}/tienda/${product.sku}`;
  const image = imagePath.startsWith("https://") ? imagePath : `${origin}${imagePath}`;
  return [
    { title: `${product.name} — STOPee` },
    { name: "description", content: product.shortDescription },
    ...buildOgMeta({ title: `${product.name} — STOPee`, description: product.shortDescription, url, image, type: "product" }),
    buildProductJsonLd({
      name: product.name,
      description: product.shortDescription,
      image,
      url,
      priceMxn: product.priceMxn,
      sku: product.sku,
    }),
    buildBreadcrumbJsonLd([
      { name: "Inicio", url: origin },
      { name: "Tienda", url: `${origin}/tienda` },
      { name: product.name, url },
    ]),
  ];
};

export async function action({ request }: ActionFunctionArgs) {
  await requireStoreAccess(request);
  const formData = await request.formData();
  const sku = formData.get("sku");
  const item = typeof sku === "string" ? await getCatalogItemBySku(sku) : null;
  if (typeof sku !== "string" || !item) {
    return data({ error: "Producto no válido." }, { status: 400 });
  }
  const requestedQuantity = Number(formData.get("quantity") ?? 1);
  const quantity = Number.isFinite(requestedQuantity) && requestedQuantity > 0 ? Math.floor(requestedQuantity) : 1;

  // Tope por existencia, contando lo que el cliente ya lleva en el carrito.
  if (item.stock <= 0) return data({ error: soldOutMessage(item.name) }, { status: 400 });
  const inCart = (await getCart(request)).find((line) => line.sku === sku)?.quantity ?? 0;
  const room = remainingToAdd(item.stock, inCart);
  if (room <= 0) {
    return data({ error: `Ya tienes en tu carrito todas las unidades disponibles (${item.stock}).` }, { status: 400 });
  }
  const { cookie } = await addToCart(request, sku, Math.min(quantity, room));
  return data(
    { ok: true, notice: quantity > room ? `Solo quedaban ${room} más; agregamos ${room}.` : undefined },
    { headers: { "Set-Cookie": cookie } },
  );
}

export default function ProductDetail() {
  const { product, testimonials, subscription, origin, cartCount, inCartQuantity } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok?: boolean; error?: string; notice?: string }>();
  const isAdding = fetcher.state !== "idle";
  const wasAdding = useRef(false);
  const [quantity, setQuantity] = useState(1);
  // Lo que todavía se puede agregar: la existencia menos lo que ya está en el carrito.
  const maxQuantity = remainingToAdd(product.stock, inCartQuantity);
  const soldOut = product.stock <= 0;
  const cartIsFull = !soldOut && maxQuantity <= 0;
  const atMax = quantity >= maxQuantity;

  // Si el tope baja (agregó al carrito, o el stock cambió) la cantidad elegida no se pasa de él.
  useEffect(() => {
    setQuantity((q) => Math.max(1, Math.min(q, maxQuantity || 1)));
  }, [maxQuantity]);

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
          <Breadcrumbs
            items={[
              { label: "Inicio", href: "/" },
              { label: "Tienda", href: "/tienda" },
              { label: product.name },
            ]}
          />

          <div className="mt-6 grid grid-cols-1 gap-10 sm:grid-cols-2">
            <ProductGallery key={product.sku} images={product.images} name={product.name} />

            <div className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-black text-carbon sm:text-3xl">{product.name}</h1>
                {product.unitValue && product.unit && (
                  <span className="rounded-full bg-bosque/10 px-2 py-0.5 text-xs font-semibold text-bosque">
                    {formatPresentation(product.unitValue, product.unit)}
                  </span>
                )}
              </div>

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
                    onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                    disabled={atMax}
                    aria-label="Aumentar cantidad"
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon hover:bg-carbon/5 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    +
                  </button>
                </div>

                <fetcher.Form method="post" className="min-w-0 flex-1">
                  <input type="hidden" name="sku" value={product.sku} />
                  <input type="hidden" name="quantity" value={quantity} />
                  <button
                    type="submit"
                    disabled={isAdding || soldOut || cartIsFull}
                    className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso transition-transform hover:scale-105 active:scale-95 disabled:opacity-60 disabled:hover:scale-100"
                  >
                    {soldOut ? "Agotado" : isAdding ? "Agregando…" : "Agregar al carrito"}
                  </button>
                </fetcher.Form>
              </div>

              {!soldOut && (
                <p className="mt-2 text-sm text-carbon/60" aria-live="polite">
                  {cartIsFull
                    ? `Ya tienes en tu carrito las ${product.stock} unidades disponibles.`
                    : atMax
                      ? `Máximo disponible: ${maxQuantity}.`
                      : product.stock <= 5
                        ? `Quedan solo ${product.stock}.`
                        : null}
                </p>
              )}
              {fetcher.data?.error && <p className="mt-2 text-sm font-semibold text-red-600">{fetcher.data.error}</p>}

              {fetcher.data?.ok && (
                <p className="mt-3 text-sm font-semibold text-bosque">
                  {fetcher.data.notice ?? "Agregado al carrito."}{" "}
                  <ArrowLink to="/tienda#carrito" className="underline">
                    Ver carrito
                  </ArrowLink>
                </p>
              )}

              {product.kind === "product" && product.isSubscribable && (
                <div className="mt-6 rounded-2xl border border-lima/30 bg-bosque/5 p-5">
                  <p className="font-display font-bold text-carbon">
                    {subscription.discountPercent > 0
                      ? `¿Lo quieres en auto-envío? Ahorra ${subscription.discountPercent}%`
                      : "¿Lo quieres en auto-envío?"}
                  </p>
                  <p className="mt-1 text-sm text-carbon/70">
                    Arma tu caja de auto-envío con {product.name} y recíbela
                    {subscription.frequencies && `, ${subscription.frequencies}`}.
                  </p>
                  <Link
                    to={`/suscripcion?sku=${product.sku}`}
                    className="mt-3 inline-block min-h-11 rounded-full bg-lima px-6 py-2.5 text-sm font-bold text-carbon transition-transform hover:scale-105"
                  >
                    Suscribirme y ahorrar
                  </Link>
                </div>
              )}

              <div className="mt-6">
                <ShareButton title={product.name} url={`${origin}/tienda/${product.sku}`} />
              </div>
            </div>
          </div>

          {product.longDescriptionHtml && (
            <div
              className="prose prose-lg mt-14 max-w-none border-t border-carbon/10 pt-10 text-carbon/80 prose-headings:font-display prose-headings:text-carbon prose-a:text-bosque"
              dangerouslySetInnerHTML={{ __html: product.longDescriptionHtml }}
            />
          )}

          {/* Testimonios de este producto (máximo 3, sin calificación). Sin testimonios no se muestra nada. */}
          {testimonials.length > 0 && (
            <div className="mt-14 border-t border-carbon/10 pt-10">
              <h2 className="font-display text-2xl font-black text-carbon">Lo que dicen quienes ya lo usan</h2>
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {testimonials.map((t) => (
                  <figure key={t.id} className="flex flex-col rounded-3xl border border-carbon/10 bg-white p-6">
                    <blockquote className="flex-1 text-carbon/80">“{t.quote}”</blockquote>
                    <figcaption className="mt-4 flex items-center gap-2">
                      {t.photoUrl && <img src={t.photoUrl} alt="" className="h-9 w-9 rounded-full object-cover" loading="lazy" decoding="async" />}
                      <span className="font-display font-bold text-carbon">{t.customerName}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}

          {/* Fotos de cómo se usa. Sin fotos no se muestra nada. */}
          {product.usageImages.length > 0 && (
            <div className="mt-14 border-t border-carbon/10 pt-10">
              <h2 className="font-display text-2xl font-black text-carbon">Así se usa</h2>
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {product.usageImages.map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt={`Cómo se usa ${product.name}`}
                    loading="lazy"
                    className="aspect-[4/5] w-full rounded-3xl object-cover"
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
