import type { MetaFunction } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { BLOG_POSTS } from "~/data/blogPosts";

export const meta: MetaFunction = () => [
  { title: "Blog Cívico STOPee — Convivencia urbana canina" },
  {
    name: "description",
    content: "Artículos sobre convivencia urbana: uso de correa, protocolos de acercamiento canino y manejo consciente de residuos.",
  },
];

export default function BlogIndex() {
  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar />

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 py-14 text-center sm:px-6">
          <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
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
          <ul className="flex flex-col gap-6">
            {BLOG_POSTS.map((post) => (
              <li key={post.slug}>
                <Link
                  to={`/blog/${post.slug}`}
                  className="block rounded-3xl border border-carbon/10 bg-white p-6 transition-shadow hover:shadow-lg sm:p-8"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-oliva">
                    {new Date(post.publishedAt).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    })}{" "}
                    · {post.readingMinutes} min de lectura
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-bold text-carbon">
                    {post.title}
                  </h2>
                  <p className="mt-2 text-carbon/70">{post.excerpt}</p>
                  <span className="mt-4 inline-block font-semibold text-bosque">
                    Leer artículo →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <Footer />
    </div>
  );
}
