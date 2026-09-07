import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { ScrollytellingSection } from "~/components/scrollytelling/ScrollytellingSection";
import { getCart } from "~/lib/cart.server";

export const meta: MetaFunction = () => [
  { title: "Modo de uso — STOPee" },
  {
    name: "description",
    content: "Cómo usar STOPee en 3 pasos: destapa, dosifica en tu botella squishable y activa con agua.",
  },
];

/**
 * Página propia y siempre disponible (sin importar si isStoreActive), porque
 * el nav necesita un destino real para "Modo de uso" — antes era un ancla
 * (#modo-de-uso) que nunca existió y que, cuando la tienda está en
 * pre-lanzamiento, terminaba mostrando el landing de lista de espera.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const cart = await getCart(request);
  return json({ cartCount: cart.reduce((sum, item) => sum + item.quantity, 0) });
}

export default function ModoDeUso() {
  const { cartCount } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />
      <main className="flex-1">
        <ScrollytellingSection exploreHref="/tienda" />
      </main>
      <Footer />
    </div>
  );
}
