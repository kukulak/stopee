import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { useLoaderData } from "react-router";
import DOMPurify from "isomorphic-dompurify";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { getCart } from "~/lib/cart.server";
import { getLegalSettings } from "~/models/legalSettings.server";
import { applyLegalVariables } from "~/lib/legalTemplate";
import { buildBreadcrumbJsonLd, buildFaqJsonLd } from "~/lib/seo";
import { siteOrigin } from "~/lib/siteOrigin.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = "Preguntas frecuentes — STOPee";
  const description = "Cómo funciona STOPee, cuánto rinde, cómo usarlo, envíos, devoluciones y tu suscripción.";
  return [
    { title },
    { name: "description", content: description },
    ...(data
      ? [
          buildBreadcrumbJsonLd([
            { name: "Inicio", url: data.origin },
            { name: "Preguntas frecuentes", url: `${data.origin}/preguntas-frecuentes` },
          ]),
          buildFaqJsonLd(
            data.faqs.map((faq) => ({
              question: faq.question,
              answer: faq.answer.replace(/<[^>]+>/g, ""),
            })),
          ),
        ]
      : []),
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const [cart, legalSettings] = await Promise.all([getCart(request), getLegalSettings()]);
  const businessData = {
    razonSocial: legalSettings.razonSocial ?? "",
    direccionFiscal: legalSettings.direccionFiscal ?? "",
    correoContacto: legalSettings.correoContacto ?? "",
    tiemposEnvio: legalSettings.tiemposEnvio ?? "",
    politicaDevoluciones: legalSettings.politicaDevoluciones ?? "",
  };

  const withVars = (text: string) => DOMPurify.sanitize(applyLegalVariables(text, businessData));

  const faqs = [
    {
      question: "¿Qué es STOPee y cómo funciona?",
      answer:
        "Es un concentrado biotecnológico que neutraliza y degrada los residuos de orina canina desde su raíz molecular, en vez de solo enmascarar el olor. Combina Bacillus subtilis (un microorganismo benéfico que degrada los compuestos orgánicos de la orina) con ricinoleato de zinc (que neutraliza el amoniaco y ataca el ácido úrico que daña concreto, cantera y metal).",
    },
    {
      question: "¿Cuánto rinde un litro?",
      answer:
        "1 litro de concentrado rinde 30 litros de solución activa lista para usar — se diluye con agua de la llave en tu botella aplicadora.",
    },
    {
      question: "¿Cómo se usa?",
      answer:
        "Agita ligeramente el envase (sin exagerar, para que no se forme espuma), llena la tapa dosificadora de concentrado, vacíala en tu botella aplicadora de 500 ml, completa con agua y mezcla suavemente. Rocía sobre la zona afectada después de cada paseo.",
    },
    {
      question: "¿Cuánto tarda mi pedido en llegar?",
      answer: withVars("{{tiemposEnvio}}"),
    },
    {
      question: "¿Cuál es la política de devoluciones?",
      answer: withVars("{{politicaDevoluciones}}"),
    },
    {
      question: "¿Puedo pausar, cambiar o cancelar mi suscripción?",
      answer:
        'Sí — desde <a href="/cuenta" class="font-bold text-bosque underline">Mi cuenta</a> puedes pausar y reanudar tu suscripción, cambiar la frecuencia de envío, o cancelarla por completo desde el portal de facturación, cuando quieras.',
    },
    {
      question: "¿Qué métodos de pago aceptan?",
      answer: "Tarjeta de crédito o débito, a través de un checkout seguro.",
    },
  ];

  return data({
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
    faqs,
    origin: siteOrigin(request),
  });
}

export default function PreguntasFrecuentes() {
  const { cartCount, faqs } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />
      <main className="flex-1">
        <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
          <Breadcrumbs items={[{ label: "Inicio", href: "/" }, { label: "Preguntas frecuentes" }]} />

          <p className="mt-6 font-body text-sm font-bold uppercase tracking-widest text-oliva">Ayuda</p>
          <h1 className="mt-2 font-display text-3xl font-black text-carbon sm:text-4xl">Preguntas frecuentes</h1>

          <div className="mt-10 flex flex-col gap-4">
            {faqs.map((faq) => (
              <details
                key={faq.question}
                className="group rounded-2xl border border-carbon/10 bg-white p-5 open:border-oliva/30"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg font-display font-bold text-carbon focus:outline-none focus-visible:ring-2 focus-visible:ring-bosque/40">
                  {faq.question}
                  <span className="shrink-0 text-lima transition-transform group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p
                  className="mt-3 text-sm text-carbon/70 [&_mark]:rounded [&_mark]:bg-lima/40 [&_mark]:px-1"
                  dangerouslySetInnerHTML={{ __html: faq.answer }}
                />
              </details>
            ))}
          </div>

          <p className="mt-10 text-center text-sm text-carbon/60">
            ¿No encontraste tu respuesta?{" "}
            <a href="/contacto" className="font-semibold text-bosque hover:underline">
              Escríbenos
            </a>
            .
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
