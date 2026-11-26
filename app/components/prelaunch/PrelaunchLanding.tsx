import { useEffect, useState } from 'react'
import {
  Link,
  useFetcher,
  useRouteLoaderData,
  type FetcherWithComponents
} from 'react-router'
import type { action } from '~/routes/_index'
import type { loader as RootLoader } from '~/root'
import { EditableLogo } from '~/components/ui/EditableLogo'
import { EditableBrandSwirls } from '~/components/ui/EditableBrandSwirls'
import { DEFAULT_PAGE_SWIRLS } from '~/components/ui/BrandSwirls'
import { SocialIcon } from '~/components/ui/SocialIcon'
import { CookieSettingsButton } from '~/components/ui/CookieConsent'
import { BrandText } from "~/components/ui/BrandText";
import { AnchorLink } from "~/components/ui/AnchorLink";

// --- Iconos minimalistas (línea, currentColor) ------------------------

function IconMicrobe() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <rect
        x="7"
        y="9"
        width="10"
        height="6"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="5" cy="6" r="1.1" fill="currentColor" />
      <circle cx="19.5" cy="7" r="1" fill="currentColor" />
      <circle cx="6" cy="18.5" r="1" fill="currentColor" />
      <circle cx="18.5" cy="17.5" r="1.1" fill="currentColor" />
    </svg>
  )
}

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconPaw() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <ellipse cx="12" cy="16.5" rx="5" ry="4" />
      <circle cx="5.5" cy="9.5" r="1.9" />
      <circle cx="10.3" cy="6" r="1.9" />
      <circle cx="15.7" cy="6" r="1.9" />
      <circle cx="20.5" cy="9.5" r="1.9" />
    </svg>
  )
}

function IconStorefront() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M4 9l1-4h14l1 4M4 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0M5 9v9h14V9M9 18v-5h6v5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconCity() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M4 21V9l5-3v15M9 21V6l6-3v18M15 21V10l5-2v13M4 21h16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-limaNeon/10 text-limaNeon">
      {children}
    </span>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-limaNeon/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-limaNeon">
      {children}
    </span>
  )
}

// --- Contenido ----------------------------------------------------------

const BONDADES = [
  {
    title: 'Ricinoleato de zinc',
    badge: 'Acción química de contacto',
    icon: IconShield,
    detail:
      'Atrapa y neutraliza los compuestos del mal olor en superficie al momento de la aplicación, deteniendo la carga olfativa persistente.'
  },
  {
    title: 'Bacillus subtilis',
    badge: 'Degradación biológica activa',
    icon: IconMicrobe,
    detail:
      'Esporas benéficas vivas que colonizan la superficie y degradan la materia orgánica de forma progresiva y continua.'
  }
]

const BENEFICIOS = [
  {
    audience: 'Para ti y tu perro',
    icon: IconPaw,
    detail:
      'Caminatas con la tranquilidad de mantener una rutina ejemplar, atendiendo cada parada de tu perro con empatía y responsabilidad.'
  },
  {
    audience: 'Para tu entorno',
    icon: IconStorefront,
    detail:
      'Cada superficie exterior libre de acumulación orgánica y aromas penetrantes. Corta de raíz la sobreescritura olfativa en los puntos comunes de la ruta.'
  },
  {
    audience: 'Para la comunidad',
    icon: IconCity,
    detail:
      'Convivencia armónica con vecinos y comercios, mobiliario exterior protegido del desgaste y biotecnología activa sumando al bienestar colectivo.'
  }
]

// --- Precio ---------------------------------------------------------------

/** Rendimiento del concentrado: 1 L genera 30 L de solución (igual que en el resto de la página). */
const LITROS_SOLUCION_POR_LITRO = 30

export type ConcentratePrice = { priceMxn: number; unitValue: number }

function formatMxn(amount: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount)
}

function pricePerSolutionLitre({ priceMxn, unitValue }: ConcentratePrice) {
  return (
    Math.round((priceMxn / (unitValue * LITROS_SOLUCION_POR_LITRO)) * 100) / 100
  )
}

