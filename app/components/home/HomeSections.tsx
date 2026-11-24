import { Link } from "react-router";
import { DefaultHero } from "~/components/ecommerce/DefaultHero";
import { HeroBannerSection } from "~/components/ecommerce/HeroBannerSection";
import { TestimonialsSection } from "~/components/ecommerce/TestimonialsSection";
import { ArrowLink } from "~/components/ui/ArrowLink";
import { HOME_HERO_SWIRLS, HOME_PAGE_SWIRLS } from "~/components/ui/BrandSwirls";
import { EditableBrandSwirls } from "~/components/ui/EditableBrandSwirls";
import { ArrowLabel } from "~/components/ui/Icons";
import type { HeroBanner } from "~/lib/heroBanner.server";
import type { CatalogItem } from "~/lib/catalog.server";

/**
 * Los bloques de la portada. El orden, si se muestran y sus textos vienen de /admin/inicio
 * (ver ~/lib/homeBlocks.ts); aquí solo está cómo se ve cada uno. Todos los textos llegan en
 * `content`: un texto vacío significa «no mostrar esa parte».
 */
export type HomeContent = Record<string, string>;

/** Banner de /admin/banners; sin banner activo para Inicio, el hero por defecto sobre fondo oscuro. */
export function HeroBlock({ banner, exploreHref }: { banner: HeroBanner | null; exploreHref: string }) {
  if (banner) return <HeroBannerSection banner={banner} />;
  return (
    <div className="relative overflow-hidden bg-carbon">
      <EditableBrandSwirls swirls={HOME_HERO_SWIRLS} id="home-hero-v2" />
      <DefaultHero exploreHref={exploreHref} />
    </div>
  );
}

