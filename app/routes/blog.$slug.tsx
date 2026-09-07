import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { connectDB } from "~/lib/db.server";
import { BlogPostModel } from "~/models/blogPost.server";
import { renderMarkdown } from "~/lib/markdown.server";
import { getCart } from "~/lib/cart.server";
import { getUser } from "~/lib/session.server";

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
  if (isPreview && user?.role !== "admin") {
    throw new Response("Artículo no encontrado", { status: 404 });
  }

  return json({
    post: {
      title: post.title,
      excerpt: post.excerpt,
      imageUrl: post.imageUrl || null,
      readingMinutes: post.readingMinutes ?? 3,
      publishedAt: post.publishedAt as unknown as string | null,
      contentHtml: renderMarkdown(post.content),
    },
    isPreview,
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Artículo no encontrado — STOPee" }];
  return [
    { title: `${data.post.title} — Blog Cívico STOPee` },
    { name: "description", content: data.post.excerpt },
  ];
};

export default function BlogPost() {
  const { post, isPreview, cartCount } = useLoaderData<typeof loader>();

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
          <Link to="/blog" className="text-sm font-semibold text-bosque hover:underline">
            ← Volver al blog
          </Link>

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
            <img src={post.imageUrl} alt="" className="mt-8 w-full rounded-3xl object-cover" style={{ maxHeight: 420 }} />
          )}

          <div
            className="prose prose-lg mt-8 max-w-none text-carbon/80 prose-headings:font-display prose-headings:text-carbon prose-a:text-bosque"
            dangerouslySetInnerHTML={{ __html: post.contentHtml }}
          />

          <div className="mt-12 rounded-3xl bg-bosque/5 p-6 text-center">
            <p className="font-display text-lg font-bold text-carbon">
              Súmate al cambio de hábito
            </p>
            <p className="mt-1 text-sm text-carbon/70">
              Un paseo limpio empieza con la correa puesta y termina con STOPee.
            </p>
            <Link
              to="/tienda"
              className="mt-4 inline-block min-h-11 rounded-full bg-lima px-6 py-2.5 text-sm font-bold text-carbon"
            >
              Ir a la tienda
            </Link>
          </div>
        </article>
      </main>

      <Footer />
    </div>
  );
}