function PriceCard({
  concentrate,
  joined
}: {
  concentrate: ConcentratePrice
  joined: boolean
}) {
  return (
    <div className="mx-auto max-w-md rounded-3xl border border-limaNeon/25 bg-white/[0.04] p-6 text-center backdrop-blur-xl">
      <p className="font-body text-xs font-bold uppercase tracking-widest text-limaNeon">
        <BrandText>Precio de STOPee</BrandText>
      </p>
      <p className="mt-2 font-display text-5xl font-black leading-none text-white">
        {formatMxn(concentrate.priceMxn)}{' '}
        <span className="text-base font-bold text-slate-200/70">MXN</span>
      </p>
      <p className="mt-3 text-sm text-slate-200/90">
        Cada bote de {concentrate.unitValue}{' '}
        {concentrate.unitValue === 1 ? 'litro' : 'litros'} es concentrado y
        rinde {concentrate.unitValue * LITROS_SOLUCION_POR_LITRO} litros de
        solución: sale en {formatMxn(pricePerSolutionLitre(concentrate))} por
        litro listo para usar.
      </p>
      {joined ? (
        <p className="mt-4 text-sm font-semibold text-limaNeon">
          Ya estás en la lista: tu descuento de bienvenida queda reservado.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm font-semibold text-limaNeon">
            Regístrate y recibe tu descuento de bienvenida sobre este precio.
          </p>
          <AnchorLink
            href="#reservar-lugar"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-limaNeon px-7 text-sm font-bold text-carbon transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_0_24px_rgba(216,248,59,0.45)] active:scale-95"
          >
            Reservar mi lugar en preventa
          </AnchorLink>
        </>
      )}
    </div>
  )
}

// --- Formulario de captura ------------------------------------------------
// Hay dos formularios en la página (arriba y abajo) que comparten un solo
// envío: en cuanto uno se manda, ambos pasan a mostrar la confirmación, para
// que nadie registre el mismo correo dos veces en una visita.

type WaitlistFetcher = FetcherWithComponents<{ ok: boolean; error?: string }>

