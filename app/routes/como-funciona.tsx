import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Link, useLoaderData, useRouteLoaderData } from "react-router";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { getCart } from "~/lib/cart.server";
import { buildBreadcrumbJsonLd } from "~/lib/seo";
import { getLegalSettings } from "~/models/legalSettings.server";
import { siteOrigin } from "~/lib/siteOrigin.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: "Cómo funciona — STOPee" },
  {
    name: "description",
    content:
      "Especificaciones técnicas de STOPee: cómo el ricinoleato de zinc y el Bacillus subtilis neutralizan y digieren la orina en cantera, adoquín y concreto, y cómo se aplica.",
  },
  ...(data
    ? [
        buildBreadcrumbJsonLd([
          { name: "Inicio", url: data.origin },
          { name: "Cómo funciona", url: `${data.origin}/como-funciona` },
        ]),
      ]
    : []),
];

export async function loader({ request }: LoaderFunctionArgs) {
  const [cart, legal] = await Promise.all([getCart(request), getLegalSettings()]);
  return data({
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
    origin: siteOrigin(request),
    fichaTecnicaUrl: legal.fichaTecnicaUrl ?? "",
  });
}

type Mechanism = { id: string; short: string; title: string; body: ReactNode };

const MECHANISMS: Mechanism[] = [
  {
    id: "quelacion",
    short: "Neutralización inmediata",
    title: "Neutralización inmediata por quelación molecular",
    body: (
      <>
        El complejo de <strong>ricinoleato de zinc</strong> actúa como un capturador selectivo que
        acompleja al instante las moléculas volátiles de azufre, nitrógeno y amoníaco. Esta reacción
        suprime de raíz la emanación gaseosa, neutralizando el mal olor desde el primer contacto físico
        con la orina.
      </>
    ),
  },
  {
    id: "digestion",
    short: "Digestión en el poro",
    title: "Digestión biocatalítica activa en el poro mineral",
    body: (
      <>
        Las esporas bioactivas de <strong>Bacillus subtilis</strong> (microorganismos benéficos
        ambientales) penetran la microestructura de la cantera, adoquín o concreto. Al activarse con la
        humedad, secretan enzimas especializadas (uricasa, ureasa y proteasas) que descomponen de forma
        continua los cristales insolubles de ácido úrico, la urea y las proteínas de marcaje. Todo
        residuo orgánico se transforma en agua (H<sub>2</sub>O) y dióxido de carbono (CO<sub>2</sub>) de
        forma totalmente limpia, transparente e invisible.
      </>
    ),
  },
  {
    id: "sobremarcado",
    short: "Fin del sobremarcado",
    title: "Ruptura del ciclo de sobremarcado territorial",
    body: (
      <>
        Al degradar las feromonas que los perros identifican como firma olfativa, STOPee restablece la
        neutralidad del entorno. Esto desactiva el estímulo químico que lleva a diferentes mascotas a
        sobremarcar repetitivamente el mismo poste, muro o jardinera, evitando la acumulación crónica de
        orina.
      </>
    ),
  },
  {
    id: "preservacion",
    short: "Preservación y seguridad",
    title: "Preservación arquitectónica y bioseguridad",
    body: (
      <>
        Disuelve los residuos orgánicos ácidos que manchan la piedra natural y aceleran el deterioro de
        las bases metálicas de luminarias. Es una fórmula 100% biodegradable, amigable con áreas
        ajardinadas y segura para el contacto directo de mascotas y transeúntes.
      </>
    ),
  },
];

const STEPS = [
  {
    title: "Dosificar y diluir",
    body: "Vierte 1 tapita del litro concentrado dentro del envase dosificador flexible de 500 ml y rellena con agua corriente. Cada litro de concentrado rinde 30 litros de solución activa.",
  },
  {
    title: "Aplicar con chorro directo",
    body: "Presiona el envase flexible proyectando un chorro focalizado directo sobre la orina en banquetas, accesos, cantera, adoquín o postes.",
  },
  {
    title: "Acción autónoma (leave-on)",
    body: "Sin cepillado, escobas ni enjuague con cubetas. La fórmula penetra por capilaridad en el material, metaboliza la materia orgánica y se seca de forma autónoma.",
  },
];

