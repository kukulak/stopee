import { isStaff } from "~/lib/roles";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useLocation,
  useNavigation,
  useRouteError,
  useRouteLoaderData,
} from "react-router";
import tailwind from "~/tailwind.css?url";
import { getSiteSettingsCached } from "~/models/siteSettings.server";
import { getSubscriptionConfigCached } from "~/models/subscriptionSettings.server";
import { getLegalSettingsCached } from "~/models/legalSettings.server";
import { detectNetwork } from "~/lib/socialNetworks";
import { getExitIntentPopupCached } from "~/models/exitIntentPopup.server";
import { getPasswordGateConfigCached, isGateWindowActive, isPathGated } from "~/models/passwordGate.server";
import { hasGateAccess } from "~/lib/gateSession.server";
import { readOrCaptureAttribution, isAttributableEntryPoint } from "~/lib/attribution.server";
import { expireAnalyticsCookies, readConsent } from "~/lib/consent.server";
import { getOrCreateVisitorId, logEvent } from "~/lib/tracking.server";
import { getCart } from "~/lib/cart.server";
import { getUser, getUserId } from "~/lib/session.server";
import { useNonce } from "~/lib/nonce";
import { WhatsAppButton } from "~/components/ui/WhatsAppButton";
import { BackToTopButton } from "~/components/ui/BackToTopButton";
import { ExitIntentPopup } from "~/components/ui/ExitIntentPopup";
import { CookieConsent } from "~/components/ui/CookieConsent";
import { GlobalLoadingBar } from "~/components/ui/GlobalLoadingBar";
import { linkTargetOr } from "~/lib/inputValidation";
import { configuredPixelIds, type PixelIds } from "~/lib/integrations";

export const links: LinksFunction = () => [
  { rel: "icon", href: "/favicon-32.png", sizes: "32x32", type: "image/png" },
  { rel: "icon", href: "/favicon-16.png", sizes: "16x16", type: "image/png" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
  { rel: "stylesheet", href: tailwind },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
  },
];

// Nunca gatear estas rutas aunque el admin configure "rutas específicas" de
// forma descuidada (p. ej. "/") — bloquear el propio admin, el checkout, los
// webhooks de Stripe o la pantalla de desbloqueo dejaría el sitio sin forma
// de arreglarse o cobrarse solo.
const GATE_EXEMPT_PREFIXES = ["/admin", "/api/", "/webhooks/", "/cuenta", "/acceso-privado", "/sitemap.xml"];

