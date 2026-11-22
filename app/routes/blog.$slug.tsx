import { isStaff } from "~/lib/roles";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useRouteLoaderData } from "@remix-run/react";
import type { loader as RootLoader } from "~/root";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { connectDB } from "~/lib/db.server";
import { BlogPostModel } from "~/models/blogPost.server";
import { renderMarkdown } from "~/lib/markdown.server";
import { getCart } from "~/lib/cart.server";
import { getUser } from "~/lib/session.server";
import { buildOgMeta, buildBlogPostingJsonLd, buildBreadcrumbJsonLd, DEFAULT_OG_IMAGE } from "~/lib/seo";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { ShareButton } from "~/components/ui/ShareButton";
import { getCatalogItemNameBySku } from "~/lib/catalog.server";
import { ArrowLabel } from "~/components/ui/Icons";
import { siteOrigin } from "~/lib/siteOrigin.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await connectDB();
  const [post, cart, user] = await Promise.all([
    BlogPostModel.findOne({ slug: params.slug ?? "" }).lean(),
    getCart(request),
    getUser(request),
  ]);

  if (!post) {
    throw new Response("Artículo no encontrado", { status: 404 });
  }

  const isPublished = Boolean(post.publishedAt) && new Date(post.publishedAt as unknown as string) <= new Date();
  const isPreview = !isPublished;
  if (isPreview && !isStaff(user?.role)) {
    throw new Response("Artículo no encontrado", { status: 404 });
  }

  const relatedPosts = post.relatedPostSlugs?.length
    ? await BlogPostModel.find({ slug: { $in: post.relatedPostSlugs }, publishedAt: { $lte: new Date() } })
        .select("title slug")
        .lean()
    : [];

  const relatedProducts = (
    await Promise.all(
      (post.relatedProductSkus ?? []).map(async (sku) => {
        const name = await getCatalogItemNameBySku(sku);
        return name ? { sku, name } : null;
      }),
    )
  ).filter((p): p is { sku: string; name: string } => p !== null);

  return json({
    post: {
      title: post.title,
      excerpt: post.excerpt,
      imageUrl: post.imageUrl || null,
      imageAlt: post.imageAlt || "",
      readingMinutes: post.readingMinutes ?? 3,
      publishedAt: post.publishedAt as unknown as string | null,
      contentHtml: renderMarkdown(post.content),
    },
    relatedPosts: relatedPosts.map((p) => ({ title: p.title, slug: p.slug })),
    relatedProducts,
    origin: siteOrigin(request),
    slug: params.slug ?? "",
    isPreview,
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Artículo no encontrado — STOPee" }];
  const { post, origin, slug } = data;
  const url = `${origin}/blog/${slug}`;
  const image = post.imageUrl
    ? post.imageUrl.startsWith("https://")
      ? post.imageUrl
      : `${origin}${post.imageUrl}`
    : `${origin}${DEFAULT_OG_IMAGE}`;
  return [
    { title: `${post.title} — Blog Cívico STOPee` },
    { name: "description", content: post.excerpt },
    ...buildOgMeta({ title: post.title, description: post.excerpt, url, image, type: "article" }),
    buildBlogPostingJsonLd({
      title: post.title,
      description: post.excerpt,
      image,
      url,
      publishedAt: post.publishedAt,
    }),
    buildBreadcrumbJsonLd([
      { name: "Inicio", url: origin },
      { name: "Blog", url: `${origin}/blog` },
      { name: post.title, url },
    ]),
  ];
};

export default function BlogPost() {
  const { post, relatedPosts, relatedProducts: allRelatedProducts, origin, slug, isPreview, cartCount } =
    useLoaderData<typeof loader>();
  // Con la tienda aún no pública, el blog no enlaza a productos ni a la tienda.
  const storeVisible = useRouteLoaderData<typeof RootLoader>("root")?.storeVisible ?? false;
  const relatedProducts = storeVisible ? allRelatedProducts : [];
  const hasRelated = relatedPosts.length > 0 || relatedProducts.length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />

      {isPreview && (
        <div className="bg-carbon px-4 py-2 text-center text-sm font-semibold text-lima">
          Vista previa de administrador — este artículo todavía no es público.
        </div>
      )}

      <main className="flex-1">
        <article className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
          <Breadcrumbs
            items={[
              { label: "Inicio", href: "/" },
              { label: "Blog", href: "/blog" },
              { label: post.title },
            ]}
          />

          {post.publishedAt && (
            <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-oliva">
              {new Date(post.publishedAt).toLocaleDateString("es-MX", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}{" "}
              · {post.readingMinutes} min de lectura
            </p>
          )}
          <h1 className="mt-3 font-display text-3xl font-black text-carbon sm:text-4xl">
            {post.title}
          </h1>

          {post.imageUrl && (
            <img
              src={post.imageUrl}
              alt={post.imageAlt || post.title}
              className="mt-8 w-full rounded-3xl object-cover"
              style={{ maxHeight: 420 }}
            />
          )}

          <div
            className="prose prose-lg mt-8 max-w-none text-carbon/80 prose-headings:font-display prose-headings:text-carbon prose-a:text-bosque"
            dangerouslySetInnerHTML={{ __html: post.contentHtml }}
          />

          <div className="mt-8 border-t border-carbon/10 pt-6">
            <ShareButton title={post.title} url={`${origin}/blog/${slug}`} />
          </div>

          {hasRelated && (
            <div className="mt-10">
              <p className="font-display text-lg font-bold text-carbon">También te puede interesar</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {relatedPosts.map((related) => (
                  <Link
                    key={related.slug}
                    to={`/blog/${related.slug}`}
                    className="rounded-full border border-carbon/15 px-4 py-2 text-sm font-semibold text-carbon hover:border-oliva hover:text-oliva"
                  >
                    {related.title}
                  </Link>
                ))}
                {relatedProducts.map((product) => (
                  <Link
                    key={product.sku}
                    to={`/tienda/${product.sku}`}
                    className="group inline-flex min-h-11 items-center rounded-full border border-lima bg-lima/10 px-4 py-2 text-sm font-semibold text-bosque hover:bg-lima/20"
                  >
                    <ArrowLabel>{product.name}</ArrowLabel>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="mt-12 rounded-3xl bg-bosque/5 p-6 text-center">
            <p className="font-display text-lg font-bold text-carbon">
              Súmate al cambio de hábito
            </p>
            <p className="mt-1 text-sm text-carbon/70">
              Un paseo limpio empieza con la correa puesta y termina con STOPee.
            </p>
            <Link
              to={storeVisible ? "/tienda" : "/como-funciona"}
              className="mt-4 inline-block min-h-11 rounded-full bg-lima px-6 py-2.5 text-sm font-bold text-carbon"
            >
              {storeVisible ? "Ir a la tienda" : "Conoce cómo funciona"}
            </Link>
          </div>
        </article>
      </main>

      <Footer />
    </div>
  );
}
