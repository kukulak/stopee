import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Link, useLoaderData } from "react-router";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { connectDB } from "~/lib/db.server";
import { BlogPostModel } from "~/models/blogPost.server";
import { getCart } from "~/lib/cart.server";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { ArrowLabel } from "~/components/ui/Icons";

export const meta: MetaFunction = () => [
  { title: "Blog Cívico STOPee — Convivencia urbana canina" },
  {
    name: "description",
    content: "Artículos sobre convivencia urbana: uso de correa, protocolos de acercamiento canino y manejo consciente de residuos.",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await connectDB();
  const [posts, cart] = await Promise.all([
    BlogPostModel.find({ publishedAt: { $lte: new Date() } })
      .sort({ publishedAt: -1 })
      .select("title slug excerpt imageUrl readingMinutes publishedAt")
      .lean(),
    getCart(request),
  ]);

  return data({
    posts: posts.map((p) => ({
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      imageUrl: p.imageUrl || null,
      readingMinutes: p.readingMinutes ?? 3,
      publishedAt: p.publishedAt as unknown as string,
    })),
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
  });
}

export default function BlogIndex() {
  const { posts, cartCount } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 py-14 text-center sm:px-6">
          <div className="text-left">
            <Breadcrumbs items={[{ label: "Inicio", href: "/" }, { label: "Blog" }]} />
          </div>
          <p className="mt-6 font-body text-sm font-bold uppercase tracking-widest text-oliva">
            Blog Cívico
          </p>
          <h1 className="mt-2 font-display text-4xl font-black text-carbon">
            Convivencia urbana, un hábito a la vez
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-carbon/70">
            Como comunidad ya aprendimos a recoger la popa de nuestros perros. Este es el
            espacio para dar el siguiente paso: paseos más seguros, respetuosos y limpios para
            todos.
          </p>
        </section>

        <section className="mx-auto max-w-4xl px-4 pb-20 sm:px-6">
          {posts.length === 0 ? (
            <p className="text-center text-carbon/60">Muy pronto publicaremos los primeros artículos.</p>
          ) : (
            <ul className="flex flex-col gap-6">
              {posts.map((post) => (
                <li key={post.slug}>
                  <Link
                    to={`/blog/${post.slug}`}
                    className="group flex flex-col gap-5 rounded-3xl border border-carbon/10 bg-white p-6 transition-shadow hover:shadow-lg sm:flex-row sm:items-center sm:p-8"
                  >
                    {post.imageUrl && (
                      <img
                        src={post.imageUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-40 w-full shrink-0 rounded-2xl object-cover sm:h-32 sm:w-48"
                      />
                    )}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-oliva">
                        {new Date(post.publishedAt).toLocaleDateString("es-MX", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}{" "}
                        · {post.readingMinutes} min de lectura
                      </p>
                      <h2 className="mt-2 font-display text-2xl font-bold text-carbon">
                        {post.title}
                      </h2>
                      <p className="mt-2 text-carbon/70">{post.excerpt}</p>
                      <ArrowLabel className="mt-4 font-semibold text-bosque">Leer artículo</ArrowLabel>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