const NOT_ITEMS = [
  {
    title: "No es un repelente conductual",
    body: "STOPee no ahuyenta, no asusta ni condiciona la conducta de las mascotas. Su función es degradar la orina existente y eliminar la firma olfativa acumulada para que la superficie deje de actuar como un imán de sobremarcado.",
  },
  {
    title: "No es un limpiador de tallado",
    body: "No contiene agentes espumantes ni jabonosos para tallar con escoba ni requiere enjuague posterior con agua a presión. Es un tratamiento biocatalítico directo que actúa y se absorbe por sí solo.",
  },
  {
    title: "No es un perfume de cobertura",
    body: "No disfraza los olores con fragancias artificiales intensas; inactiva las moléculas que generan el mal olor directamente en su estructura química.",
  },
];

const SPECS: { parameter: string; value: string }[] = [
  { parameter: "Ingredientes activos", value: "Esporas viables de Bacillus subtilis y complejo de ricinoleato de zinc." },
  {
    parameter: "Rendimiento certificado",
    value: "1 litro de concentrado = 30 litros de solución activa (60 recargas exactas del envase de 500 ml).",
  },
  {
    parameter: "Método de preparación",
    value: "1 tapa dosificadora (incluida en el envase de 1 L) por cada 500 ml de agua corriente.",
  },
  {
    parameter: "Modo de aplicación",
    value: "Aplicación focalizada mediante envase flexible comprimible (leave-on, sin enjuague).",
  },
  {
    parameter: "Sustratos compatibles",
    value: "Cantera, concreto hidráulico, adoquín, granito, recubrimientos pétreos, bases de luminarias y tierra/jardineras.",
  },
  {
    parameter: "Seguridad y balance",
    value: "Biodegradable, pH neutro, libre de cloro, sosa y amoníaco. No corrosivo, seguro para mascotas y transeúntes.",
  },
];

