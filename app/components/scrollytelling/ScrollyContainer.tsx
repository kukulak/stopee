import { useEffect, useRef, useState } from "react";

type Scene = {
  id: string;
  eyebrow: string;
  title: string;
  copy: string;
};

const SCENES: Scene[] = [
  {
    id: "giro",
    eyebrow: "Paso 1",
    title: "El giro suave",
    copy: "Gira suavemente a la derecha y a la izquierda. Integra los microorganismos activos y el ricinoleato de zinc preservando la pureza de la solución.",
  },
  {
    id: "dosis",
    eyebrow: "Paso 2",
    title: "Dosificación exacta",
    copy: "Una sola tapa. Alta concentración, máximo rendimiento.",
  },
  {
    id: "transferencia",
    eyebrow: "Paso 3",
    title: "Al Squishable",
    copy: "Diseñado para llevarlo con una sola mano. Vierte la dosis en tu botella flexible STOPee.",
  },
  {
    id: "activacion",
    eyebrow: "Paso 4",
    title: "Dilución y activación",
    copy: "Agrega agua del grifo y realiza un leve movimiento. El ritmo natural de tu caminata completa la activación biológica.",
  },
  {
    id: "paseo",
    eyebrow: "Paso 5",
    title: "Hacia la calle",
    copy: "El espacio público es nuestro hogar compartido.",
  },
  {
    id: "aplicacion",
    eyebrow: "Paso 6",
    title: "Aplicación en acción",
    copy: "Aplica al instante. La doble acción encapsula los olores al contacto y degrada los componentes orgánicos de raíz.",
  },
];

