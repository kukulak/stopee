import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import tailwind from "~/tailwind.css?url";
import { getSiteSettings } from "~/models/siteSettings.server";
import { readOrCaptureAttribution, isAttributableEntryPoint } from "~/lib/attribution.server";
import { getOrCreateVisitorId, logEvent } from "~/lib/tracking.server";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: tailwind },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
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
  const pathname = new URL(request.url).pathname;
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

  // El root loader corre en cada request de todo el sitio; si Mongo tiene un
  // hipo no debe tumbar páginas que no dependen de esto (pixeles/anuncio).
  try {
    const settings = await getSiteSettings();
    return json(
      {
        googlePixelId: settings.googlePixelId ?? "",
        metaPixelId: settings.metaPixelId ?? "",
        announcementBarText: settings.announcementBarActive ? settings.announcementBarText ?? "" : "",
      },
      { headers },
    );
  } catch {
    return json({ googlePixelId: "", metaPixelId: "", announcementBarText: "" }, { headers });
  }
}

export default function App() {
  const { googlePixelId, metaPixelId, announcementBarText } = useLoaderData<typeof loader>();

  return (
    <html lang="es-MX">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>STOPee — Higiene urbana canina biotecnológica</title>
        <meta
          name="description"
          content="STOPee: concentrado biotecnológico que neutraliza al instante los residuos del paseo canino. 1 litro rinde 30 litros de solución activa."
        />
        <Meta />
        <Links />

        {googlePixelId && (
          <>
            <script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${googlePixelId}`}
            />
            <script
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
        {announcementBarText && (
          <div className="bg-lima px-4 py-2 text-center text-sm font-bold text-carbon">
            {announcementBarText}
          </div>
        )}
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