function WaitlistForm({
  formId,
  microcopy,
  fetcher,
  joined,
  activeFormId,
  onSubmitStart,
  onUseAnotherEmail
}: {
  formId: string
  microcopy: string
  fetcher: WaitlistFetcher
  joined: boolean
  /** Formulario desde el que se hizo el último envío (para mostrar ahí el error). */
  activeFormId: string | null
  onSubmitStart: (formId: string) => void
  onUseAnotherEmail: () => void
}) {
  const isSubmitting = fetcher.state !== 'idle'
  const isThisFormSubmitting = isSubmitting && activeFormId === formId
  const error = activeFormId === formId ? fetcher.data?.error : undefined

  if (joined) {
    return (
      <div
        role="status"
        className="mx-auto mt-8 max-w-md rounded-3xl border border-limaNeon/30 bg-limaNeon/10 p-6"
      >
        <p className="font-display text-lg font-bold text-limaNeon">
          ¡Listo! Ya estás en la lista.
        </p>
        <p className="mt-1 text-sm text-slate-200/90">
          Te avisaremos en cuanto abramos la tienda y tendrás un descuento de
          bienvenida reservado en tu correo.
        </p>
        <button
          type="button"
          onClick={onUseAnotherEmail}
          className="mt-4 min-h-11 text-sm text-slate-200/60 underline underline-offset-4 transition-colors hover:text-white"
        >
          ¿Te equivocaste de correo? Usar otro
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto mt-8 max-w-md">
      <fetcher.Form
        method="post"
        className="flex flex-col gap-3"
        noValidate
        onSubmit={() => onSubmitStart(formId)}
      >
        <label htmlFor={`email-${formId}`} className="sr-only">
          Correo electrónico
        </label>
        <input
          id={`email-${formId}`}
          name="email"
          type="email"
          required
          placeholder="tu@correo.com"
          autoComplete="email"
          className="min-h-11 flex-1 rounded-full border border-white/15 bg-white/5 px-5 text-white placeholder:text-white/40 outline-none transition-all duration-200 focus:border-limaNeon focus:ring-4 focus:ring-limaNeon/20"
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="min-h-11 rounded-full bg-limaNeon px-7 text-sm font-bold text-carbon transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_0_24px_rgba(216,248,59,0.45)] active:scale-95 disabled:opacity-60 disabled:hover:scale-100 disabled:hover:shadow-none"
        >
          {isThisFormSubmitting ? 'Enviando…' : 'Reservar mi lugar en preventa'}
        </button>
      </fetcher.Form>

      {error ? (
        <p className="mt-3 text-sm font-semibold text-red-400">{error}</p>
      ) : (
        <p className="mt-3 text-xs text-slate-200/60">{microcopy}</p>
      )}
      <p className="mt-2 text-xs text-slate-200/50">
        Al registrar tu correo, tus datos se tratan como explica nuestro{' '}
        <Link to="/aviso-de-privacidad" className="underline underline-offset-2 hover:text-white">
          aviso de privacidad
        </Link>
        .
      </p>
    </div>
  )
}

// --- Barra fija móvil: aparece al salir del Hero -------------------------

function MobileStickyCta({ joined }: { joined: boolean }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const hero = document.getElementById('lista-de-espera')
    if (!hero) return

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { rootMargin: '-10% 0px 0px 0px' }
    )
    observer.observe(hero)
    return () => observer.disconnect()
  }, [])

  // Ya se registró: la barra para "reservar" no tiene nada más que ofrecer.
  if (joined) return null

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-carbonDeep/95 px-4 py-3 backdrop-blur-md transition-transform duration-300 sm:hidden ${
        visible
          ? 'translate-y-0 pointer-events-auto'
          : 'translate-y-full pointer-events-none'
      }`}
      aria-hidden={!visible}
    >
      <AnchorLink
        href="#lista-de-espera"
        className="flex min-h-11 items-center justify-center rounded-full bg-limaNeon px-6 text-sm font-bold text-carbon transition-all duration-200 hover:scale-[1.02] active:scale-95"
      >
        Reservar mi lugar en preventa
      </AnchorLink>
    </div>
  )
}

const JOINED_KEY = 'stopee-waitlist-joined'

export function PrelaunchLanding({
  concentrate
}: {
  concentrate: ConcentratePrice | null
}) {
  const rootData = useRouteLoaderData<typeof RootLoader>('root')

  // Un solo envío para los dos formularios; se recuerda mientras dure la
  // sesión del navegador para que recargar o volver a la página no los
  // reabra. Se lee en un efecto (no en el render) para no desajustar la
  // hidratación.
  const fetcher = useFetcher<typeof action>()
  const [joined, setJoined] = useState(false)
  const [activeFormId, setActiveFormId] = useState<string | null>(null)

  useEffect(() => {
    try {
      if (sessionStorage.getItem(JOINED_KEY)) setJoined(true)
    } catch {
      // sin almacenamiento (modo privado, etc.): solo se pierde el recuerdo
    }
  }, [])

  useEffect(() => {
    if (!fetcher.data?.ok) return
    setJoined(true)
    try {
      sessionStorage.setItem(JOINED_KEY, '1')
    } catch {
      // ver arriba
    }
  }, [fetcher.data])

  function reopenForm() {
    setJoined(false)
    try {
      sessionStorage.removeItem(JOINED_KEY)
    } catch {
      // ver arriba
    }
  }

  const formProps = {
    fetcher: fetcher as WaitlistFetcher,
    joined,
    activeFormId,
    onSubmitStart: setActiveFormId,
    onUseAnotherEmail: reopenForm
  }
  const socialLinks = (rootData?.socialLinks ?? []).map(link => ({
    name: link.name,
    iconId: link.id,
    href: link.url
  }))

  // El body es claro por default (lo usan el resto de páginas del sitio).
  // Esta landing es oscura de punta a punta, así que si no oscurecemos
  // también el body, el rebote elástico del scroll (al llegar hasta arriba
  // o abajo del todo) deja ver ese fondo claro detrás. Se restaura al
  // desmontar para no afectar otras páginas al navegar entre ellas.
  useEffect(() => {
    const previousBackground = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#11130E'
    return () => {
      document.body.style.backgroundColor = previousBackground
    }
  }, [])

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-carbonDeep text-white">
      <EditableBrandSwirls swirls={DEFAULT_PAGE_SWIRLS} id="prelaunch" />
      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-center px-4 py-6 sm:px-6">
        <EditableLogo className="w-auto" heightPx={181} id="prelaunch-logo" />
      </header>

      <main className="relative flex-1 pb-16 sm:pb-0">
        {/* HERO + CAPTURA */}
        <section id="lista-de-espera" className="relative">
          <div className="relative mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-24">
            <p className="font-body text-sm font-bold uppercase tracking-widest text-limaNeon">
              Lanzamiento exclusivo en Ciudad de México
            </p>

            <h1 className="mt-4 font-display text-4xl font-black leading-[1.05] text-white sm:text-5xl">
              Amor por los perros, respeto por la colonia.
            </h1>
            <p className="mx-auto mt-5 max-w-lg text-slate-200/90">
              Biotecnología activa para neutralizar y degradar los residuos de
              orina en cada paseo. Un gesto sencillo que cuida las fachadas,
              respeta a los vecinos y mantiene la colonia limpia.
            </p>

            <WaitlistForm
              {...formProps}
              formId="hero"
              microcopy="Sé de los primeros en recibir el lote inicial con precio preferencial de lanzamiento."
            />
          </div>
        </section>

        {/* EL RITMO DEL PASEO */}
        <section className="border-t border-white/[0.08] bg-carbonDeep/[0.05] py-20">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
            <p className="font-body text-sm font-bold uppercase tracking-widest text-limaNeon">
              El nuevo estándar urbano
            </p>
            <h2 className="mt-3 font-display text-3xl font-black text-white sm:text-4xl">
              Ser buen vecino también es parte del paseo.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-slate-200/80">
              El tutor consciente cuida integralmente cada paso del camino.
              STOPee renueva los puntos de marcaje y eleva la convivencia
              comunitaria en cada salida.
            </p>
          </div>
        </section>

        {/* BIOTECNOLOGÍA ACTIVA — bento grid asimétrico */}
        <section className="border-t border-white/[0.08] py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-center font-body text-sm font-bold uppercase tracking-widest text-oliva">
              Ciencia aplicada al paseo
            </p>
            <h2 className="mt-2 text-center font-display text-3xl font-black text-white sm:text-4xl">
              Neutralización profunda desde el origen
            </h2>

            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 sm:grid-rows-2">
              {BONDADES.map((b, i) => (
                <div
                  key={b.title}
                  className={`group rounded-3xl border border-white/[0.08] bg-white/[0.04] p-6 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-limaNeon/30 hover:shadow-[0_12px_32px_rgba(0,0,0,0.35)] sm:col-start-1 ${
                    i === 0 ? 'sm:row-start-1' : 'sm:row-start-2'
                  }`}
                >
                  <Badge>{b.badge}</Badge>
                  <div className="mt-4 flex items-center gap-3">
                    <IconChip>
                      <b.icon />
                    </IconChip>
                    <p className="font-display text-lg font-bold text-white">
                      {b.title}
                    </p>
                  </div>
                  <p className="mt-3 text-sm text-slate-200/80">{b.detail}</p>
                </div>
              ))}

              {/* tarjeta alta destacada: rendimiento 1:30 */}
              <div className="relative flex flex-col justify-between overflow-hidden rounded-3xl border border-limaNeon/20 bg-gradient-to-br from-white/[0.06] to-white/[0.01] p-8 backdrop-blur-xl transition-all duration-300 hover:border-limaNeon/40 sm:col-start-2 sm:row-start-1 sm:row-span-2">
                <div>
                  <Badge>Rendimiento concentrado</Badge>
                  <p className="mt-6 font-display text-6xl font-black leading-none text-white sm:text-7xl">
                    1L <span className="text-limaNeon">=</span> 30L
                  </p>
                  <p className="mt-4 max-w-xs text-sm text-slate-200/80">
                    Alta concentración diseñada para la rutina diaria. Un solo
                    envase genera 30 litros de solución diluida para acompañar
                    meses enteros de salidas.
                  </p>
                </div>

                {/* gráfica de impacto: proporción 1:30 */}
                <div className="mt-10 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="w-9 shrink-0 text-xs font-bold text-slate-200/60">
                      1 L
                    </span>
                    <div className="h-2 w-[6%] min-w-[10px] rounded-full bg-white/20" />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-9 shrink-0 text-xs font-bold text-limaNeon">
                      30 L
                    </span>
                    <div className="h-2 flex-1 rounded-full bg-gradient-to-r from-limaNeon/40 to-limaNeon" />
                  </div>
                </div>

                {/* {concentrate && (
                  <p className="mt-6 border-t border-white/10 pt-5 text-sm text-slate-200/80">
                    Un bote de {concentrate.unitValue} L cuesta{' '}
                    <span className="font-bold text-white">
                      {formatMxn(concentrate.priceMxn)} MXN
                    </span>
                    : {formatMxn(pricePerSolutionLitre(concentrate))} por litro
                    de solución lista para usar.
                  </p>
                )} */}
              </div>
            </div>
          </div>
        </section>

        {/* PRECIO */}
        {concentrate && (
          <section className="border-t border-white/[0.08] py-16">
            <div className="mx-auto max-w-2xl px-4 sm:px-6">
              <PriceCard concentrate={concentrate} joined={joined} />
            </div>
          </section>
        )}

        {/* BENEFICIOS COMPARTIDOS — pathway conectado */}
        <section className="border-t border-white/[0.08] bg-white/[0.02] py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-center font-body text-sm font-bold uppercase tracking-widest text-limaNeon">
              Beneficios compartidos
            </p>
            <h2 className="mt-2 text-center font-display text-3xl font-black text-white sm:text-4xl">
              Un impacto que se expande en cada cuadra
            </h2>

            <div className="relative mt-14">
              {/* línea de flujo continua: vertical en mobile, horizontal en desktop */}
              <div className="pointer-events-none absolute bottom-0 left-6 top-0 w-px bg-gradient-to-b from-limaNeon/0 via-limaNeon/30 to-limaNeon/0 sm:bottom-auto sm:left-0 sm:right-0 sm:top-6 sm:h-px sm:w-auto sm:bg-gradient-to-r sm:from-limaNeon/0 sm:via-limaNeon/40 sm:to-limaNeon/0" />

              <div className="grid grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-6">
                {BENEFICIOS.map(step => (
                  <div
                    key={step.audience}
                    className="group relative flex gap-5 sm:flex-col sm:items-center sm:gap-0 sm:text-center"
                  >
                    <div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-limaNeon/30 bg-carbonDeep text-limaNeon transition-all duration-300 group-hover:border-limaNeon group-hover:shadow-[0_0_20px_rgba(216,248,59,0.45)] sm:mb-5">
                      <step.icon />
                    </div>
                    <div className="flex-1 rounded-3xl border border-white/[0.08] bg-white/[0.04] p-6 backdrop-blur-xl transition-all duration-300 group-hover:border-limaNeon/30 group-hover:shadow-[0_0_28px_rgba(216,248,59,0.16)]">
                      <p className="font-display text-lg font-bold text-white">
                        {step.audience}
                      </p>
                      <p className="mt-2 text-sm text-slate-200/80">
                        {step.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* CAPTURA FINAL */}
        <section
          id="reservar-lugar"
          className="scroll-mt-6 border-t border-white/[0.08] py-20"
        >
          <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
            <p className="font-body text-sm font-bold uppercase tracking-widest text-limaNeon">
              Lote inicial de producción
            </p>
            <h2 className="mt-3 font-display text-3xl font-black text-white sm:text-4xl">
              Sé de los primeros en tener STOPee
            </h2>
            <p className="mx-auto mt-4 max-w-md text-slate-200/80">
              Asegura tu lugar en la preventa exclusiva y recibe tu descuento de
              bienvenida directo en tu correo antes del lanzamiento oficial.
            </p>

            <WaitlistForm
              {...formProps}
              formId="final"
              microcopy="Acceso prioritario garantizado para el primer lote de distribución."
            />
          </div>
        </section>
      </main>

      <footer className="relative border-t border-white/[0.08] bg-carbonDeep px-4 py-8 text-center text-xs text-slate-200/40 sm:px-6">
        {socialLinks.length > 0 && (
          <div className="mb-4 flex items-center justify-center gap-4">
            {socialLinks.map(social => (
              <a
                key={social.href}
                href={social.href}
                target="_blank"
                rel="noreferrer"
                aria-label={social.name}
                className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-white/10 text-slate-200/60 transition-all duration-200 hover:border-limaNeon/40 hover:text-limaNeon"
              >
                <SocialIcon id={social.iconId} className="h-10 w-10" />
              </a>
            ))}
          </div>
        )}
        <nav aria-label="Legal" className="mb-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
          <Link to="/aviso-de-privacidad" className="inline-flex min-h-11 items-center hover:text-limaNeon">
            Aviso de privacidad
          </Link>
          <Link to="/politica-de-cookies" className="inline-flex min-h-11 items-center hover:text-limaNeon">
            Política de cookies
          </Link>
          <CookieSettingsButton className="inline-flex min-h-11 items-center hover:text-limaNeon">
            Configurar cookies
          </CookieSettingsButton>
        </nav>
        © {new Date().getFullYear()} STOPee.com.mx — Todos los derechos
        reservados.
      </footer>

      <MobileStickyCta joined={joined} />
    </div>
  )
}