export function ScrollyContainer() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const bottleGroupRef = useRef<SVGGElement>(null);
  const capGroupRef = useRef<SVGGElement>(null);
  const doseFillRef = useRef<SVGRectElement>(null);
  const squishableRef = useRef<SVGGElement>(null);
  const squishableFillRef = useRef<SVGRectElement>(null);
  const waterStreamRef = useRef<SVGGElement>(null);
  const characterRef = useRef<SVGGElement>(null);
  const dogRef = useRef<SVGGElement>(null);
  const waveBurstRef = useRef<SVGGElement>(null);
  const buildingsWaveRef = useRef<SVGGElement>(null);

  const [activeScene, setActiveScene] = useState(0);

  useEffect(() => {
    let ctx: { revert: () => void } | undefined;

    (async () => {
      const gsap = (await import("gsap")).default;
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);

      if (!sectionRef.current) return;

      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      ctx = gsap.context(() => {
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top top",
            end: `+=${SCENES.length * (prefersReducedMotion ? 60 : 100)}%`,
            scrub: prefersReducedMotion ? false : 1,
            pin: true,
            snap: prefersReducedMotion
              ? undefined
              : 1 / (SCENES.length - 1),
            onUpdate: (self) => {
              const idx = Math.min(
                SCENES.length - 1,
                Math.round(self.progress * (SCENES.length - 1)),
              );
              setActiveScene(idx);
            },
          },
        });

        // Escena 1: giro suave de la botella 1L
        tl.to(bottleGroupRef.current, { rotate: -8, transformOrigin: "50% 90%", duration: 1 })
          .to(bottleGroupRef.current, { rotate: 8, duration: 1 })
          .to(bottleGroupRef.current, { rotate: 0, duration: 1 });

        // Escena 2: apertura de tapa + dosificación
        tl.to(capGroupRef.current, { y: -26, rotate: -35, duration: 1 }, "dose")
          .fromTo(
            doseFillRef.current,
            { attr: { height: 0, y: 214 } },
            { attr: { height: 18, y: 196 }, duration: 1.2 },
            "dose+=0.3",
          );

        // Escena 3: transferencia al squishable
        tl.to(bottleGroupRef.current, { opacity: 0, x: -60, duration: 1 }, "transfer")
          .fromTo(
            squishableRef.current,
            { opacity: 0, x: 40, scale: 0.9 },
            { opacity: 1, x: 0, scale: 1, duration: 1 },
            "transfer",
          )
          .fromTo(
            squishableFillRef.current,
            { attr: { height: 0, y: 300 } },
            { attr: { height: 40, y: 260 }, duration: 1 },
            "transfer+=0.4",
          );

        // Escena 4: dilución con agua + activación
        tl.fromTo(
          waterStreamRef.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.4 },
          "dilute",
        )
          .to(
            squishableFillRef.current,
            { attr: { height: 140, y: 160 }, duration: 1.4, ease: "power1.inOut" },
            "dilute+=0.2",
          )
          .to(waterStreamRef.current, { opacity: 0, duration: 0.4 }, "dilute+=1.4")
          .to(squishableRef.current, { x: 0, y: -6, duration: 0.4, yoyo: true, repeat: 1 }, "dilute+=1.6");

        // Escena 5: salida a la calle
        tl.fromTo(
          characterRef.current,
          { x: -220, opacity: 0 },
          { x: 0, opacity: 1, duration: 1.4, ease: "power2.out" },
          "walk",
        )
          .to(buildingsWaveRef.current, { opacity: 0.9, duration: 1.2 }, "walk");

        // Escena 6: micción y aplicación con onda verde
        tl.to(dogRef.current, { x: 30, duration: 0.6 }, "apply")
          .fromTo(
            waveBurstRef.current,
            { opacity: 0, scale: 0.2 },
            { opacity: 1, scale: 1, duration: 1, ease: "power2.out" },
            "apply+=0.3",
          )
          .to(waveBurstRef.current, { opacity: 0, scale: 1.6, duration: 0.8 }, "apply+=1.3");
      }, sectionRef);
    })();

    return () => ctx?.revert();
  }, []);

  return (
    <section
      id="modo-de-uso"
      ref={sectionRef}
      className="relative h-screen w-full overflow-hidden bg-hueso"
      aria-label="Modo de uso de STOPee, narrado con scroll"
    >
      <div className="mx-auto flex h-full max-w-6xl flex-col-reverse items-center gap-6 px-4 py-10 sm:px-6 md:flex-row md:gap-12">
        {/* Panel de texto */}
        <div className="w-full md:w-2/5">
          <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
            {SCENES[activeScene].eyebrow}
          </p>
          <h2 className="mt-2 font-display text-3xl font-black text-carbon sm:text-4xl">
            {SCENES[activeScene].title}
          </h2>
          <p className="mt-4 max-w-md font-body text-base text-carbon/70 sm:text-lg">
            {SCENES[activeScene].copy}
          </p>

          {/* Indicador de progreso (Zeigarnik: avance visible) */}
          <div className="mt-8 flex gap-2" role="progressbar" aria-valuenow={activeScene + 1} aria-valuemin={1} aria-valuemax={SCENES.length}>
            {SCENES.map((scene, i) => (
              <span
                key={scene.id}
                className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                  i <= activeScene ? "bg-lima" : "bg-carbon/10"
                }`}
              />
            ))}
          </div>
          <p className="mt-2 text-xs font-semibold text-carbon/40">
            {activeScene + 1} / {SCENES.length} — sigue haciendo scroll
          </p>
        </div>

        {/* Escenario SVG */}
        <div className="relative aspect-square w-full max-w-md md:w-3/5">
          <svg viewBox="0 0 500 500" className="h-full w-full" aria-hidden="true">
            {/* Skyline de fondo, envuelto en ondas al llegar la escena 5 */}
            <g ref={buildingsWaveRef} opacity="0.5">
              <rect x="20" y="260" width="60" height="180" rx="6" fill="#3E531D" opacity="0.15" />
              <rect x="95" y="220" width="50" height="220" rx="6" fill="#7A9330" opacity="0.15" />
              <rect x="380" y="240" width="55" height="200" rx="6" fill="#3E531D" opacity="0.15" />
              <rect x="440" y="200" width="45" height="240" rx="6" fill="#7A9330" opacity="0.15" />
              <path
                d="M0 440C120 400 180 460 280 420C380 380 420 440 500 420V500H0V440Z"
                fill="#B5D334"
                opacity="0.25"
              />
            </g>

            {/* Botella 1L */}
            <g ref={bottleGroupRef}>
              <rect x="205" y="190" width="90" height="180" rx="14" fill="#181C14" />
              <rect x="205" y="190" width="90" height="180" rx="14" fill="#3E531D" opacity="0.5" />
              <rect x="222" y="150" width="56" height="46" rx="8" fill="#181C14" />
              <text
                x="250"
                y="290"
                textAnchor="middle"
                fontSize="22"
                fontWeight="900"
                fill="#B5D334"
                fontFamily="Outfit, sans-serif"
              >
                STOPee
              </text>
              <text
                x="250"
                y="312"
                textAnchor="middle"
                fontSize="11"
                fill="#FDFBF7"
                fontFamily="Plus Jakarta Sans, sans-serif"
              >
                1L Concentrado
              </text>
            </g>

            {/* Tapa dosificadora */}
            <g ref={capGroupRef}>
              <rect x="228" y="196" width="44" height="26" rx="4" fill="#B5D334" />
              <rect ref={doseFillRef} x="230" y="214" width="40" height="0" rx="2" fill="#7A9330" />
            </g>

            {/* Botella Squishable */}
            <g ref={squishableRef} opacity="0">
              <path
                d="M215 190c0-14 12-24 30-24h10c18 0 30 10 30 24v140c0 22-16 40-35 40s-35-18-35-40V190z"
                fill="#181C14"
              />
              <rect ref={squishableFillRef} x="222" y="300" width="56" height="0" rx="10" fill="#B5D334" opacity="0.85" />
              <circle cx="250" cy="176" r="8" fill="#7A9330" />
              <text
                x="250"
                y="270"
                textAnchor="middle"
                fontSize="14"
                fontWeight="800"
                fill="#FDFBF7"
                fontFamily="Outfit, sans-serif"
              >
                STOPee
              </text>
            </g>

            {/* Chorro de agua */}
            <g ref={waterStreamRef} opacity="0">
              <rect x="246" y="130" width="8" height="60" rx="4" fill="#8FD3F4" opacity="0.7" />
            </g>

            {/* Personaje ilustrado paseando */}
            <g ref={characterRef} opacity="0">
              <g transform="translate(70,260)">
                {/* piernas y tenis grandes */}
                <rect x="10" y="60" width="16" height="50" rx="6" fill="#181C14" />
                <rect x="40" y="60" width="16" height="50" rx="6" fill="#181C14" />
                <ellipse cx="14" cy="118" rx="24" ry="12" fill="#F26A36" />
                <ellipse cx="52" cy="118" rx="24" ry="12" fill="#3273EC" />
                {/* torso */}
                <rect x="4" y="10" width="58" height="56" rx="18" fill="#7A9330" />
                {/* cabeza */}
                <circle cx="33" cy="-8" r="20" fill="#FDFBF7" stroke="#181C14" strokeWidth="3" />
                {/* squishable en mano */}
                <rect x="60" y="30" width="16" height="26" rx="6" fill="#B5D334" />
              </g>

              {/* perro con correa */}
              <g ref={dogRef} transform="translate(160,330)">
                <ellipse cx="20" cy="20" rx="30" ry="16" fill="#F26A36" />
                <circle cx="46" cy="10" r="12" fill="#F26A36" />
                <rect x="-10" y="20" width="6" height="18" rx="3" fill="#181C14" />
                <rect x="40" y="20" width="6" height="18" rx="3" fill="#181C14" />
                <line x1="46" y1="10" x2="76" y2="-30" stroke="#181C14" strokeWidth="3" strokeLinecap="round" />
              </g>

              {/* Onda verde de aplicación */}
              <g ref={waveBurstRef} opacity="0" transform="translate(215,340)">
                <circle r="60" fill="#B5D334" opacity="0.35" />
                <circle r="38" fill="#7A9330" opacity="0.5" />
                <circle r="18" fill="#3E531D" opacity="0.6" />
              </g>
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}
