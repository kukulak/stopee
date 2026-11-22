import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'
import { Link } from 'react-router'
import { ClientOnly } from '~/components/ui/ClientOnly'
import type { SceneRefs } from '~/components/3d/ScrollyCanvas'
import { ArrowIcon } from "~/components/ui/Icons";

// El fondo de remolinos de esta sección ahora lo pone el contenedor
// compartido en _index.tsx (junto con el manifiesto), con la misma
// composición/paralax que el landing de pre-lanzamiento — ver
// DEFAULT_PAGE_SWIRLS en ~/components/ui/BrandSwirls.

// three.js/R3F/drei son pesados (~800kB): se cargan solo en cliente, en su
// propio chunk, y solo cuando esta sección realmente se monta.
const ScrollyCanvas = lazy(() =>
  import('~/components/3d/ScrollyCanvas').then(m => ({
    default: m.ScrollyCanvas
  }))
)

export function ScrollytellingSection({
  exploreHref = '#tienda-teaser'
}: {
  exploreHref?: string
}) {
  const sectionRef = useRef<HTMLElement>(null)

  const bottleRef = useRef<THREE.Group>(null)
  const capRef = useRef<THREE.Group>(null)
  const capLiquidRef = useRef<THREE.Mesh>(null)
  const squishableRef = useRef<THREE.Group>(null)
  const squishableLiquidRef = useRef<THREE.Mesh>(null)
  const faucetRef = useRef<THREE.Group>(null)
  const waterStreamRef = useRef<THREE.Mesh>(null)

  const refs: SceneRefs = {
    bottleRef,
    capRef,
    capLiquidRef,
    squishableRef,
    squishableLiquidRef,
    faucetRef,
    waterStreamRef
  }

  // El Canvas se carga de forma perezosa (code-splitting); los refs de los
  // meshes solo existen una vez que R3F confirma el primer render vía
  // onCreated. Disparar el timeline de GSAP antes de eso deja el timeline
  // sin construir y los bloques de texto sin su opacidad inicial.
  const [canvasReady, setCanvasReady] = useState(false)

  // Arreglo rápido pedido por el usuario: este hero ocupaba toda la pantalla
  // (480vh fijados con scroll-jacking vía GSAP ScrollTrigger) y el scroll se
  // sentía trabado — obligaba a scrollear una distancia enorme para ver la
  // animación completa del concentrado + squishable, sin forma de saltarla.
  // La coreografía paso a paso (que vivía en un timeline con scrub) se quita
  // por ahora; la escena 3D se queda en su pose inicial (botella + tapa) con
  // el mismo texto de hero, en una sección de altura normal. La animación
  // definitiva (diluir el STOPee en el squishable) se diseña más adelante.
  useEffect(() => {
    if (!canvasReady) return

    let ctx: { revert: () => void } | undefined

    ;(async () => {
      const gsap = (await import('gsap')).default

      if (
        !bottleRef.current ||
        !capRef.current ||
        !capLiquidRef.current ||
        !squishableRef.current ||
        !squishableLiquidRef.current ||
        !faucetRef.current ||
        !waterStreamRef.current
      ) {
        return
      }

      // En pantallas angostas la cámara (ver ScrollyCanvas) se aleja para
      // que el ancho de escena siga cabiendo — se compensa acercando la
      // botella/tapa al centro.
      const isNarrow = window.innerWidth < 640
      const X = isNarrow ? 0.55 : 1

      ctx = gsap.context(() => {
        const bottle = bottleRef.current!
        const cap = capRef.current!
        const capLiquid = capLiquidRef.current!
        const squishable = squishableRef.current!
        const squishableLiquid = squishableLiquidRef.current!
        const faucet = faucetRef.current!
        const waterStream = waterStreamRef.current!
        const squishableLiquidMaterial =
          squishableLiquid.material as THREE.MeshPhysicalMaterial

        // --- Pose inicial de la escena (botella + tapa), sin animación ---
        gsap.set(bottle.position, { x: 1.4 * X, y: 0.2, z: 0 })
        gsap.set(bottle.rotation, { x: 0, y: 0, z: 0 })
        bottle.visible = true

        gsap.set(cap.position, { x: 1.4 * X, y: 1.9, z: 0 })
        gsap.set(cap.rotation, { x: 0, y: 0, z: 0 })
        gsap.set(capLiquid.scale, { y: 0 })
        cap.visible = true

        gsap.set(squishable.position, { x: 0, y: -4, z: 0 })
        gsap.set(squishableLiquid.scale, { y: 0.001 })
        squishableLiquidMaterial.color.set('#BFE0EE')
        squishable.visible = false

        gsap.set(faucet.position, { x: -4.5 * X, y: 1.6, z: 0 })
        faucet.visible = false

        gsap.set(waterStream.scale, { y: 0 })
        gsap.set(waterStream.position, { x: -1.7 * X, y: 1.1, z: 0 })
        waterStream.visible = false
      }, sectionRef)
    })()

    return () => ctx?.revert()
  }, [canvasReady])

  return (
    <section
      ref={sectionRef}
      className="relative min-h-[420px] overflow-hidden sm:min-h-[520px]"
    >
      <ClientOnly>
        {() => (
          <Suspense fallback={null}>
            <ScrollyCanvas refs={refs} onReady={() => setCanvasReady(true)} />
          </Suspense>
        )}
      </ClientOnly>

      {/* Viñeta para legibilidad del texto */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 15% 50%, rgba(24,28,20,0.55) 0%, rgba(24,28,20,0) 55%), radial-gradient(120% 90% at 85% 50%, rgba(24,28,20,0.5) 0%, rgba(24,28,20,0) 55%)'
        }}
      />

      {/* HERO */}
      <div className="pointer-events-none absolute inset-0 flex items-center">
        <div className="max-w-md px-6 sm:px-12">
          <p className="font-body text-sm font-bold uppercase tracking-widest text-lima">
            Concentrado biotecnológico
          </p>
          <h1 className="mt-3 font-display text-4xl font-black leading-[1.05] text-hueso sm:text-5xl">
            Ciudades limpias, paseos impecables.
          </h1>
          <p className="mt-4 max-w-sm text-hueso/75">
            El concentrado biotecnológico que neutraliza al instante y degrada
            los residuos del paseo canino. Un litro rinde 30 litros.
          </p>
          <div className="pointer-events-auto mt-7 flex flex-wrap items-center gap-3">
            <Link
              to="/tienda"
              className="min-h-11 rounded-full bg-lima px-7 py-3 text-sm font-bold text-carbon transition-transform hover:scale-105 active:scale-95"
            >
              Comprar
            </Link>
            <a
              href={exploreHref}
              className="group inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-hueso/25 px-7 py-3 text-sm font-bold text-hueso transition-colors hover:border-hueso/50"
            >
              Explorar el modo de uso
              <ArrowIcon direction="down" />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
