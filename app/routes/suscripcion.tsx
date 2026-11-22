import { requireStoreAccess } from "~/lib/storeAccess.server";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { useLoaderData } from "react-router";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { SubscriptionConfigurator } from "~/components/ecommerce/SubscriptionConfigurator";
import { getSubscriptionConfig } from "~/models/subscriptionSettings.server";
import { describeFrequencies, programDisplayName } from "~/lib/subscriptionConfig";
import { getCatalogItems } from "~/lib/catalog.server";
import { getCart } from "~/lib/cart.server";
import { buildOgMeta, DEFAULT_OG_IMAGE } from "~/lib/seo";
import { siteOrigin } from "~/lib/siteOrigin.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Auto-envío periódico — STOPee" }];
  const title = data.pageTitle;
  const discount = data.subscriptionConfig.discountPercent > 0 ? ` con ${data.subscriptionConfig.discountPercent}% de descuento` : "";
  return [
    { title },
    { name: "description", content: `Arma tu caja de STOPee y recíbela ${data.frequencySummary}${discount}.` },
    ...buildOgMeta({
      title,
      description: `Arma tu caja de STOPee y recíbela sin pensarlo${discount}.`,
      url: data.origin,
      image: `${data.origin}${DEFAULT_OG_IMAGE}`,
      type: "website",
    }),
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireStoreAccess(request);
  const url = new URL(request.url);
  const highlightSku = url.searchParams.get("sku");

  const [catalogItems, cart, subscriptionConfig] = await Promise.all([
    getCatalogItems(),
    getCart(request),
    getSubscriptionConfig(),
  ]);
  const subscribableItems = catalogItems.filter((item) => item.isSubscribable);

  return data({
    origin: siteOrigin(request),
    subscriptionConfig,
    pageTitle: subscriptionConfig.programName
      ? `${subscriptionConfig.programName} — Auto-envío periódico`
      : "Auto-envío periódico",
    frequencySummary: describeFrequencies(subscriptionConfig),
    subscribableItems,
    highlightSku,
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
  });
}

export default function Suscripcion() {
  const { subscribableItems, subscriptionConfig, highlightSku, cartCount } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <div className="mb-6">
            <Breadcrumbs items={[{ label: "Inicio", href: "/" }, { label: "Tienda", href: "/tienda" }, { label: programDisplayName(subscriptionConfig) }]} />
          </div>

          <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">{programDisplayName(subscriptionConfig)}</p>
          <h1 className="mt-2 max-w-2xl font-display text-3xl font-black text-carbon sm:text-4xl">
            Tu auto-envío periódico, armado a tu medida
          </h1>
          <p className="mt-3 max-w-2xl text-carbon/70">
            Desde un litro para tu casa hasta varios para un negocio pet-friendly — elige qué va en
            tu caja, con qué frecuencia llega, y ahorra en automático en cada entrega.
          </p>

          <div className="mt-10">
            <SubscriptionConfigurator
              products={subscribableItems}
              config={subscriptionConfig}
              preselectedSku={highlightSku}
            />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
