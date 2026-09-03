import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { BundleSelector } from "~/components/ecommerce/BundleSelector";
import { SubscriptionConfigurator } from "~/components/ecommerce/SubscriptionConfigurator";
import { CartDrawer, type CartLine } from "~/components/ecommerce/CartDrawer";
import { PRODUCTS, LOYALTY_DISCOUNT_PERCENT } from "~/data/products";
import type { ProductSku } from "~/data/products";
import { addToCart, getCart, removeFromCart } from "~/lib/cart.server";
import { getUser } from "~/lib/session.server";

export const meta: MetaFunction = () => [
  { title: "Tienda STOPee — Higiene urbana canina" },
  {
    name: "description",
    content: "Compra STOPee Concentrado 1L, la Botella Squishable o paquetes completos. Activa tu suscripción periódica con 10% de descuento.",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const [cartItems, user] = await Promise.all([getCart(request), getUser(request)]);

  const lines: CartLine[] = cartItems
    .filter((item): item is { sku: ProductSku; quantity: number } => item.sku in PRODUCTS)
    .map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      product: PRODUCTS[item.sku],
    }));

  const subtotalMxn = lines.reduce((sum, line) => sum + line.product.priceMxn * line.quantity, 0);
  const discountPercent = user?.loyaltyDiscountActive ? LOYALTY_DISCOUNT_PERCENT : 0;

  return json({ lines, subtotalMxn, discountPercent, isAuthenticated: Boolean(user) });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const sku = formData.get("sku");

  if (typeof sku !== "string" || !(sku in PRODUCTS)) {
    return json({ error: "Producto no válido." }, { status: 400 });
  }

  if (intent === "add-to-cart") {
    const { cookie } = await addToCart(request, sku);
    return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  if (intent === "remove-from-cart") {
    const { cookie } = await removeFromCart(request, sku);
    return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  return json({ error: "Acción no reconocida." }, { status: 400 });
}

export default function Tienda() {
  const { lines, subtotalMxn, discountPercent } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={lines.reduce((sum, l) => sum + l.quantity, 0)} />

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
            Tienda STOPee
          </p>
          <h1 className="mt-2 max-w-2xl font-display text-3xl font-black text-carbon sm:text-4xl">
            Elige tu STOPee y equipa tus paseos
          </h1>
          <p className="mt-3 max-w-2xl text-carbon/70">
            Compra individual o en paquete. Cuando sepas cuánto te dura tu primer litro, activa
            el auto-envío periódico y ahorra 10% en cada entrega.
          </p>

          <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_340px]">
            <div className="flex flex-col gap-12">
              <BundleSelector />
              <SubscriptionConfigurator />
            </div>

            <CartDrawer lines={lines} subtotalMxn={subtotalMxn} discountPercent={discountPercent} />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
