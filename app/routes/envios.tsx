import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { getCart } from "~/lib/cart.server";
import { renderMarkdown } from "~/lib/markdown.server";
import { getShippingConfig } from "~/models/shipping.server";
import { SHIPPING_METHOD_IDS, type ShippingMethodId } from "~/lib/shippingMethods";

export const meta: MetaFunction = () => [
  { title: "Envíos — STOPee" },
  {
    name: "description",
    content: "Cómo recibes tu pedido de STOPee: recolección en punto de entrega o envío estándar a domicilio, con costos y tiempos.",
  },
];

/** Anclas legibles para los enlaces "Leer más" del carrito: /envios#recoleccion y /envios#domicilio. */
const ANCHORS: Record<ShippingMethodId, string> = { pickup: "recoleccion", home: "domicilio" };

export async function loader({ request }: LoaderFunctionArgs) {
  const [cart, config] = await Promise.all([getCart(request), getShippingConfig()]);
  const methods = SHIPPING_METHOD_IDS.filter((id) => config.methods[id].isActive).map((id) => {
    const method = config.methods[id];
    return {
      id,
      anchor: ANCHORS[id],
      label: method.label,
      note: method.note,
      cost: method.cost,
      deliveryTime: method.deliveryTime,
      html: renderMarkdown(method.details),
    };
  });
  return json({
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
    shippingEnabled: config.isEnabled,
    methods,
    freeShippingThreshold: config.isEnabled && config.freeShippingEnabled ? config.freeShippingThreshold : null,
  });
}

const proseClass =
  "prose max-w-none prose-headings:font-display prose-headings:font-black prose-headings:text-carbon prose-h2:mt-6 prose-h2:text-lg prose-p:text-carbon/80 prose-li:text-carbon/80 prose-strong:text-carbon";

export default function Envios() {
  const { cartCount, shippingEnabled, methods, freeShippingThreshold } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <Breadcrumbs items={[{ label: "Inicio", href: "/" }, { label: "Envíos" }]} />

          <h1 className="mt-6 font-display text-3xl font-black text-carbon sm:text-4xl">Cómo recibes tu pedido</h1>
          <p className="mt-3 max-w-xl text-carbon/70">
            {shippingEnabled && methods.length > 0
              ? "Al pagar eliges entre estas opciones. Aquí te explicamos cada una para que escojas la que más te acomode."
              : "Por ahora tu pedido no genera costo de envío."}
          </p>

          {freeShippingThreshold !== null && (
            <p className="mt-4 rounded-2xl bg-lima/20 px-4 py-3 text-sm font-semibold text-bosque">
              Envío gratis en compras desde ${freeShippingThreshold} MXN, en cualquiera de las dos opciones.
            </p>
          )}

          {shippingEnabled && methods.length > 1 && (
            <nav aria-label="Opciones de envío" className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {methods.map((method) => (
                <a
                  key={method.id}
                  href={`#${method.anchor}`}
                  className="flex min-h-14 flex-col justify-center rounded-2xl border-2 border-carbon/10 bg-white px-4 py-3 transition-colors hover:border-lima"
                >
                  <span className="text-sm font-bold text-carbon">{method.label}</span>
                  <span className="text-sm text-carbon/60">
                    ${method.cost} MXN{method.deliveryTime ? ` · ${method.deliveryTime}` : ""}
                  </span>
                </a>
              ))}
            </nav>
          )}

          {shippingEnabled && (
            <div className="mt-10 flex flex-col gap-8">
              {methods.map((method) => (
                <section
                  key={method.id}
                  id={method.anchor}
                  className="scroll-mt-24 rounded-3xl border-2 border-carbon/10 bg-white p-6 target:border-lima sm:p-8"
                >
                  <h2 className="font-display text-2xl font-black text-carbon">{method.label}</h2>

                  <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-hueso px-4 py-3">
                      <dt className="text-xs font-bold uppercase tracking-wide text-carbon/50">Costo</dt>
                      <dd className="mt-0.5 text-lg font-bold text-carbon">${method.cost} MXN</dd>
                    </div>
                    {method.deliveryTime && (
                      <div className="rounded-2xl bg-hueso px-4 py-3">
                        <dt className="text-xs font-bold uppercase tracking-wide text-carbon/50">Tiempo estimado</dt>
                        <dd className="mt-0.5 text-lg font-bold text-carbon">{method.deliveryTime}</dd>
                      </div>
                    )}
                  </dl>

                  {method.note && <p className="mt-4 text-sm font-semibold text-bosque">{method.note}</p>}

                  <div className={`${proseClass} mt-2`} dangerouslySetInnerHTML={{ __html: method.html }} />
                </section>
              ))}
            </div>
          )}

          <div className="mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <Link
              to="/tienda"
              className="inline-flex min-h-12 items-center rounded-full bg-carbon px-8 text-sm font-bold text-hueso"
            >
              Ir a la tienda
            </Link>
            <p className="text-sm text-carbon/60">
              ¿Dudas sobre tu envío?{" "}
              <Link to="/contacto" className="font-semibold text-bosque underline">
                Escríbenos
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