export async function loader({ request }: LoaderFunctionArgs) {
  // El nonce del CSP NO sale de aquí — un loader de ruta no corre si ninguna
  // ruta hace match (404 real), así que Document lo toma de NonceContext
  // (ver app/lib/nonce.ts y app/entry.server.tsx), que sí está garantizado.

  const pathname = new URL(request.url).pathname;

  // Acceso Exclusivo con Contraseña: si la ruta está protegida y no hay
  // sesión de desbloqueo, se manda a /acceso-privado ANTES de cualquier otra
  // cosa (tracking, etc.) — recordando a dónde iba con ?redirectTo=.
  if (!GATE_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    try {
      const gateConfig = await getPasswordGateConfigCached();
      if (isGateWindowActive(gateConfig) && isPathGated(gateConfig, pathname)) {
        const unlocked = await hasGateAccess(request);
        if (!unlocked) {
          const search = new URL(request.url).search;
          throw redirect(`/acceso-privado?redirectTo=${encodeURIComponent(pathname + search)}`);
        }
      }
    } catch (err) {
      if (err instanceof Response) throw err;
      // Un hipo de Mongo al checar la compuerta no debe tumbar el sitio —
      // se deja pasar sin gatear en vez de mostrar un 500.
    }
  }

  // Elección de cookies del visitante. Sin permiso para las de estadísticas no se guarda ninguna
  // cookie de medición (atribución ni identificador de visitante) ni se registra la visita, y las
  // que el navegador ya trajera de antes se borran.
  const consent = await readConsent(request);
  const publicConsent = consent
    ? { analytics: consent.analytics, marketing: consent.marketing, decidedAt: consent.decidedAt }
    : null;

  const headers = new Headers();

  if (consent?.analytics) {
    // Captura de atribución a primer toque (utm_source/medium/campaign): debe
    // vivir en el root porque un anuncio puede aterrizar en cualquier página,
    // no solo en "/". Se hace aparte del try/catch de Mongo: no depende de la
    // base de datos, así que nunca debe bloquearse por un hipo ahí.
    const { setCookieHeader: attributionCookieHeader } = await readOrCaptureAttribution(request);
    if (attributionCookieHeader) headers.append("Set-Cookie", attributionCookieHeader);

    // page_view real (servidor, no depende de que el JS del cliente cargue)
    // solo en las páginas que de verdad importan para el embudo — no en
    // /admin, /cuenta, checkout, etc.
    if (isAttributableEntryPoint(pathname)) {
      try {
        const { visitorId, setCookieHeader } = await getOrCreateVisitorId(request);
        if (setCookieHeader) headers.append("Set-Cookie", setCookieHeader);
        await logEvent(visitorId, "page_view");
      } catch {
        // El tracking nunca debe tumbar la página.
      }
    }
  } else {
    for (const expired of expireAnalyticsCookies(request)) headers.append("Set-Cookie", expired);
  }

  // Solo un sí o no, leído de la cookie (sin tocar la base de datos): la página 404 lo usa para ofrecer «Iniciar
  // sesión» únicamente a quien aún no la tiene. No dice nada de quién es ni de si la cuenta es válida.
  const isLoggedIn = Boolean(await getUserId(request));

  // Solo para decidir si el botón de WhatsApp debe subirse en /tienda (ver
  // WhatsAppButton) — es de cookie, no de Mongo, así que no entra al try/catch.
  const cart = await getCart(request);
  const cartHasItems = cart.length > 0;

  // El root loader corre en cada request de todo el sitio; si Mongo tiene un
  // hipo no debe tumbar páginas que no dependen de esto (pixeles/anuncio).
  try {
    const [settings, legal, exitIntent, subscriptionConfig] = await Promise.all([
      getSiteSettingsCached(),
      getLegalSettingsCached(),
      getExitIntentPopupCached(),
      getSubscriptionConfigCached(),
    ]);
    // La tienda se ve (menú, carrito, pie de página) si ya está activa o si
    // quien navega es admin revisándola — para el público sigue oculta.
    const storeVisible = settings.isStoreActive || isStaff((await getUser(request))?.role);
    return data(
      {
        storeVisible,
        isLoggedIn,
        consent: publicConsent,
        // Defensa extra: aunque la base tenga un valor viejo o alterado, solo se usa un ID con el formato exacto.
        pixelIds: configuredPixelIds(settings),
        announcementBarText: settings.announcementBarActive ? settings.announcementBarText ?? "" : "",
        whatsappNumber: legal.whatsappNumber ?? "",
        subscriptionLinkLabel: subscriptionConfig.programName ? `${subscriptionConfig.programName} (auto-envío)` : "Auto-envío",
        logoUrl: legal.logoUrl ?? "",
        logoCompactUrl: legal.logoCompactUrl ?? "",
        socialLinks: (legal.socialLinks ?? []).map((link) => ({ url: link.url, ...detectNetwork(link.url) })),
        isStoreActive: settings.isStoreActive,
        cartHasItems,
        exitIntent: {
          isEnabled: exitIntent.isEnabled,
          title: exitIntent.title ?? "",
          message: exitIntent.message ?? "",
          imageUrl: exitIntent.imageUrl ?? "",
          ctaText: exitIntent.ctaText ?? "",
          ctaHref: linkTargetOr(exitIntent.ctaHref),
          showOnHome: exitIntent.showOnHome,
          showOnTienda: exitIntent.showOnTienda,
          showOnBlog: exitIntent.showOnBlog,
          snoozeDays: exitIntent.snoozeDays ?? 7,
        },
      },
      { headers },
    );
  } catch {
    return data(
      {
        storeVisible: false,
        isLoggedIn,
        consent: publicConsent,
        pixelIds: {} as PixelIds,
        announcementBarText: "",
        whatsappNumber: "",
        subscriptionLinkLabel: "Auto-envío",
        logoUrl: "",
        logoCompactUrl: "",
        socialLinks: [] as { url: string; id: string; name: string }[],
        isStoreActive: false,
        cartHasItems,
        exitIntent: null,
      },
      { headers },
    );
  }
}

