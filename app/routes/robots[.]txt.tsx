import type { LoaderFunctionArgs } from "@remix-run/node";
import { getSiteSettings } from "~/models/siteSettings.server";
import { siteOrigin } from "~/lib/siteOrigin.server";

// Mientras la tienda no esté activa (modo pre-lanzamiento), no tiene caso
// que Google rastree /tienda ni las fichas de producto — solo redirigen a
// "/" para cualquier visitante que no sea admin. En cuanto se active la
// tienda, este archivo empieza a permitirlas sin tocar código.
export async function loader({ request }: LoaderFunctionArgs) {
  const origin = siteOrigin(request);
  const settings = await getSiteSettings();

  const disallow = settings.isStoreActive
    ? ["/admin", "/cuenta", "/gracias"]
    : ["/admin", "/cuenta", "/gracias", "/tienda", "/suscripcion"];

  const lines = [
    "User-agent: *",
    ...disallow.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
  ];

  return new Response(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
