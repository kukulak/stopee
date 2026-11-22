import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { getCart } from "~/lib/cart.server";
import { buildBreadcrumbJsonLd } from "~/lib/seo";
import { siteOrigin } from "~/lib/siteOrigin.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: "Nosotros — STOPee" },
  {
    name: "description",
    content: "Transformamos el impacto de la convivencia canina en las ciudades con biotecnología activa, preservación arquitectónica y diseño cívico.",
  },
  ...(data
    ? [
        buildBreadcrumbJsonLd([
          { name: "Inicio", url: data.origin },
          { name: "Nosotros", url: `${data.origin}/nosotros` },
        ]),
      ]
    : []),
];

export async function loader({ request }: LoaderFunctionArgs) {
  const cart = await getCart(request);
  return json({ cartCount: cart.reduce((sum, item) => sum + item.quantity, 0), origin: siteOrigin(request) });
}

const PRINCIPLES = [
  {
    title: "Química bioactiva y preservación mineral",
    body: "Desarrollo centrado en consorcios microbianos benéficos y fijadores moleculares de grado ambiental. Formulamos soluciones libres de agentes corrosivos o abrasivos, garantizando una compatibilidad absoluta con la estructura porosa de la cantera, el adoquín y el concreto, así como con el entorno vegetal.",
  },
  {
    title: "Ingeniería de alta concentración",
    body: "Formulamos concentrados de alto rendimiento biológico (1 litro genera 30 litros de solución activa). Frente a los productos enzimáticos convencionales que se comercializan prediluidos, este modelo optimiza los costos operativos de mantenimiento continuo y disminuye drásticamente el desecho periódico de botellas plásticas.",
  },
  {
    title: "Degradación in situ sin enjuague (leave-on)",
    body: "Diseño de soluciones catalíticas calibradas para metabolizar los residuos directamente en el poro de las superficies exteriores. La formulación opera de forma autónoma y sin fricción mecánica, ahorrando un volumen considerable de agua en comparación con los métodos tradicionales que exigen tallado y enjuagues recurrentes.",
  },
];

export default function Nosotros() {
  const { cartCount } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Breadcrumbs items={[{ label: "Inicio", href: "/" }, { label: "Nosotros" }]} />

          <p className="mt-6 font-body text-sm font-bold uppercase tracking-widest text-oliva">Nosotros</p>
          <h1 className="mt-2 text-balance font-display text-3xl font-black text-carbon sm:text-4xl">Propósito</h1>
          <p className="mt-4 text-lg leading-relaxed text-carbon/80">
            Transformar el impacto de la convivencia canina en las ciudades mediante biotecnología
            activa, preservación arquitectónica y diseño cívico.
          </p>

          <h2 className="mt-12 font-display text-2xl font-black text-carbon">La perspectiva</h2>
          <p className="mt-4 leading-relaxed text-carbon/70">
            La cultura ciudadana adoptó con éxito la recolección de residuos sólidos. La orina diaria y
            sus marcas acumuladas sobre la arquitectura urbana representan el siguiente desafío cívico,
            uno que exige respuestas técnicas, sostenibles y de alta precisión operativa.
          </p>

          <h2 className="mt-12 font-display text-2xl font-black text-carbon">El compromiso</h2>
          <p className="mt-4 leading-relaxed text-carbon/70">
            Desarrollar soluciones de alta concentración y máxima biodegradabilidad que detengan el
            deterioro del mobiliario público, optimicen los costos de mantenimiento en desarrollos
            residenciales y dignifiquen el tránsito en el espacio común.
          </p>

          <h2 className="mt-12 font-display text-2xl font-black text-carbon">
            Principios de ingeniería y desarrollo
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-4">
            {PRINCIPLES.map((principle) => (
              <div key={principle.title} className="rounded-2xl border border-carbon/10 bg-white p-6">
                <h3 className="font-display text-lg font-bold text-bosque">{principle.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-carbon/70">{principle.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded-3xl bg-bosque/5 p-6 text-center">
            <p className="font-display text-lg font-bold text-carbon">¿Tienes dudas?</p>
            <p className="mt-1 text-sm text-carbon/70">Revisa las preguntas frecuentes o escríbenos directo.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Link
                to="/preguntas-frecuentes"
                className="min-h-11 rounded-full border border-carbon/15 px-6 py-2.5 text-sm font-semibold text-carbon hover:border-carbon/30"
              >
                Ver FAQs
              </Link>
              <Link
                to="/contacto"
                className="min-h-11 rounded-full bg-lima px-6 py-2.5 text-sm font-bold text-carbon"
              >
                Contactar
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