/** El esqueleto <html>/<head> es igual para la app normal y para la pantalla de error — solo cambia qué va dentro del <body>. */
function Document({ children }: { children: React.ReactNode }) {
  const nonce = useNonce();
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";

  return (
    <html lang="es-MX">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Título y descripción los pone cada ruta con su propio `meta` (todas
            las páginas reales del sitio ya tienen uno) — tenerlos aquí también
            producía un <title> y un <meta description> duplicados en cada
            página. */}
        <Meta />
        <Links />
      </head>
      <body className="font-body">
        <GlobalLoadingBar />
        <div
          className={`transition-opacity duration-200 ${isNavigating ? "opacity-60" : "opacity-100"}`}
        >
          {children}
        </div>
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  const {
    pixelIds,
    announcementBarText,
    whatsappNumber,
    isStoreActive,
    cartHasItems,
    exitIntent,
    consent,
  } = useLoaderData<typeof loader>();

  return (
    <Document>
      {announcementBarText && (
        <div className="bg-lima px-4 py-2 text-center text-sm font-bold text-carbon">
          {announcementBarText}
        </div>
      )}
      <Outlet />
      <WhatsAppButton whatsappNumber={whatsappNumber} raised={!isStoreActive} cartHasItems={cartHasItems} />
      <BackToTopButton />
      {exitIntent && <ExitIntentPopup config={exitIntent} />}
      <CookieConsent consent={consent} pixelIds={pixelIds} />
    </Document>
  );
}

export const meta: MetaFunction = ({ error }) => [
  { title: isRouteErrorResponse(error) && error.status === 404 ? "Página no encontrada — STOPee" : "Algo salió mal — STOPee" },
];

export function ErrorBoundary() {
  const error = useRouteError();
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  const location = useLocation();
  const root = useRouteLoaderData<typeof loader>("root");
  // El 404 es el MISMO para una página que no existe y para una a la que esta persona no tiene acceso (por
  // ejemplo, un producto solo para aliados): nunca dice cuál es el caso. Lo único que cambia es que, si aún no
  // hay sesión, también se ofrece entrar; al entrar vuelve a esta misma dirección.
  const canOfferLogin = is404 && root?.isLoggedIn === false;

  return (
    <Document>
      <div className="flex min-h-screen flex-col items-center justify-center bg-carbon px-4 py-16 text-center text-hueso">
        <img
          src="/elementos-design/logo-STOPee.webp"
          alt="STOPee"
          className="mb-8 h-16 w-auto"
        />
        <p className="font-body text-sm font-bold uppercase tracking-widest text-lima">
          {is404 ? "Error 404" : "Algo salió mal"}
        </p>
        <h1 className="mt-3 max-w-lg font-display text-3xl font-black sm:text-4xl">
          {is404 ? "No encontramos esta página." : "Tuvimos un problema de nuestro lado."}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-hueso/70">
          {is404
            ? "El link puede estar mal escrito o la página ya no existe."
            : "Ya lo estamos revisando. Mientras tanto, intenta de nuevo o vuelve al inicio."}
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <a
            href="/"
            className="inline-flex min-h-11 items-center rounded-full bg-lima px-8 text-sm font-bold text-carbon transition-transform hover:scale-105"
          >
            Volver al inicio
          </a>
          {canOfferLogin && (
            <a
              href={`/cuenta/entrar?redirectTo=${encodeURIComponent(location.pathname + location.search)}`}
              className="inline-flex min-h-11 items-center rounded-full border border-hueso/30 px-8 text-sm font-semibold text-hueso transition-colors hover:border-hueso/60"
            >
              Iniciar sesión
            </a>
          )}
        </div>
      </div>
    </Document>
  );
}
