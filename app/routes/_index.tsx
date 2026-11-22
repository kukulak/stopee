import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction
} from 'react-router'
import { data } from 'react-router'
import { Link, useLoaderData } from 'react-router'
import { z } from 'zod'
import { Navbar } from '~/components/layout/Navbar'
import { Footer } from '~/components/layout/Footer'
import { EditableBrandSwirls } from '~/components/ui/EditableBrandSwirls'
import { DEFAULT_PAGE_SWIRLS } from '~/components/ui/BrandSwirls'
import { ScrollytellingSection } from '~/components/scrollytelling/ScrollytellingSection'
import { PrelaunchLanding } from '~/components/prelaunch/PrelaunchLanding'
import { getCatalogItems, getConcentratePrice, type CatalogItem } from '~/lib/catalog.server'
import { BlogPostModel } from '~/models/blogPost.server'
import { getCart } from '~/lib/cart.server'
import { getSiteSettings } from '~/models/siteSettings.server'
import { getSubscriptionConfig } from '~/models/subscriptionSettings.server'
import { describeFrequencies } from '~/lib/subscriptionConfig'
import { connectDB } from '~/lib/db.server'
import { LeadModel } from '~/models/lead.server'
import { sendEmail } from '~/lib/mail.server'
import { waitlistWelcomeEmail } from '~/lib/emailTemplates.server'
import { logError } from '~/lib/logger.server'
import { getAttribution } from '~/lib/attribution.server'
import { getActiveHeroBanner, type HeroBanner } from '~/lib/heroBanner.server'
import { HeroBannerSection } from '~/components/ecommerce/HeroBannerSection'
import { checkRateLimit, getClientIp, rateLimitMessage } from '~/lib/rateLimit.server'
import { cleanPlainText, hasControlChars, rejectForeignOrigin } from '~/lib/formGuard.server'
import { buildOgMeta, DEFAULT_OG_IMAGE } from '~/lib/seo'
import { getPublishedTestimonials } from '~/models/testimonial.server'
import { TestimonialsSection } from '~/components/ecommerce/TestimonialsSection'
import { ArrowLink } from "~/components/ui/ArrowLink"
import { ArrowLabel } from "~/components/ui/Icons"
import { siteOrigin } from "~/lib/siteOrigin.server";

const HOME_TITLE = 'STOPee — Ciudades limpias, paseos impecables'
const HOME_DESCRIPTION =
  'STOPee: concentrado biotecnológico que neutraliza al instante los residuos del paseo canino. 1 litro rinde 30 litros de solución activa.'

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: HOME_TITLE },
  { name: 'description', content: HOME_DESCRIPTION },
  ...(data
    ? buildOgMeta({
        title: HOME_TITLE,
        description: HOME_DESCRIPTION,
        url: data.origin,
        image: `${data.origin}${DEFAULT_OG_IMAGE}`,
        type: 'website'
      })
    : []),
  {
    'script:ld+json': {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'STOPee',
      url: data?.origin,
      logo: data ? `${data.origin}/elementos-design/logo-STOPee.png` : undefined
    }
  }
]

export async function loader({ request }: LoaderFunctionArgs) {
  const settings = await getSiteSettings()
  const origin = siteOrigin(request)

  if (!settings.isStoreActive) {
    return data({
      isStoreActive: false as const,
      origin,
      concentrate: await getConcentratePrice()
    })
  }

  await connectDB()
  const [cart, heroBanner, recentPosts, testimonials, catalogItems, subscriptionConfig] = await Promise.all([
    getCart(request),
    getActiveHeroBanner(),
    BlogPostModel.find({ publishedAt: { $lte: new Date() } })
      .sort({ publishedAt: -1 })
      .limit(3)
      .select('title slug excerpt')
      .lean(),
    getPublishedTestimonials(),
    getCatalogItems(),
    getSubscriptionConfig()
  ])

  // El destacado del home prefiere un paquete (suele ser la mejor puerta de
  // entrada) y si no hay ninguno, el primer producto individual disponible.
  const featured = catalogItems.find(p => p.kind === 'bundle') ?? catalogItems[0] ?? null

  return data({
    isStoreActive: true as const,
    origin,
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
    heroBanner,
    featured,
    subscriptionPitch: `Activa el auto-envío periódico y recibe tu concentrado ${describeFrequencies(subscriptionConfig)}${
      subscriptionConfig.discountPercent > 0 ? ` con ${subscriptionConfig.discountPercent}% de descuento automático` : ''
    }.`,
    recentPosts: recentPosts.map(p => ({
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt
    })),
    testimonials: testimonials.map(t => ({
      customerName: t.customerName,
      quote: t.quote,
      photoUrl: t.photoUrl ?? ''
    }))
  })
}

const waitlistSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(100, 'El correo es demasiado largo.')
    .email('Ingresa un correo válido.')
    .refine(v => !hasControlChars(v), 'El correo tiene caracteres no válidos.')
})

export async function action({ request }: ActionFunctionArgs) {
  const foreign = rejectForeignOrigin(request)
  if (foreign) return foreign

  // Máximo 5 registros por hora por IP — deja pasar a alguien que se
  // equivoca de correo un par de veces, no a un script mandando cientos de
  // altas por minuto. Va antes de leer el cuerpo del formulario.
  const ip = getClientIp(request)
  const rateLimit = checkRateLimit(`waitlist:${ip}`, { max: 5, windowMs: 60 * 60 * 1000 })
  if (!rateLimit.allowed) {
    return data({ ok: false, error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 })
  }

  const formData = await request.formData()

  const parsed = waitlistSchema.safeParse({ email: cleanPlainText(formData.get('email')) })

  if (!parsed.success) {
    return data(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? 'Ingresa un correo válido.'
      },
      { status: 400 }
    )
  }

  await connectDB()

  const attribution = await getAttribution(request)
  const LEAD_SOURCES = new Set(['meta_ads', 'google', 'blog', 'direct'])
  const source =
    attribution && LEAD_SOURCES.has(attribution.utm_source)
      ? attribution.utm_source
      : 'other'

  // Idempotente: si ya estaba registrado, igual confirmamos su lugar en la
  // lista en vez de mostrar un error — nadie debería sentir que algo falló
  // por intentar registrarse dos veces.
  const result = await LeadModel.findOneAndUpdate(
    { email: parsed.data.email },
    {
      $setOnInsert: {
        email: parsed.data.email,
        registeredAt: new Date(),
        source
      }
    },
    { upsert: true, includeResultMetadata: true }
  )

  // Correo de bienvenida solo la primera vez: si ya estaba en la lista no se
  // le vuelve a escribir (evita que alguien use el formulario para llenar de
  // correos el buzón de otra persona).
  if (!result.lastErrorObject?.updatedExisting) {
    try {
      await sendEmail({ to: { email: parsed.data.email }, ...waitlistWelcomeEmail() })
    } catch (error) {
      logError('waitlist.welcome', error)
    }
  }

  return data({ ok: true, error: undefined as string | undefined })
}

const BENEFITS = [
  {
    audience: 'Para ti y tu perro',
    detail:
      'Paseos agradables, sin malos olores retenidos en arneses, calzado o ropa.'
  },
  {
    audience: 'Para tus vecinos y comercios',
    detail:
      'Fachadas preservadas, calles ventiladas y banquetas seguras para todos.'
  },
  {
    audience: 'Para la ciudad',
    detail:
      'Conservación del mobiliario urbano y microbiología activa benéfica.'
  }
]

export default function Index() {
  const data = useLoaderData<typeof loader>()

  if (!data.isStoreActive) {
    return <PrelaunchLanding concentrate={data.concentrate} />
  }

  return (
    <LaunchedLanding
      cartCount={data.cartCount}
      heroBanner={data.heroBanner}
      featured={data.featured}
      subscriptionPitch={data.subscriptionPitch}
      recentPosts={data.recentPosts}
      testimonials={data.testimonials}
    />
  )
}

