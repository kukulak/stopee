import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { getCart } from "~/lib/cart.server";
import { getLegalSettings } from "~/models/legalSettings.server";
import { applyLegalVariables } from "~/lib/legalTemplate";
import { renderMarkdown } from "~/lib/markdown.server";

export const meta: MetaFunction = () => [
  { title: "Aviso de privacidad — STOPee" },
  {
    name: "description",
    content: "Aviso de privacidad de STOPee: qué datos personales recabamos, para qué los usamos y cómo ejercer tus derechos ARCO.",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const [cart, settings] = await Promise.all([getCart(request), getLegalSettings()]);
  const businessData = {
    razonSocial: settings.razonSocial ?? "",
    direccionFiscal: settings.direccionFiscal ?? "",
    correoContacto: settings.correoContacto ?? "",
    tiemposEnvio: settings.tiemposEnvio ?? "",
    politicaDevoluciones: settings.politicaDevoluciones ?? "",
  };
  const html = renderMarkdown(applyLegalVariables(settings.privacyPolicyMarkdown ?? "", businessData));
  return json({
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
    html,
    updatedAt: settings.updatedAt as unknown as string,
  });
}

export default function AvisoDePrivacidad() {
  const { cartCount, html, updatedAt } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
            Legal
          </p>
          <h1 className="mt-2 font-display text-3xl font-black text-carbon sm:text-4xl">
            Aviso de privacidad
          </h1>
          {updatedAt && (
            <p className="mt-2 text-sm text-carbon/50">
              Última actualización: {new Date(updatedAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}.
            </p>
          )}

          <div
            className="prose mt-10 max-w-none prose-headings:font-display prose-headings:font-black prose-headings:text-carbon prose-p:text-carbon/80 prose-li:text-carbon/80 prose-a:text-bosque prose-strong:text-carbon [&_mark]:rounded [&_mark]:bg-lima/40 [&_mark]:px-1"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}
