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

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: tailwind },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
  },
];

export async function loader(_args: LoaderFunctionArgs) {
  // El root loader corre en cada request de todo el sitio; si Mongo tiene un
  // hipo no debe tumbar páginas que no dependen de esto (pixeles/anuncio).
  try {
    const settings = await getSiteSettings();
    return json({
      googlePixelId: settings.googlePixelId ?? "",
      metaPixelId: settings.metaPixelId ?? "",
      announcementBarText: settings.announcementBarText ?? "",
    });
  } catch {
    return json({ googlePixelId: "", metaPixelId: "", announcementBarText: "" });
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
