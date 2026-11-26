import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { getCart } from "~/lib/cart.server";
import { getLegalSettings } from "~/models/legalSettings.server";
import { sendEmail } from "~/lib/mail.server";
import { allyRequestNotificationEmail } from "~/lib/emailTemplates.server";
import { logError } from "~/lib/logger.server";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { cleanPlainText, rejectForeignOrigin } from "~/lib/formGuard.server";
import { allyRequestSchema, createAllyRequest, getPublicRefillPoints } from "~/lib/refillPoints.server";
import {
  BUSINESS_TYPES,
  directionsUrl,
  filterByNeighborhood,
  neighborhoodOptions,
  whatsappUrl,
  type PublicRefillPoint,
} from "~/lib/refillPoints";
import { siteOrigin } from "~/lib/siteOrigin.server";
import { buildBreadcrumbJsonLd } from "~/lib/seo";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = "Puntos de Recarga STOPee — recarga sin envases desechables";
  const description =
    "Encuentra un Punto de Recarga STOPee cerca de ti, o conviértete en uno: economía circular, comunidad y cero envases desechables.";
  return [
    { title },
    { name: "description", content: description },
    ...(data
      ? [
          buildBreadcrumbJsonLd([
            { name: "Inicio", url: data.origin },
            { name: "Puntos de Recarga", url: `${data.origin}/puntos-de-recarga` },
          ]),
        ]
      : []),
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const [cart, points] = await Promise.all([getCart(request), getPublicRefillPoints()]);
  const neighborhoods = neighborhoodOptions(points);
  // Solo se acepta una colonia que existe en el directorio; cualquier otro valor se ignora.
  const requested = url.searchParams.get("colonia") ?? "";
  const selected = neighborhoods.find((n) => n === requested) ?? "";
  return data({
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
    origin: siteOrigin(request),
    neighborhoods,
    selected,
    totalPoints: points.length,
    points: filterByNeighborhood(points, selected),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const foreign = rejectForeignOrigin(request);
  if (foreign) return foreign;

  // El límite va antes de leer el cuerpo, igual que en el formulario de contacto.
  const ip = getClientIp(request);
  const ipLimit = await checkRateLimit(`aliados:${ip}`, { max: 5, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.allowed) {
    return data({ ok: false, error: rateLimitMessage(ipLimit.retryAfterSeconds) }, { status: 429 });
  }

  const formData = await request.formData();

  // Campo trampa: una persona no lo ve ni lo llena. Si trae algo, se responde "listo" sin guardar nada.
  if (cleanPlainText(formData.get("website"))) return data({ ok: true, error: undefined as string | undefined });

  const parsed = allyRequestSchema.safeParse({
    name: cleanPlainText(formData.get("name")),
    businessName: cleanPlainText(formData.get("businessName")),
    businessOrType: cleanPlainText(formData.get("businessOrType")),
    neighborhood: cleanPlainText(formData.get("neighborhood")),
    address: cleanPlainText(formData.get("address")),
    whatsapp: cleanPlainText(formData.get("whatsapp")),
    email: cleanPlainText(formData.get("email")),
    privacy: formData.get("privacy") === "on" ? "on" : "",
  });
  if (!parsed.success) {
    return data({ ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." }, { status: 400 });
  }

  // Tope por correo: nadie debe poder llenar el panel ni el correo del negocio escribiendo seguido.
  const emailLimit = await checkRateLimit(`aliados-email:${parsed.data.email}`, { max: 2, windowMs: 24 * 60 * 60 * 1000 });
  if (!emailLimit.allowed) return data({ ok: true, error: undefined as string | undefined });

  const { name, businessName, businessOrType, neighborhood, address, whatsapp, email } = parsed.data;
  const submitted = { name, businessName, businessOrType, neighborhood, address, whatsapp, email };
  const { created } = await createAllyRequest(submitted);

  // El aviso al negocio va después de guardar (la solicitud nunca se pierde) y solo si es nueva.
  if (created) {
    try {
      let correoContacto = "";
      try {
        correoContacto = ((await getLegalSettings()).correoContacto ?? "").trim();
      } catch (error) {
        logError("puntos-de-recarga.settings", error);
      }
      const recipient = correoContacto || (process.env.ADMIN_EMAIL ?? "").trim();
      if (recipient) {
        const mail = allyRequestNotificationEmail(submitted);
        await sendEmail({
          to: { email: recipient },
          replyTo: { email, name },
          ...mail,
          subject: mail.subject.replace(/[\r\n]+/g, " "),
        });
      }
    } catch (error) {
      logError("puntos-de-recarga.notify", error);
    }
  }

  // Misma respuesta exista o no una solicitud previa con ese correo.
  return data({ ok: true, error: undefined as string | undefined });
}

const inputClass =
  "mt-1 w-full min-h-11 rounded-xl border border-carbon/15 bg-white px-4 text-base text-carbon focus:border-oliva focus:outline-none sm:text-sm";

export default function PuntosDeRecarga() {
  const { cartCount, neighborhoods, selected, totalPoints, points } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle" && navigation.formMethod === "POST";

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <Breadcrumbs items={[{ label: "Inicio", href: "/" }, { label: "Puntos de Recarga" }]} />

          <p className="mt-6 font-body text-sm font-bold uppercase tracking-widest text-oliva">Puntos de Recarga</p>
          <h1 className="mt-2 max-w-2xl font-display text-3xl font-black text-carbon sm:text-4xl">
            Recarga tu STOPee cerca de casa, sin envases desechables
          </h1>
          <p className="mt-3 max-w-2xl text-carbon/70">
            Veterinarias, pet shops y vecinos aliados recargan tu botella con concentrado STOPee. Menos plástico, más
            comunidad, y tu calle limpia.
          </p>

          {/* Directorio */}
          <section aria-labelledby="directorio" className="mt-12">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <h2 id="directorio" className="font-display text-2xl font-black text-carbon">
                Encuentra un punto
              </h2>
              {neighborhoods.length > 1 && (
                <Form method="get" className="flex items-end gap-2">
                  <div>
                    <label htmlFor="colonia" className="block text-sm font-semibold text-carbon">
                      Tu colonia
                    </label>
                    <select id="colonia" name="colonia" defaultValue={selected} className={`${inputClass} sm:w-56`}>
                      <option value="">Todas</option>
                      {neighborhoods.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="mt-1 min-h-11 rounded-full border border-carbon/15 px-5 text-sm font-semibold text-carbon hover:border-carbon/30"
                  >
                    Ver
                  </button>
                </Form>
              )}
            </div>

            {points.length > 0 ? (
              <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {points.map((point) => (
                  <PointCard key={point.id} point={point} />
                ))}
              </ul>
            ) : (
              <div className="mt-6 rounded-3xl border border-dashed border-carbon/20 bg-white p-6 text-center sm:p-8">
                <p className="font-display text-lg font-bold text-carbon">
                  {totalPoints > 0 ? "Todavía no hay un punto en esa colonia." : "Estamos abriendo los primeros puntos."}
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-carbon/70">
                  {totalPoints > 0 && (
                    <>
                      <Link to="/puntos-de-recarga" className="font-semibold text-bosque underline">
                        Ver todos los puntos
                      </Link>
                      , o{" "}
                    </>
                  )}
                  {totalPoints > 0 ? "sé" : "Sé"} el primero en tu colonia: conviértete en Punto de Recarga.
                </p>
                <a
                  href="#solicitud"
                  className="mt-4 inline-flex min-h-11 items-center rounded-full bg-lima px-6 text-sm font-bold text-carbon"
                >
                  Quiero ser un punto
                </a>
              </div>
            )}
          </section>

          {/* Captación: el texto a la izquierda y el formulario a la derecha, para aprovechar el ancho. */}
          <section
            id="solicitud"
            aria-labelledby="ser-punto"
            className="mt-16 scroll-mt-28 rounded-3xl border border-lima/30 bg-bosque/5 p-6 sm:p-8 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12 lg:p-10"
          >
            <div className="lg:pt-2">
              <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">Para negocios y vecinos</p>
              <h2 id="ser-punto" className="mt-2 text-balance font-display text-2xl font-black text-carbon sm:text-3xl">
                Conviértete en Punto de Recarga STOPee
              </h2>
              <p className="mt-3 text-carbon/70">
                Genera ingresos extra con economía circular, sin envases desechables. Tu comunidad recarga cerca de casa y
                tu negocio suma una razón más para que vuelvan.
              </p>
              <ul className="mt-5 flex flex-col gap-2 text-sm text-carbon/80">
                <li>Recibes concentrado en bidón y recargas las botellas de tus vecinos y clientes.</li>
                <li>Apareces en este directorio para que te encuentren por colonia.</li>
                <li>Te enlazamos a tu cuenta de STOPee y la identificamos como aliado.</li>
                <li>Platicamos contigo por WhatsApp antes de empezar, sin compromiso.</li>
              </ul>
            </div>

            <div className="mt-8 lg:mt-0">
              {actionData?.ok ? (
                <div role="status" className="rounded-3xl border-2 border-lima bg-white p-6 text-center sm:p-8">
                  <p className="font-display text-xl font-black text-carbon">Recibimos tu solicitud</p>
                  <p className="mx-auto mt-2 max-w-md text-carbon/70">
                    Gracias por querer sumarte. Revisamos tus datos y te escribimos por WhatsApp o por correo para platicar
                    los siguientes pasos. Si aún no tienes cuenta de STOPee, créala con este mismo correo: al aprobarte, se
                    activa sola como aliada.
                  </p>
                  <Link to="/" className="mt-4 inline-flex min-h-11 items-center rounded-full border border-carbon/15 px-5 text-sm font-semibold text-carbon hover:border-carbon/30">
                    Volver al inicio
                  </Link>
                </div>
              ) : (
                <Form method="post" className="flex flex-col gap-4 rounded-3xl bg-white/60 p-0 lg:bg-transparent">
                  {/* Campo trampa para programas que llenan todo: una persona no lo ve. */}
                  <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                    <label htmlFor="website">No llenar este campo</label>
                    <input id="website" name="website" tabIndex={-1} autoComplete="off" />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="name" className="block text-sm font-semibold text-carbon">
                        Tu nombre
                      </label>
                      <input id="name" name="name" required minLength={2} maxLength={80} autoComplete="name" className={inputClass} />
                    </div>
                    <div>
                      <label htmlFor="businessOrType" className="block text-sm font-semibold text-carbon">
                        ¿Qué tipo de punto serías?
                      </label>
                      <select id="businessOrType" name="businessOrType" required defaultValue="" className={inputClass}>
                        <option value="" disabled>
                          Elige una opción
                        </option>
                        {BUSINESS_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="businessName" className="block text-sm font-semibold text-carbon">
                      Nombre de tu negocio <span className="font-normal text-carbon/50">(opcional)</span>
                    </label>
                    <input id="businessName" name="businessName" maxLength={80} autoComplete="organization" placeholder="Veterinaria San Ángel" className={inputClass} />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="neighborhood" className="block text-sm font-semibold text-carbon">
                        Colonia
                      </label>
                      <input id="neighborhood" name="neighborhood" required minLength={2} maxLength={80} className={inputClass} />
                    </div>
                    <div>
                      <label htmlFor="whatsapp" className="block text-sm font-semibold text-carbon">
                        WhatsApp
                      </label>
                      <input id="whatsapp" name="whatsapp" type="tel" inputMode="tel" required autoComplete="tel" maxLength={20} className={inputClass} />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="address" className="block text-sm font-semibold text-carbon">
                      Dirección o referencia
                    </label>
                    <input id="address" name="address" required minLength={5} maxLength={160} autoComplete="street-address" className={inputClass} />
                  </div>

                  <div>
                    <label htmlFor="email" className="block text-sm font-semibold text-carbon">
                      Correo
                    </label>
                    <input id="email" name="email" type="email" inputMode="email" required maxLength={100} autoComplete="email" className={inputClass} />
                    <p className="mt-1 text-xs text-carbon/60">Usa el mismo correo de tu cuenta de STOPee (o con el que la crearás).</p>
                  </div>

                  <label htmlFor="privacy" className="flex min-h-11 items-start gap-3 text-sm text-carbon/80">
                    <input id="privacy" name="privacy" type="checkbox" required className="mt-1 h-5 w-5 shrink-0 accent-bosque" />
                    <span>
                      Al enviar esta solicitud acepto el{" "}
                      <a href="/aviso-de-privacidad" target="_blank" rel="noreferrer" className="font-semibold text-bosque underline">
                        aviso de privacidad
                      </a>
                      . Mis datos de contacto y ubicación solo se publicarán en el directorio si autorizo activar mi punto
                      al público.
                    </span>
                  </label>

                  {actionData && !actionData.ok && actionData.error && (
                    <p role="alert" className="text-sm font-semibold text-red-600">
                      {actionData.error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex min-h-12 items-center justify-center self-end rounded-full bg-lima px-8 text-sm font-bold text-carbon transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-60"
                  >
                    {isSubmitting ? "Enviando…" : "Enviar mi solicitud"}
                  </button>
                </Form>
              )}
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function PointCard({ point }: { point: PublicRefillPoint }) {
  const link = whatsappUrl(point.whatsapp, `Hola, quiero recargar mi STOPee en ${point.businessName}.`);
  return (
    <li className="flex min-w-0 flex-col rounded-3xl border border-carbon/10 bg-white p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-oliva">
        {point.neighborhood}
        {point.city ? ` · ${point.city}` : ""}
      </p>
      <h3 className="mt-1 break-words font-display text-lg font-black text-carbon">{point.businessName}</h3>
      <dl className="mt-3 flex flex-1 flex-col gap-2 text-sm">
        {point.address && (
          <div>
            <dt className="text-xs font-semibold text-carbon/50">Dónde</dt>
            <dd className="break-words text-carbon/80">{point.address}</dd>
          </div>
        )}
        {point.schedule && (
          <div>
            <dt className="text-xs font-semibold text-carbon/50">Horario de recarga</dt>
            <dd className="break-words text-carbon/80">{point.schedule}</dd>
          </div>
        )}
      </dl>
      <div className="mt-4 flex flex-col gap-2">
        <a
          href={directionsUrl(point)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-carbon px-5 text-sm font-bold text-hueso transition-colors hover:bg-bosque"
        >
          Abrir mapa
        </a>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-carbon/15 px-5 text-sm font-semibold text-carbon transition-colors hover:border-carbon/30"
          >
            Escribir por WhatsApp
          </a>
        )}
      </div>
    </li>
  );
}
