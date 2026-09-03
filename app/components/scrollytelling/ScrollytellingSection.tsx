import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { Link } from "@remix-run/react";
import { ClientOnly } from "~/components/ui/ClientOnly";
import type { SceneRefs } from "~/components/3d/ScrollyCanvas";
import { FluidWaves } from "~/components/ui/FluidWaves";

// three.js/R3F/drei son pesados (~800kB): se cargan solo en cliente, en su
// propio chunk, y solo cuando esta sección realmente se monta.
const ScrollyCanvas = lazy(() =>
  import("~/components/3d/ScrollyCanvas").then((m) => ({ default: m.ScrollyCanvas })),
);

export function ScrollytellingSection() {
  const sectionRef = useRef<HTMLElement>(null);

  const bottleRef = useRef<THREE.Group>(null);
  const capRef = useRef<THREE.Group>(null);
  const capLiquidRef = useRef<THREE.Mesh>(null);
  const squishableRef = useRef<THREE.Group>(null);
  const squishableLiquidRef = useRef<THREE.Mesh>(null);
  const faucetRef = useRef<THREE.Group>(null);
  const waterStreamRef = useRef<THREE.Mesh>(null);

  const heroTextRef = useRef<HTMLDivElement>(null);
  const paso1TextRef = useRef<HTMLDivElement>(null);
  const paso2TextRef = useRef<HTMLDivElement>(null);
  const paso3TextRef = useRef<HTMLDivElement>(null);
  const paso4TextRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  const refs: SceneRefs = {
    bottleRef,
    capRef,
    capLiquidRef,
    squishableRef,
    squishableLiquidRef,
    faucetRef,
    waterStreamRef,
  };

  // El Canvas se carga de forma perezosa (code-splitting); los refs de los
  // meshes solo existen una vez que R3F confirma el primer render vía
  // onCreated. Disparar el timeline de GSAP antes de eso deja el timeline
  // sin construir y los bloques de texto sin su opacidad inicial.
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    if (!canvasReady) return;

    let ctx: { revert: () => void } | undefined;

    (async () => {
      const gsap = (await import("gsap")).default;
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);

      if (
        !sectionRef.current ||
        !bottleRef.current ||
        !capRef.current ||
        !capLiquidRef.current ||
        !squishableRef.current ||
        !squishableLiquidRef.current ||
        !faucetRef.current ||
        !waterStreamRef.current
      ) {
        return;
      }

      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      ctx = gsap.context(() => {
        const bottle = bottleRef.current!;
        const cap = capRef.current!;
        const capLiquid = capLiquidRef.current!;
        const squishable = squishableRef.current!;
        const squishableLiquid = squishableLiquidRef.current!;
        const faucet = faucetRef.current!;
        const waterStream = waterStreamRef.current!;
        const squishableLiquidMaterial = squishableLiquid.material as THREE.MeshPhysicalMaterial;

        // --- Estado inicial de la escena ---
        gsap.set(bottle.position, { x: 1.4, y: 0.2, z: 0 });
        gsap.set(bottle.rotation, { x: 0, y: 0, z: 0 });
        gsap.set(cap.position, { x: 1.4, y: 1.9, z: 0 });
        gsap.set(cap.rotation, { x: 0, y: 0, z: 0 });
        gsap.set(capLiquid.scale, { y: 0 });
        gsap.set(squishable.position, { x: 0, y: -4, z: 0 });
        gsap.set(squishableLiquid.scale, { y: 0.001 });
        squishableLiquidMaterial.color.set("#BFE0EE");
        gsap.set(faucet.position, { x: -4.5, y: 1.6, z: 0 });
        gsap.set(waterStream.scale, { y: 0 });
        gsap.set(waterStream.position, { x: -1.7, y: 1.1, z: 0 });

        gsap.set([paso1TextRef.current, paso2TextRef.current, paso3TextRef.current, paso4TextRef.current], {
          opacity: 0,
        });
        gsap.set(heroTextRef.current, { opacity: 1 });

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top top",
            end: "bottom bottom",
            scrub: prefersReducedMotion ? false : 1,
            onUpdate: (self) => {
              if (progressBarRef.current) {
                progressBarRef.current.style.transform = `scaleX(${self.progress})`;
              }
            },
          },
          defaults: { ease: "power1.inOut" },
        });

        // ===================== HERO (0 - 15) =====================
        tl.to(heroTextRef.current, { opacity: 0, duration: 3 }, 12);

        // ===================== PASO 1 (15 - 35) — giro y destape =====================
        tl.to(paso1TextRef.current, { opacity: 1, duration: 2 }, 15)
          .to(bottle.rotation, { z: -0.18, duration: 3 }, 16)
          .to(bottle.rotation, { z: 0.18, duration: 3 }, 19)
          .to(bottle.rotation, { z: 0, duration: 2 }, 22)
          .to(bottle.rotation, { z: Math.PI / 2, duration: 4 }, 26)
          .to(bottle.position, { y: 0.6, duration: 4 }, 26)
          .to(cap.rotation, { y: Math.PI * 6, duration: 6, ease: "power1.in" }, 24)
          .to(cap.position, { x: 0.55, y: 0.35, z: 0.4, duration: 6 }, 24)
          .to(capLiquid.scale, { y: 1, duration: 2 }, 28)
          .to(paso1TextRef.current, { opacity: 0, duration: 2 }, 33);

        // ===================== PASO 2 (35 - 60) — dosificación al squishable =====================
        tl.to(paso2TextRef.current, { opacity: 1, duration: 2 }, 35)
          .to(bottle.position, { y: 6, duration: 5 }, 35)
          .to(squishable.position, { y: -0.2, duration: 6, ease: "back.out(1.2)" }, 38)
          .to(cap.position, { x: 0.15, y: 1.05, z: 0.25, duration: 5 }, 42)
          .to(cap.rotation, { z: -Math.PI / 3.2, duration: 5 }, 44)
          .to(capLiquid.scale, { y: 0.15, duration: 3 }, 50)
          .to(squishableLiquid.scale, { y: 0.12, duration: 3 }, 50)
          .to(paso2TextRef.current, { opacity: 0, duration: 2 }, 58);

        // ===================== PASO 3 (60 - 85) — activación con agua =====================
        tl.to(paso3TextRef.current, { opacity: 1, duration: 2 }, 60)
          .to(cap.position, { y: 5, x: 1.5, duration: 5 }, 60)
          .to(squishable.position, { x: 0, y: 0, duration: 5, ease: "power2.inOut" }, 60)
          .to(faucet.position, { x: -1.7, duration: 6 }, 62)
          .to(waterStream.scale, { y: 1, duration: 2 }, 68)
          .to(squishableLiquid.scale, { y: 0.86, duration: 10, ease: "power1.in" }, 68)
          .to(squishableLiquidMaterial.color, { r: 0.71, g: 0.83, b: 0.2, duration: 10 }, 68)
          .to(waterStream.scale, { y: 0, duration: 2 }, 80)
          .to(paso3TextRef.current, { opacity: 0, duration: 2 }, 83);

        // ===================== PASO 4 (85 - 100) — cierre =====================
        tl.to(faucet.position, { x: -4.5, duration: 4 }, 84)
          .to(squishable.rotation, { y: Math.PI * 2, duration: 10, ease: "power1.inOut" }, 86)
          .to(squishable.position, { y: 0.2, duration: 4, ease: "power2.out" }, 86)
          .to(paso4TextRef.current, { opacity: 1, duration: 3 }, 88);
      }, sectionRef);
    })();

    return () => ctx?.revert();
  }, [canvasReady]);

  return (
    <section ref={sectionRef} className="relative bg-carbon" style={{ height: "620vh" }}>
      <div className="sticky top-0 h-screen w-full overflow-hidden">
        <FluidWaves tone="dark" className="absolute inset-0 h-full w-full opacity-60" />

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
              "radial-gradient(120% 90% at 15% 50%, rgba(24,28,20,0.55) 0%, rgba(24,28,20,0) 55%), radial-gradient(120% 90% at 85% 50%, rgba(24,28,20,0.5) 0%, rgba(24,28,20,0) 55%)",
          }}
        />

        {/* HERO */}
        <div ref={heroTextRef} className="pointer-events-none absolute inset-0 flex items-center">
          <div className="max-w-md px-6 sm:px-12">
            <p className="font-body text-sm font-bold uppercase tracking-widest text-lima">
              Concentrado biotecnológico
            </p>
            <h1 className="mt-3 font-display text-4xl font-black leading-[1.05] text-hueso sm:text-5xl">
              Ciudades limpias, paseos impecables.
            </h1>
            <p className="mt-4 max-w-sm text-hueso/75">
              El concentrado biotecnológico que neutraliza al instante y degrada los residuos
              del paseo canino. Un litro rinde 30 litros.
            </p>
            <div className="pointer-events-auto mt-7 flex flex-wrap items-center gap-3">
              <Link
                to="/tienda"
                className="min-h-11 rounded-full bg-lima px-7 py-3 text-sm font-bold text-carbon transition-transform hover:scale-105 active:scale-95"
              >
                Comprar
              </Link>
              <a
                href="#tienda-teaser"
                className="min-h-11 rounded-full border-2 border-hueso/25 px-7 py-3 text-sm font-bold text-hueso transition-colors hover:border-hueso/50"
              >
                Explorar el modo de uso ↓
              </a>
            </div>
          </div>
        </div>

        {/* PASO 1 */}
        <div ref={paso1TextRef} className="pointer-events-none absolute inset-0 flex items-center opacity-0">
          <div className="max-w-sm px-6 sm:px-12">
            <p className="font-body text-sm font-bold uppercase tracking-widest text-lima">Paso 1</p>
            <p className="mt-2 font-display text-2xl font-bold text-hueso sm:text-3xl">
              Después de agitar un poco, destapa y llena la tapa de concentrado STOPee.
            </p>
          </div>
        </div>

        {/* PASO 2 */}
        <div ref={paso2TextRef} className="pointer-events-none absolute inset-0 flex items-center justify-end opacity-0">
          <div className="max-w-sm px-6 text-right sm:px-12">
            <p className="font-body text-sm font-bold uppercase tracking-widest text-lima">Paso 2</p>
            <p className="mt-2 font-display text-2xl font-bold text-hueso sm:text-3xl">
              Vacía la tapa en tu bote squishable de 500 ml.
            </p>
          </div>
        </div>

        {/* PASO 3 */}
        <div ref={paso3TextRef} className="pointer-events-none absolute inset-0 flex items-center justify-end opacity-0">
          <div className="max-w-sm px-6 text-right sm:px-12">
            <p className="font-body text-sm font-bold uppercase tracking-widest text-lima">Paso 3</p>
            <p className="mt-2 font-display text-2xl font-bold text-hueso sm:text-3xl">
              Llena tu bote de 500 ml con agua de la llave y ya estás listo para el paseo.
            </p>
          </div>
        </div>

        {/* PASO 4 — cierre */}
        <div ref={paso4TextRef} className="pointer-events-none absolute inset-0 flex items-end justify-center pb-24 opacity-0">
          <div className="pointer-events-auto max-w-sm px-6 text-center">
            <p className="font-display text-2xl font-bold text-hueso sm:text-3xl">
              Tu STOPee está listo. Sal a pasear con confianza.
            </p>
            <a
              href="#tienda-teaser"
              className="mt-5 inline-block min-h-11 rounded-full bg-lima px-7 py-3 text-sm font-bold text-carbon transition-transform hover:scale-105"
            >
              Ver paquetes ↓
            </a>
          </div>
        </div>

        {/* Barra de progreso */}
        <div className="absolute inset-x-0 bottom-0 h-1 bg-hueso/10">
          <div
            ref={progressBarRef}
            className="h-full w-full origin-left bg-lima"
            style={{ transform: "scaleX(0)" }}
          />
        </div>
      </div>
    </section>
  );
}
