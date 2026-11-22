import { isStaff } from "~/lib/roles";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useNavigation,
  useRouteError,
  useRouteLoaderData,
} from "@remix-run/react";
import tailwind from "~/tailwind.css?url";
import { getSiteSettingsCached } from "~/models/siteSettings.server";
import { getSubscriptionConfigCached } from "~/models/subscriptionSettings.server";
import { getLegalSettingsCached } from "~/models/legalSettings.server";
import { detectNetwork } from "~/lib/socialNetworks";
import { getExitIntentPopupCached } from "~/models/exitIntentPopup.server";
import { getPasswordGateConfigCached, isGateWindowActive, isPathGated } from "~/models/passwordGate.server";
import { hasGateAccess } from "~/lib/gateSession.server";
import { readOrCaptureAttribution, isAttributableEntryPoint } from "~/lib/attribution.server";
import { getOrCreateVisitorId, logEvent } from "~/lib/tracking.server";
import { getCart } from "~/lib/cart.server";
import { getUser } from "~/lib/session.server";
import { useNonce } from "~/lib/nonce";
import { WhatsAppButton } from "~/components/ui/WhatsAppButton";
import { BackToTopButton } from "~/components/ui/BackToTopButton";
import { ExitIntentPopup } from "~/components/ui/ExitIntentPopup";
import { GlobalLoadingBar } from "~/components/ui/GlobalLoadingBar";
import { isValidGooglePixelId, isValidMetaPixelId, linkTargetOr } from "~/lib/inputValidation";

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

  // Captura de atribución a primer toque (utm_source/medium/campaign): debe
  // vivir en el root porque un anuncio puede aterrizar en cualquier página,
  // no solo en "/". Se hace aparte del try/catch de Mongo: no depende de la
  // base de datos, así que nunca debe bloquearse por un hipo ahí.
  const { attribution: _attribution, setCookieHeader: attributionCookieHeader } =
    await readOrCaptureAttribution(request);
  let visitorCookieHeader: string | null = null;

  // page_view real (servidor, no depende de que el JS del cliente cargue)
  // solo en las páginas que de verdad importan para el embudo — no en
  // /admin, /cuenta, checkout, etc.
  if (isAttributableEntryPoint(pathname)) {
    try {
      const { visitorId, setCookieHeader } = await getOrCreateVisitorId(request);
      visitorCookieHeader = setCookieHeader;
      await logEvent(visitorId, "page_view");
    } catch {
      // El tracking nunca debe tumbar la página.
    }
  }

  const headers = new Headers();
  if (attributionCookieHeader) headers.append("Set-Cookie", attributionCookieHeader);
  if (visitorCookieHeader) headers.append("Set-Cookie", visitorCookieHeader);

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
    return json(
      {
        storeVisible,
        // Defensa extra: aunque la base tenga un valor viejo o alterado, solo se imprime si tiene el formato exacto.
        googlePixelId: isValidGooglePixelId(settings.googlePixelId ?? "") ? settings.googlePixelId! : "",
        metaPixelId: isValidMetaPixelId(settings.metaPixelId ?? "") ? settings.metaPixelId! : "",
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
    return json(
      {
        storeVisible: false,
        googlePixelId: "",
        metaPixelId: "",
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
function Document({
  googlePixelId,
  metaPixelId,
  children,
}: {
  googlePixelId?: string;
  metaPixelId?: string;
  children: React.ReactNode;
}) {
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

        {googlePixelId && (
          <>
            <script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${googlePixelId}`}
            />
            <script
              nonce={nonce}
              dangerouslySetInnerHTML={{
                __html: `
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  gtag('config', '${googlePixelId}');
                `,
              }}
            />
          </>
        )}

        {metaPixelId && (
          <script
            nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: `
                !function(f,b,e,v,n,t,s)
                {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)}(window, document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');
                fbq('init', '${metaPixelId}');
                fbq('track', 'PageView');
              `,
            }}
          />
        )}
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
    googlePixelId,
    metaPixelId,
    announcementBarText,
    whatsappNumber,
    isStoreActive,
    cartHasItems,
    exitIntent,
  } = useLoaderData<typeof loader>();

  return (
    <Document googlePixelId={googlePixelId} metaPixelId={metaPixelId}>
      {announcementBarText && (
        <div className="bg-lima px-4 py-2 text-center text-sm font-bold text-carbon">
          {announcementBarText}
        </div>
      )}
      <Outlet />
      <WhatsAppButton whatsappNumber={whatsappNumber} raised={!isStoreActive} cartHasItems={cartHasItems} />
      <BackToTopButton />
      {exitIntent && <ExitIntentPopup config={exitIntent} />}
    </Document>
  );
}

export const meta: MetaFunction = ({ error }) => [
  { title: isRouteErrorResponse(error) && error.status === 404 ? "Página no encontrada — STOPee" : "Algo salió mal — STOPee" },
];

export function ErrorBoundary() {
  const error = useRouteError();
  // useLoaderData() no es confiable dentro de un ErrorBoundary (Remix no
  // garantiza que la data del loader de ESTA ruta siga disponible), y si la
  // URL no hace match con ninguna ruta el loader del root ni siquiera llega
  // a correr — por eso el pixel/anuncio pueden faltar aquí (no hay de dónde
  // sacarlos) aunque el nonce del CSP sí siempre está bien (viene de
  // NonceContext, no del loader — ver Document).
  const rootData = useRouteLoaderData<typeof loader>("root");

  const is404 = isRouteErrorResponse(error) && error.status === 404;

  return (
    <Document googlePixelId={rootData?.googlePixelId} metaPixelId={rootData?.metaPixelId}>
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
        <a
          href="/"
          className="mt-8 inline-flex min-h-11 items-center rounded-full bg-lima px-8 text-sm font-bold text-carbon transition-transform hover:scale-105"
        >
          Volver al inicio
        </a>
      </div>
    </Document>
  );
}
