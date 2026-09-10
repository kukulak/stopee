import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction
} from '@remix-run/node'
import { json } from '@remix-run/node'
import { Link, useActionData, useLoaderData } from '@remix-run/react'
import { z } from 'zod'
import { Navbar } from '~/components/layout/Navbar'
import { Footer } from '~/components/layout/Footer'
import { BrandSwirls, type SwirlPlacement } from '~/components/ui/BrandSwirls'
import { ScrollytellingSection } from '~/components/scrollytelling/ScrollytellingSection'
import { PrelaunchLanding } from '~/components/prelaunch/PrelaunchLanding'
import { PRODUCT_LIST } from '~/data/products'
import { BlogPostModel } from '~/models/blogPost.server'
import { getCart } from '~/lib/cart.server'
import { getSiteSettings } from '~/models/siteSettings.server'
import { connectDB } from '~/lib/db.server'
import { LeadModel } from '~/models/lead.server'
import { getAttribution } from '~/lib/attribution.server'
import { getActiveHeroBanner, type HeroBanner } from '~/lib/heroBanner.server'
import { HeroBannerSection } from '~/components/ecommerce/HeroBannerSection'

export const meta: MetaFunction = () => [
  { title: 'STOPee — Ciudades limpias, paseos impecables' },
  {
    name: 'description',
    content:
      'STOPee: concentrado biotecnológico que neutraliza al instante los residuos del paseo canino. 1 litro rinde 30 litros de solución activa.'
  }
]

export async function loader({ request }: LoaderFunctionArgs) {
  const settings = await getSiteSettings()

  if (!settings.isStoreActive) {
    return json({ isStoreActive: false as const })
  }

  await connectDB()
  const [cart, heroBanner, recentPosts] = await Promise.all([
    getCart(request),
    getActiveHeroBanner(),
    BlogPostModel.find({ publishedAt: { $lte: new Date() } })
      .sort({ publishedAt: -1 })
      .limit(3)
      .select('title slug excerpt')
      .lean()
  ])
  return json({
    isStoreActive: true as const,
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
    heroBanner,
    recentPosts: recentPosts.map(p => ({
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt
    }))
  })
}

const waitlistSchema = z.object({
  email: z.string().trim().toLowerCase().email('Ingresa un correo válido.')
})

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData()
  const parsed = waitlistSchema.safeParse({ email: formData.get('email') })

  if (!parsed.success) {
    return json(
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
  await LeadModel.findOneAndUpdate(
    { email: parsed.data.email },
    {
      $setOnInsert: {
        email: parsed.data.email,
        registeredAt: new Date(),
        source
      }
    },
    { upsert: true }
  )

  return json({ ok: true })
}

const MANIFESTO_SWIRLS: SwirlPlacement[] = [
  {
    src: '/elementos-design/izquierda-02.png',
    side: 'left',
    top: '-8%',
    width: 820,
    speed: 0.3,
    rotate: -6,
    opacity: 1
  },
  {
    src: '/elementos-design/derecha-05.png',
    side: 'right',
    top: '30%',
    width: 860,
    speed: -0.26,
    rotate: 8,
    opacity: 1
  },
  {
    src: '/elementos-design/izquierda-03.png',
    side: 'left',
    top: '66%',
    width: 780,
    speed: 0.28,
    rotate: 4,
    opacity: 1
  }
]

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
  const actionData = useActionData<typeof action>()

  if (!data.isStoreActive) {
    return <PrelaunchLanding actionData={actionData} />
  }

  return (
    <LaunchedLanding
      cartCount={data.cartCount}
      heroBanner={data.heroBanner}
      recentPosts={data.recentPosts}
    />
  )
}

function LaunchedLanding({
  cartCount,
  heroBanner,
  recentPosts
}: {
  cartCount: number
  heroBanner: HeroBanner | null
  recentPosts: { slug: string; title: string; excerpt: string }[]
}) {
  const featured =
    PRODUCT_LIST.find(p => p.sku === 'pack-basico') ?? PRODUCT_LIST[0]

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />

      <main className="flex-1">
        {/* HERO editable (promoción con banner o banner personalizado) — si
            no hay ninguno activo, no se muestra nada y el propio hero de
            ScrollytellingSection sigue funcionando como portada. */}
        {heroBanner && <HeroBannerSection banner={heroBanner} />}

        {/* HERO + SCROLLYTELLING 3D (una sola coreografía continua) */}
        <ScrollytellingSection />

        {/* MANIFIESTO PSICOLÓGICO */}
        <section className="relative overflow-hidden bg-carbon py-20 text-hueso">
          <BrandSwirls swirls={MANIFESTO_SWIRLS} />
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
                  className="rounded-3xl border border-hueso/10 bg-hueso/5 p-6"
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
            <Link
              to="/tienda"
              className="font-semibold text-bosque hover:underline"
            >
              Ver todo el catálogo →
            </Link>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="flex flex-col justify-between rounded-3xl bg-gradient-to-br from-bosque to-carbon p-8 text-hueso sm:p-10">
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
            </div>

            <div className="rounded-3xl border border-lima/30 bg-bosque/5 p-8">
              <p className="font-display font-bold text-carbon">
                ¿Ya sabes cuánto te dura tu litro?
              </p>
              <p className="mt-2 text-sm text-carbon/70">
                Activa el auto-envío periódico y recibe tu concentrado cada 3,
                4, 6 u 8 semanas con 10% de descuento automático.
              </p>
              <Link
                to="/tienda#suscripcion"
                className="mt-5 inline-block min-h-11 rounded-full border-2 border-carbon/15 px-6 py-2.5 text-sm font-bold text-carbon hover:border-carbon/30"
              >
                Configurar suscripción
              </Link>
            </div>
          </div>
        </section>

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
              <Link
                to="/blog"
                className="font-semibold text-bosque hover:underline"
              >
                Ver todos los artículos →
              </Link>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
              {recentPosts.map(post => (
                <Link
                  key={post.slug}
                  to={`/blog/${post.slug}`}
                  className="flex flex-col rounded-3xl border border-carbon/10 bg-white p-6 transition-shadow hover:shadow-lg"
                >
                  <h3 className="font-display font-bold text-carbon">
                    {post.title}
                  </h3>
                  <p className="mt-2 flex-1 text-sm text-carbon/60">
                    {post.excerpt}
                  </p>
                  <span className="mt-4 text-sm font-semibold text-bosque">
                    Leer →
                  </span>
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