function LaunchedLanding({
  cartCount,
  heroBanner,
  featured,
  subscriptionPitch,
  recentPosts,
  testimonials
}: {
  cartCount: number
  heroBanner: HeroBanner | null
  featured: CatalogItem | null
  subscriptionPitch: string
  recentPosts: { slug: string; title: string; excerpt: string }[]
  testimonials: { customerName: string; quote: string; photoUrl: string }[]
}) {
  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />

      <main className="flex-1">
        {/* HERO editable (promoción con banner o banner personalizado) — si
            no hay ninguno activo, no se muestra nada y el propio hero de
            ScrollytellingSection sigue funcionando como portada. */}
        {heroBanner && <HeroBannerSection banner={heroBanner} />}

        {/* HERO + MANIFIESTO — un solo fondo oscuro continuo con los mismos
            remolinos y paralax del landing de pre-lanzamiento (igualito),
            en vez de un fondo de remolinos por sección. */}
        <div className="relative overflow-hidden bg-carbon">
          <EditableBrandSwirls swirls={DEFAULT_PAGE_SWIRLS} id="home-dark" />

          <ScrollytellingSection />

          <section className="relative py-20 text-hueso">
            <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
              <p className="font-body text-sm font-bold uppercase tracking-widest text-lima">
                El nuevo estándar cívico
              </p>
              <h2 className="mt-3 font-display text-3xl font-black sm:text-4xl">
                Levantar la popa ya es un hábito. Atender la orina es el siguiente
                paso.
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-hueso/70">
                La cultura ciudadana adoptó exitosamente la recolección de heces.
                El siguiente paso lógico de la convivencia comunitaria es atender
                las manchas y olores de la orina en fachadas, banquetas y postes.
              </p>

              <div className="mt-12 grid grid-cols-1 gap-6 text-left sm:grid-cols-3">
                {BENEFITS.map(b => (
                  <div
                    key={b.audience}
                    className="rounded-3xl border border-hueso/10 bg-carbon/70 p-6 backdrop-blur-md"
                  >
                    <p className="font-display font-bold text-lima">
                      {b.audience}
                    </p>
                    <p className="mt-2 text-sm text-hueso/70">{b.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* TIENDA TEASER */}
        <section
          id="tienda-teaser"
          className="mx-auto max-w-6xl px-4 py-20 sm:px-6"
        >
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
                Tienda integrada
              </p>
              <h2 className="mt-2 font-display text-3xl font-black text-carbon">
                Empieza con tu paquete inicial
              </h2>
            </div>
            <ArrowLink to="/tienda">Ver todo el catálogo</ArrowLink>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="flex flex-col justify-between rounded-3xl bg-gradient-to-br from-bosque to-carbon p-8 text-hueso sm:p-10">
              {featured ? (
                <>
                  <div>
                    <p className="font-display text-sm font-bold uppercase tracking-widest text-lima">
                      Recomendado para empezar
                    </p>
                    <h3 className="mt-2 font-display text-2xl font-black">
                      {featured.name}
                    </h3>
                    <p className="mt-2 max-w-sm text-hueso/70">
                      {featured.shortDescription}
                    </p>
                  </div>
                  <div className="mt-8 flex items-center justify-between">
                    <span className="font-display text-3xl font-black">
                      ${featured.priceMxn} MXN
                    </span>
                    <Link
                      to="/tienda"
                      className="min-h-11 rounded-full bg-lima px-6 py-2.5 text-sm font-bold text-carbon transition-transform hover:scale-105"
                    >
                      Comprar ahora
                    </Link>
                  </div>
                </>
              ) : (
                <p className="text-hueso/70">Muy pronto en la tienda.</p>
              )}
            </div>

            <div className="rounded-3xl border border-lima/30 bg-bosque/5 p-8">
              <p className="font-display font-bold text-carbon">
                ¿Ya sabes cuánto te dura tu litro?
              </p>
              <p className="mt-2 text-sm text-carbon/70">
                {subscriptionPitch}
              </p>
              <Link
                to="/suscripcion"
                className="mt-5 inline-block min-h-11 rounded-full border-2 border-carbon/15 px-6 py-2.5 text-sm font-bold text-carbon hover:border-carbon/30"
              >
                Configurar suscripción
              </Link>
            </div>
          </div>
        </section>

        <TestimonialsSection testimonials={testimonials} />

        {/* BLOG TEASER */}
        <section className="bg-bosque/5 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
                  Blog cívico
                </p>
                <h2 className="mt-2 font-display text-3xl font-black text-carbon">
                  Convivencia urbana, un hábito a la vez
                </h2>
              </div>
              <ArrowLink to="/blog">Ver todos los artículos</ArrowLink>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
              {recentPosts.map(post => (
                <Link
                  key={post.slug}
                  to={`/blog/${post.slug}`}
                  className="group flex flex-col rounded-3xl border border-carbon/10 bg-white p-6 transition-shadow hover:shadow-lg"
                >
                  <h3 className="font-display font-bold text-carbon">
                    {post.title}
                  </h3>
                  <p className="mt-2 flex-1 text-sm text-carbon/60">
                    {post.excerpt}
                  </p>
                  <ArrowLabel className="mt-4 text-sm font-semibold text-bosque">Leer</ArrowLabel>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