/** Tabs accesibles (patrón WAI-ARIA): flechas/Home/End mueven la selección. */
function MechanismTabs() {
  const [activeId, setActiveId] = useState(MECHANISMS[0].id);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = MECHANISMS.findIndex((m) => m.id === activeId);
  const active = MECHANISMS[activeIndex];

  const select = (index: number) => {
    const next = (index + MECHANISMS.length) % MECHANISMS.length;
    setActiveId(MECHANISMS[next].id);
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      select(index + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      select(index - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      select(0);
    } else if (e.key === "End") {
      e.preventDefault();
      select(MECHANISMS.length - 1);
    }
  };

  return (
    <div className="mt-8 grid gap-4 lg:grid-cols-[18rem_1fr] lg:gap-8">
      <div role="tablist" aria-label="Mecanismo de acción" className="grid grid-cols-2 gap-2 lg:grid-cols-1">
        {MECHANISMS.map((m, index) => {
          const selected = m.id === activeId;
          return (
            <button
              key={m.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${m.id}`}
              aria-selected={selected}
              aria-controls={`panel-${m.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(m.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={`min-h-14 rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-colors ${
                selected
                  ? "border-carbon bg-carbon text-hueso"
                  : "border-carbon/10 bg-white text-carbon/80 hover:border-carbon/30"
              }`}
            >
              {m.short}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${active.id}`}
        aria-labelledby={`tab-${active.id}`}
        tabIndex={0}
        className="rounded-3xl border border-carbon/10 bg-white p-6 sm:p-8"
      >
        <h3 className="font-display text-xl font-black text-carbon sm:text-2xl">{active.title}</h3>
        <p className="mt-4 leading-relaxed text-carbon/75">{active.body}</p>
      </div>
    </div>
  );
}

export default function ComoFunciona() {
  const { cartCount, fichaTecnicaUrl } = useLoaderData<typeof loader>();
  const rootData = useRouteLoaderData<{ whatsappNumber?: string }>("root");
  const whatsappNumber = rootData?.whatsappNumber ?? "";
  const whatsappDisplay = whatsappNumber.length === 12 && whatsappNumber.startsWith("52")
    ? `${whatsappNumber.slice(2, 4)} ${whatsappNumber.slice(4, 8)}-${whatsappNumber.slice(8)}`
    : whatsappNumber;

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-16">
          <Breadcrumbs items={[{ label: "Inicio", href: "/" }, { label: "Cómo funciona" }]} />

          {/* Encabezado */}
          <header className="mt-6 max-w-3xl">
            <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
              Especificaciones técnicas
            </p>
            <h1 className="mt-2 text-balance font-display text-3xl font-black text-carbon sm:text-5xl">
              Biotecnología urbana contra la orina
            </h1>
            <p className="mt-3 font-display text-lg font-bold text-bosque sm:text-xl">
              Control biológico de orina y preservación de entornos minerales
            </p>
            <p className="mt-4 text-lg leading-relaxed text-carbon/75">
              STOPee es una solución biotecnológica formulada para resolver la acumulación de orina y
              erradicar los malos olores en banquetas, accesos peatonales, muros de cantera, adoquines,
              postes y jardineras. Protege la imagen urbana y la plusvalía arquitectónica actuando
              directamente sobre los componentes orgánicos de la orina.
            </p>
            <nav aria-label="En esta página" className="mt-6 flex flex-wrap gap-2 text-sm font-semibold">
              {[
                ["#mecanismo", "Mecanismo"],
                ["#aplicacion", "Aplicación"],
                ["#alcance", "Qué NO es"],
                ["#datos", "Datos técnicos"],
                ["#contacto", "Ficha y contacto"],
              ].map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  className="min-h-10 rounded-full border border-carbon/15 px-4 py-2 text-carbon/80 hover:border-carbon/40 hover:text-carbon"
                >
                  {label}
                </a>
              ))}
            </nav>
          </header>

          {/* 1. Mecanismo */}
          <section id="mecanismo" className="mt-16 scroll-mt-24">
            <h2 className="font-display text-2xl font-black text-carbon sm:text-3xl">
              Mecanismo de acción biotecnológico
            </h2>
            <MechanismTabs />
          </section>

          {/* 2. Aplicación */}
          <section id="aplicacion" className="mt-16 scroll-mt-24">
            <h2 className="font-display text-2xl font-black text-carbon sm:text-3xl">
              Preparación y aplicación operativa
            </h2>
            <ol className="mt-8 grid gap-4 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex flex-col rounded-3xl border border-carbon/10 bg-white p-6">
                  <span className="font-display text-sm font-bold uppercase tracking-widest text-oliva">
                    Paso {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-2 font-display text-lg font-black text-carbon">{step.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-carbon/70">{step.body}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* 3. Alcance */}
          <section
            id="alcance"
            className="mt-16 scroll-mt-24 rounded-[2rem] bg-carbon p-6 text-hueso sm:p-10"
          >
            <p className="font-body text-sm font-bold uppercase tracking-widest text-limaNeon">
              Transparencia técnica
            </p>
            <h2 className="mt-2 font-display text-2xl font-black sm:text-3xl">
              Alcance operativo: ¿qué NO es STOPee?
            </h2>
            <div className="mt-8 grid gap-6 md:grid-cols-3 md:gap-8">
              {NOT_ITEMS.map((item) => (
                <div key={item.title}>
                  <h3 className="font-display text-lg font-bold text-lima">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-hueso/75">{item.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 4. Datos técnicos */}
          <section id="datos" className="mt-16 scroll-mt-24">
            <h2 className="font-display text-2xl font-black text-carbon sm:text-3xl">
              Datos técnicos y rendimiento certificado
            </h2>
            <dl className="mt-8 divide-y divide-carbon/10 overflow-hidden rounded-3xl border border-carbon/10 bg-white">
              {SPECS.map((row) => (
                <div key={row.parameter} className="grid gap-1 px-5 py-4 sm:grid-cols-[14rem_1fr] sm:gap-6 sm:px-6">
                  <dt className="text-sm font-bold text-bosque">{row.parameter}</dt>
                  <dd className="text-sm leading-relaxed text-carbon/80">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* 5. Documentación y contacto */}
          <section
            id="contacto"
            className="mt-16 scroll-mt-24 rounded-[2rem] border border-carbon/10 bg-white p-6 sm:p-10"
          >
            <h2 className="font-display text-2xl font-black text-carbon sm:text-3xl">
              Documentación y contacto directo
            </h2>
            <p className="mt-3 max-w-2xl text-carbon/70">
              Descarga la ficha técnica o escríbenos si administras una colonia, condominio, comercio o
              espacio público y necesitas cotizar.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {whatsappNumber && (
                <a
                  href={`https://wa.me/${whatsappNumber}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-lima px-7 py-3 text-sm font-bold text-carbon transition-transform hover:scale-105 active:scale-95"
                >
                  Pedidos para administraciones: WhatsApp {whatsappDisplay}
                </a>
              )}
              {fichaTecnicaUrl && (
                <a
                  href={fichaTecnicaUrl}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-carbon/20 px-7 py-3 text-sm font-semibold text-carbon hover:border-carbon/40"
                >
                  Descargar ficha técnica (PDF)
                </a>
              )}
              {!whatsappNumber && (
                <Link
                  to="/contacto"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-lima px-7 py-3 text-sm font-bold text-carbon"
                >
                  Contactar
                </Link>
              )}
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
