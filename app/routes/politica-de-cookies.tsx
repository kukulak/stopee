import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useLoaderData } from "react-router";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { CookieSettingsButton } from "~/components/ui/CookieConsent";
import { getCart } from "~/lib/cart.server";
import { getLegalSettings, DEFAULT_COOKIES_MARKDOWN } from "~/models/legalSettings.server";
import { applyLegalVariables } from "~/lib/legalTemplate";
import { renderMarkdown } from "~/lib/markdown.server";

export const meta: MetaFunction = () => [
  { title: "Política de cookies — STOPee" },
  {
    name: "description",
    content:
      "Política de cookies de STOPee: qué cookies usamos, para qué sirven, cuánto duran y cómo cambiar tu elección.",
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
  // Los datos guardados antes de existir esta política no traen el texto: se usa el de fábrica.
  const markdown = settings.cookiesMarkdown?.trim() ? settings.cookiesMarkdown : DEFAULT_COOKIES_MARKDOWN;
  const html = renderMarkdown(applyLegalVariables(markdown, businessData));
  return data({
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
    html,
    updatedAt: settings.cookiesMarkdown?.trim() ? (settings.updatedAt as unknown as string) : null,
  });
}

export default function PoliticaDeCookies() {
  const { cartCount, html, updatedAt } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">Legal</p>
          <h1 className="mt-2 font-display text-3xl font-black text-carbon sm:text-4xl">Política de cookies</h1>
          {updatedAt && (
            <p className="mt-2 text-sm text-carbon/50">
              Última actualización:{" "}
              {new Date(updatedAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}.
            </p>
          )}

          <div className="mt-6">
            <CookieSettingsButton className="min-h-11 rounded-full bg-carbon px-6 py-2.5 text-sm font-bold text-hueso hover:bg-carbon/85">
              Configurar mis cookies
            </CookieSettingsButton>
          </div>

          <div
            className="prose mt-10 max-w-none prose-headings:font-display prose-headings:font-black prose-headings:text-carbon prose-p:text-carbon/80 prose-li:text-carbon/80 prose-a:text-bosque prose-strong:text-carbon prose-code:text-carbon [&_mark]:rounded [&_mark]:bg-lima/40 [&_mark]:px-1 [&_table]:block [&_table]:overflow-x-auto [&_td]:align-top [&_th]:text-left"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}