/** Sección oscura con remolinos: un mensaje principal y hasta tres tarjetas. */
export function IdentityBlock({ content: c }: { content: HomeContent }) {
  const cards = [1, 2, 3]
    .map((n) => ({ title: c[`card${n}Title`], text: c[`card${n}Text`] }))
    .filter((card) => card.title);

  return (
    <div className="relative overflow-hidden bg-carbon">
      <EditableBrandSwirls swirls={HOME_PAGE_SWIRLS} id="home-dark-v2" />

      <section className="relative py-20 text-hueso">
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
          {c.eyebrow && (
            <p className="font-body text-sm font-bold uppercase tracking-widest text-lima">{c.eyebrow}</p>
          )}
          <h2 className="mt-3 font-display text-3xl font-black sm:text-4xl">{c.title}</h2>
          {c.body && <p className="mx-auto mt-4 max-w-2xl whitespace-pre-line text-hueso/70">{c.body}</p>}

          {cards.length > 0 && (
            <div
              className={`mt-12 grid grid-cols-1 gap-6 text-left ${
                cards.length === 1 ? "sm:grid-cols-1" : cards.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"
              }`}
            >
              {cards.map((card) => (
                <div
                  key={card.title}
                  className="rounded-3xl border border-hueso/10 bg-carbon/70 p-6 backdrop-blur-md"
                >
                  <p className="font-display font-bold text-lima">{card.title}</p>
                  {card.text && <p className="mt-2 text-sm text-hueso/70">{card.text}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** Producto o paquete destacado con su botón de compra, y la tarjeta de suscripción. */
export function StartBlock({
  content: c,
  featured,
  subscriptionPitch,
}: {
  content: HomeContent;
  featured: CatalogItem | null;
  subscriptionPitch: string;
}) {
  return (
    <section id="tienda-teaser" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <h2 className="font-display text-3xl font-black text-carbon">{c.title}</h2>
        {c.linkLabel && <ArrowLink to="/tienda">{c.linkLabel}</ArrowLink>}
      </div>

      <div className={`mt-8 grid grid-cols-1 gap-6 ${c.subTitle ? "lg:grid-cols-[1.2fr_1fr]" : ""}`}>
        <div className="flex flex-col justify-between rounded-3xl bg-gradient-to-br from-bosque to-carbon p-8 text-hueso sm:p-10">
          {featured ? (
            <>
              <div>
                {c.badge && (
                  <p className="font-display text-sm font-bold uppercase tracking-widest text-lima">{c.badge}</p>
                )}
                <h3 className="mt-2 font-display text-2xl font-black">{featured.name}</h3>
                <p className="mt-2 max-w-sm text-hueso/70">{featured.shortDescription}</p>
              </div>
              <div className="mt-8 flex items-center justify-between gap-4">
                <span className="font-display text-3xl font-black">${featured.priceMxn} MXN</span>
                <Link
                  to="/tienda"
                  className="min-h-11 rounded-full bg-lima px-6 py-2.5 text-sm font-bold text-carbon transition-transform hover:scale-105"
                >
                  {c.buttonLabel}
                </Link>
              </div>
            </>
          ) : (
            <p className="text-hueso/70">Muy pronto en la tienda.</p>
          )}
        </div>

        {c.subTitle && (
          <div className="rounded-3xl border border-lima/30 bg-bosque/5 p-8">
            <p className="font-display font-bold text-carbon">{c.subTitle}</p>
            <p className="mt-2 text-sm text-carbon/70">{c.subText || subscriptionPitch}</p>
            {c.subButton && (
              <Link
                to="/suscripcion"
                className="mt-5 inline-block min-h-11 rounded-full border-2 border-carbon/15 px-6 py-2.5 text-sm font-bold text-carbon hover:border-carbon/30"
              >
                {c.subButton}
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** Tres pasos cortos de uso. Los números son reales: es una secuencia. */
export function StepsBlock({ content: c }: { content: HomeContent }) {
  const steps = [1, 2, 3]
    .map((n) => ({ title: c[`step${n}Title`], text: c[`step${n}Text`] }))
    .filter((step) => step.title);
  if (steps.length === 0) return null;

  return (
    <section className="bg-white py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            {c.eyebrow && (
              <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">{c.eyebrow}</p>
            )}
            <h2 className="mt-2 font-display text-3xl font-black text-carbon">{c.title}</h2>
          </div>
          {c.linkLabel && <ArrowLink to="/como-funciona">{c.linkLabel}</ArrowLink>}
        </div>

        <ol className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-3xl border border-carbon/10 bg-hueso p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-lima font-display font-black text-carbon">
                {index + 1}
              </span>
              <p className="mt-4 font-display font-bold text-carbon">{step.title}</p>
              {step.text && <p className="mt-2 text-sm text-carbon/70">{step.text}</p>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function TestimonialsBlock({
  content: c,
  testimonials,
}: {
  content: HomeContent;
  testimonials: { customerName: string; quote: string; photoUrl: string }[];
}) {
  return <TestimonialsSection testimonials={testimonials} eyebrow={c.eyebrow} title={c.title} />;
}

/** Los artículos más recientes. Sin artículos publicados, no hay sección. */
export function BlogBlock({
  content: c,
  recentPosts,
}: {
  content: HomeContent;
  recentPosts: { slug: string; title: string; excerpt: string }[];
}) {
  if (recentPosts.length === 0) return null;

  return (
    <section className="bg-bosque/5 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            {c.eyebrow && (
              <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">{c.eyebrow}</p>
            )}
            <h2 className="mt-2 font-display text-3xl font-black text-carbon">{c.title}</h2>
          </div>
          {c.linkLabel && <ArrowLink to="/blog">{c.linkLabel}</ArrowLink>}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {recentPosts.map((post) => (
            <Link
              key={post.slug}
              to={`/blog/${post.slug}`}
              className="group flex flex-col rounded-3xl border border-carbon/10 bg-white p-6 transition-shadow hover:shadow-lg"
            >
              <h3 className="font-display font-bold text-carbon">{post.title}</h3>
              <p className="mt-2 flex-1 text-sm text-carbon/60">{post.excerpt}</p>
              <ArrowLabel className="mt-4 text-sm font-semibold text-bosque">Leer</ArrowLabel>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Último mensaje con un botón. */
export function CtaBlock({ content: c }: { content: HomeContent }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="rounded-3xl bg-gradient-to-br from-bosque to-carbon px-6 py-14 text-center text-hueso sm:px-12">
        <h2 className="mx-auto max-w-2xl text-balance font-display text-3xl font-black sm:text-4xl">{c.title}</h2>
        {c.text && <p className="mx-auto mt-4 max-w-xl text-hueso/75">{c.text}</p>}
        <Link
          to={c.buttonHref || "/tienda"}
          className="mt-8 inline-block min-h-12 rounded-full bg-lima px-8 py-3.5 text-base font-bold text-carbon transition-transform hover:scale-105 active:scale-95"
        >
          {c.buttonLabel}
        </Link>
      </div>
    </section>
  );
}
