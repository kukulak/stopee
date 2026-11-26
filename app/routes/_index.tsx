import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction
} from 'react-router'
import { data } from 'react-router'
import { useLoaderData } from 'react-router'
import { z } from 'zod'
import { Navbar } from '~/components/layout/Navbar'
import { Footer } from '~/components/layout/Footer'
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
import { getActiveHeroBanners } from '~/lib/heroBanner.server'
import type { HeroBanner } from '~/lib/heroBanner'
import { getHomeBlocks } from '~/models/homeLayout.server'
import type { HomeBlockState } from '~/lib/homeBlocks'
import {
  BlogBlock,
  CtaBlock,
  HeroBlock,
  IdentityBlock,
  StartBlock,
  StepsBlock,
  TestimonialsBlock
} from '~/components/home/HomeSections'
import { checkRateLimit, getClientIp, rateLimitMessage } from '~/lib/rateLimit.server'
import { cleanPlainText, hasControlChars, rejectForeignOrigin } from '~/lib/formGuard.server'
import { buildOgMeta, DEFAULT_OG_IMAGE } from '~/lib/seo'
import { getPublishedTestimonials } from '~/models/testimonial.server'
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
  // El orden y los textos de la portada vienen de /admin/inicio. Solo se consulta lo que los
  // bloques encendidos van a mostrar.
  const blocks = (await getHomeBlocks()).filter(b => b.enabled)
  const has = (type: HomeBlockState['type']) => blocks.some(b => b.type === type)

  const [cart, heroBanners, recentPosts, testimonials, catalogItems, subscriptionConfig] = await Promise.all([
    getCart(request),
    has('banner') ? getActiveHeroBanners() : [],
    has('blog')
      ? BlogPostModel.find({ publishedAt: { $lte: new Date() } })
          .sort({ publishedAt: -1 })
          .limit(3)
          .select('title slug excerpt')
          .lean()
      : [],
    has('testimonials') ? getPublishedTestimonials() : [],
    has('start') ? getCatalogItems() : [],
    has('start') ? getSubscriptionConfig() : null
  ])

  // Producto destacado: el que se eligió en /admin/inicio (si sigue disponible); en automático,
  // un paquete (suele ser la mejor puerta de entrada) y si no hay ninguno, el primer producto.
  const chosenSku = blocks.find(b => b.type === 'start')?.content.featuredSku
  const featured =
    (chosenSku ? catalogItems.find(p => p.sku === chosenSku) : undefined) ??
    catalogItems.find(p => p.kind === 'bundle') ??
    catalogItems[0] ??
    null

  return data({
    isStoreActive: true as const,
    origin,
    cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
    blocks,
    heroBanners,
    featured,
    subscriptionPitch: subscriptionConfig
      ? `Activa el auto-envío periódico y recibe tu concentrado ${describeFrequencies(subscriptionConfig)}${
          subscriptionConfig.discountPercent > 0
            ? ` con ${subscriptionConfig.discountPercent}% de descuento automático`
            : ''
        }.`
      : '',
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
  const rateLimit = await checkRateLimit(`waitlist:${ip}`, { max: 5, windowMs: 60 * 60 * 1000 })
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

export default function Index() {
  const data = useLoaderData<typeof loader>()

  if (!data.isStoreActive) {
    return <PrelaunchLanding concentrate={data.concentrate} />
  }

  return (
    <LaunchedLanding
      cartCount={data.cartCount}
      blocks={data.blocks}
      heroBanners={data.heroBanners}
      featured={data.featured}
      subscriptionPitch={data.subscriptionPitch}
      recentPosts={data.recentPosts}
      testimonials={data.testimonials}
    />
  )
}

function LaunchedLanding({
  cartCount,
  blocks,
  heroBanners,
  featured,
  subscriptionPitch,
  recentPosts,
  testimonials
}: {
  cartCount: number
  blocks: HomeBlockState[]
  heroBanners: HeroBanner[]
  featured: CatalogItem | null
  subscriptionPitch: string
  recentPosts: { slug: string; title: string; excerpt: string }[]
  testimonials: { customerName: string; quote: string; photoUrl: string }[]
}) {
  // El enlace «Explorar el modo de uso» del hero por defecto apunta al bloque de compra si está encendido.
  const exploreHref = blocks.some(b => b.type === 'start') ? '#tienda-teaser' : '/como-funciona'

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />

      {/* Los bloques van en el orden que se definió en /admin/inicio (solo los encendidos). */}
      <main className="flex-1">
        {blocks.map(block => {
          switch (block.type) {
            case 'banner':
              return <HeroBlock key={block.type} banners={heroBanners} exploreHref={exploreHref} />
            case 'start':
              return (
                <StartBlock
                  key={block.type}
                  content={block.content}
                  featured={featured}
                  subscriptionPitch={subscriptionPitch}
                />
              )
            case 'identity':
              return <IdentityBlock key={block.type} content={block.content} />
            case 'steps':
              return <StepsBlock key={block.type} content={block.content} />
            case 'testimonials':
              return <TestimonialsBlock key={block.type} content={block.content} testimonials={testimonials} />
            case 'blog':
              return <BlogBlock key={block.type} content={block.content} recentPosts={recentPosts} />
            case 'cta':
              return <CtaBlock key={block.type} content={block.content} />
          }
        })}
      </main>

      <Footer />
    </div>
  )
}
