import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { getBlogPostBySlug } from "~/data/blogPosts";

export async function loader({ params }: LoaderFunctionArgs) {
  const post = getBlogPostBySlug(params.slug ?? "");
  if (!post) {
    throw new Response("Artículo no encontrado", { status: 404 });
  }
  return json({ post });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Artículo no encontrado — STOPee" }];
  return [
    { title: `${data.post.title} — Blog Cívico STOPee` },
    { name: "description", content: data.post.excerpt },
  ];
};

export default function BlogPost() {
  const { post } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar />

      <main className="flex-1">
        <article className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
          <Link to="/blog" className="text-sm font-semibold text-bosque hover:underline">
            ← Volver al blog
          </Link>

          <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-oliva">
            {new Date(post.publishedAt).toLocaleDateString("es-MX", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}{" "}
            · {post.readingMinutes} min de lectura
          </p>
          <h1 className="mt-3 font-display text-3xl font-black text-carbon sm:text-4xl">
            {post.title}
          </h1>

          <div className="mt-8 flex flex-col gap-5 text-lg leading-relaxed text-carbon/80">
            {post.content.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>

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
