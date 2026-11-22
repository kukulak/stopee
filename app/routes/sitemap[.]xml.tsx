import type { LoaderFunctionArgs } from "react-router";
import { getSiteSettings } from "~/models/siteSettings.server";
import { connectDB } from "~/lib/db.server";
import { BlogPostModel } from "~/models/blogPost.server";
import { getCatalogItems } from "~/lib/catalog.server";
import { siteOrigin } from "~/lib/siteOrigin.server";

type UrlEntry = { path: string; changefreq: string; priority: string };

export async function loader({ request }: LoaderFunctionArgs) {
  const origin = siteOrigin(request);
  await connectDB();
  const settings = await getSiteSettings();

  const urls: UrlEntry[] = [
    { path: "/", changefreq: "weekly", priority: "1.0" },
    { path: "/blog", changefreq: "weekly", priority: "0.6" },
    { path: "/como-funciona", changefreq: "monthly", priority: "0.6" },
    { path: "/nosotros", changefreq: "yearly", priority: "0.4" },
    { path: "/contacto", changefreq: "yearly", priority: "0.4" },
    { path: "/preguntas-frecuentes", changefreq: "monthly", priority: "0.5" },
    { path: "/envios", changefreq: "monthly", priority: "0.4" },
    { path: "/aviso-de-privacidad", changefreq: "yearly", priority: "0.2" },
    { path: "/terminos-y-condiciones", changefreq: "yearly", priority: "0.2" },
  ];

  // /tienda y las fichas de producto solo cuentan como páginas reales del
  // sitio una vez que la tienda está activa al público — antes de eso
  // redirigen a "/" y no deberían aparecer indexadas.
  if (settings.isStoreActive) {
    urls.push({ path: "/tienda", changefreq: "weekly", priority: "0.9" });
    const catalogItems = await getCatalogItems();
    for (const item of catalogItems) {
      urls.push({ path: `/tienda/${item.sku}`, changefreq: "weekly", priority: "0.8" });
    }
  }

  const posts = await BlogPostModel.find({ publishedAt: { $lte: new Date() } })
    .select("slug publishedAt")
    .lean();
  for (const post of posts) {
    urls.push({ path: `/blog/${post.slug}`, changefreq: "monthly", priority: "0.5" });
  }

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(
      (u) =>
        `  <url><loc>${origin}${u.path}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
    ),
    "</urlset>",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
