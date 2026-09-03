import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { FluidWaves } from "~/components/ui/FluidWaves";
import { Logo } from "~/components/ui/Logo";
import { ScrollyContainer } from "~/components/scrollytelling/ScrollyContainer";
import { PRODUCT_LIST } from "~/data/products";
import { BLOG_POSTS } from "~/data/blogPosts";
import { getCart } from "~/lib/cart.server";

export const meta: MetaFunction = () => [
  { title: "STOPee — Ciudades limpias, paseos impecables" },
  {
    name: "description",
    content: "STOPee: concentrado biotecnológico que neutraliza al instante los residuos del paseo canino. 1 litro rinde 30 litros de solución activa.",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const cart = await getCart(request);
  return json({ cartCount: cart.reduce((sum, item) => sum + item.quantity, 0) });
}

const BENEFITS = [
  {
    audience: "Para ti y tu perro",
    detail: "Paseos agradables, sin malos olores retenidos en arneses, calzado o ropa.",
  },
  {
    audience: "Para tus vecinos y comercios",
    detail: "Fachadas preservadas, calles ventiladas y banquetas seguras para todos.",
  },
  {
    audience: "Para la ciudad",
    detail: "Conservación del mobiliario urbano y microbiología activa benéfica.",
  },
];

export default function Index() {
  const { cartCount } = useLoaderData<typeof loader>();
  const featured = PRODUCT_LIST.find((p) => p.sku === "pack-basico") ?? PRODUCT_LIST[0];

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />

      <main className="flex-1">
        {/* HERO */}
        <section className="relative overflow-hidden">
          <FluidWaves className="absolute inset-x-0 bottom-0 h-64 w-full sm:h-80" />
          <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-10 px-4 pb-28 pt-16 text-center sm:px-6 sm:pt-24 md:flex-row md:text-left">
            <div className="md:w-1/2">
              <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
                Concentrado biotecnológico · Rinde 30L por litro
              </p>
              <h1 className="mt-3 font-display text-4xl font-black leading-[1.05] text-carbon sm:text-5xl lg:text-6xl">
                Ciudades limpias, <span className="text-oliva">paseos impecables.</span>
              </h1>
              <p className="mx-auto mt-5 max-w-md text-lg text-carbon/70 md:mx-0">
                El concentrado biotecnológico que neutraliza al instante y degrada los residuos
                del paseo canino. Rinde 30 litros de frescura activa.
              </p>
              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row md:justify-start">
                <Link
                  to="/tienda"
                  className="min-h-11 w-full rounded-full bg-lima px-8 py-3 text-center text-base font-bold text-carbon transition-transform hover:scale-105 active:scale-95 sm:w-auto"
                >
                  Comprar paquetes
                </Link>
                <a
                  href="#modo-de-uso"
                  className="min-h-11 w-full rounded-full border-2 border-carbon/15 px-8 py-3 text-center text-base font-bold text-carbon transition-colors hover:border-carbon/30 sm:w-auto"
                >
                  Explorar el modo de uso ↓
                </a>
              </div>
            </div>

            <div className="relative flex w-full items-center justify-center md:w-1/2">
              <div className="relative flex aspect-square w-full max-w-sm items-center justify-center rounded-squishy bg-gradient-to-br from-lima/25 via-oliva/10 to-transparent">
                <div className="flex items-end gap-4">
                  <div className="flex h-52 w-24 flex-col items-center justify-center gap-2 rounded-2xl bg-carbon p-3 text-hueso shadow-xl sm:h-64 sm:w-28">
                    <Logo className="h-10 w-auto" />
                    <span className="text-center text-[10px] font-semibold leading-tight">
                      1L Concentrado
                    </span>
                  </div>
                  <div className="flex h-40 w-20 flex-col items-center justify-center gap-2 rounded-3xl bg-bosque p-3 text-hueso shadow-xl sm:h-48 sm:w-24">
                    <Logo className="h-7 w-auto" />
                    <span className="text-center text-[9px] font-semibold leading-tight">
                      Squishable
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SCROLLYTELLING */}
        <ScrollyContainer />

        {/* MANIFIESTO PSICOLÓGICO */}
        <section className="relative overflow-hidden bg-carbon py-20 text-hueso">
          <FluidWaves tone="dark" className="absolute inset-0 h-full w-full opacity-40" />
          <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
            <p className="font-body text-sm font-bold uppercase tracking-widest text-lima">
              El nuevo estándar cívico
            </p>
            <h2 className="mt-3 font-display text-3xl font-black sm:text-4xl">
              Levantar la popa ya es un hábito. Atender la orina es el siguiente paso.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-hueso/70">
              La cultura ciudadana adoptó exitosamente la recolección de heces. El siguiente
              paso lógico de la convivencia comunitaria es atender las manchas y olores de la
              orina en fachadas, banquetas y postes.
            </p>

            <div className="mt-12 grid grid-cols-1 gap-6 text-left sm:grid-cols-3">
              {BENEFITS.map((b) => (
                <div key={b.audience} className="rounded-3xl border border-hueso/10 bg-hueso/5 p-6">
                  <p className="font-display font-bold text-lima">{b.audience}</p>
                  <p className="mt-2 text-sm text-hueso/70">{b.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* TIENDA TEASER */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
                Tienda integrada
              </p>
              <h2 className="mt-2 font-display text-3xl font-black text-carbon">
                Empieza con tu paquete inicial
              </h2>
            </div>
            <Link to="/tienda" className="font-semibold text-bosque hover:underline">
              Ver todo el catálogo →
            </Link>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="flex flex-col justify-between rounded-3xl bg-gradient-to-br from-bosque to-carbon p-8 text-hueso sm:p-10">
              <div>
                <p className="font-display text-sm font-bold uppercase tracking-widest text-lima">
                  Recomendado para empezar
                </p>
                <h3 className="mt-2 font-display text-2xl font-black">{featured.name}</h3>
                <p className="mt-2 max-w-sm text-hueso/70">{featured.shortDescription}</p>
              </div>
              <div className="mt-8 flex items-center justify-between">
                <span className="font-display text-3xl font-black">${featured.priceMxn} MXN</span>
                <Link
                  to="/tienda"
                  className="min-h-11 rounded-full bg-lima px-6 py-2.5 text-sm font-bold text-carbon transition-transform hover:scale-105"
                >
                  Comprar ahora
                </Link>
              </div>
            </div>

            <div className="rounded-3xl border border-lima/30 bg-bosque/5 p-8">
              <p className="font-display font-bold text-carbon">
                ¿Ya sabes cuánto te dura tu litro?
              </p>
              <p className="mt-2 text-sm text-carbon/70">
                Activa el auto-envío periódico y recibe tu concentrado cada 3, 4, 6 u 8 semanas
                con 10% de descuento automático.
              </p>
              <Link
                to="/tienda#suscripcion"
                className="mt-5 inline-block min-h-11 rounded-full border-2 border-carbon/15 px-6 py-2.5 text-sm font-bold text-carbon hover:border-carbon/30"
              >
                Configurar suscripción
              </Link>
            </div>
          </div>
        </section>

        {/* BLOG TEASER */}
        <section className="bg-bosque/5 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
                  Blog cívico
                </p>
                <h2 className="mt-2 font-display text-3xl font-black text-carbon">
                  Convivencia urbana, un hábito a la vez
                </h2>
              </div>
              <Link to="/blog" className="font-semibold text-bosque hover:underline">
                Ver todos los artículos →
              </Link>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
              {BLOG_POSTS.slice(0, 3).map((post) => (
                <Link
                  key={post.slug}
                  to={`/blog/${post.slug}`}
                  className="flex flex-col rounded-3xl border border-carbon/10 bg-white p-6 transition-shadow hover:shadow-lg"
                >
                  <h3 className="font-display font-bold text-carbon">{post.title}</h3>
                  <p className="mt-2 flex-1 text-sm text-carbon/60">{post.excerpt}</p>
                  <span className="mt-4 text-sm font-semibold text-bosque">Leer →</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
