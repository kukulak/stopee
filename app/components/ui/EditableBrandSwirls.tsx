import { lazy, Suspense, useEffect, useState } from "react";
import { BrandSwirls, type SwirlPlacement } from "./BrandSwirls";
import { ClientOnly } from "~/components/ui/ClientOnly";

const Leva = lazy(() => import("leva").then((m) => ({ default: m.Leva })));
const BrandSwirlsEditor = lazy(() => import("./BrandSwirlsEditor").then((m) => ({ default: m.BrandSwirlsEditor })));

function draftStorageKey(id: string) {
  return `stopee:swirls-draft:${id}`;
}

function loadDraft(id: string, expectedLength: number): SwirlPlacement[] | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === expectedLength) return parsed;
  } catch {
    // borrador corrupto o localStorage no disponible — se ignora
  }
  return null;
}

/**
 * Igual que BrandSwirls, pero en desarrollo agrega ?editar=1 a la URL para
 * mostrar un panel de sliders (top/bottom, left/right, escala, rotación,
 * opacidad) y acomodar cada remolino en vivo, con un botón para copiar el
 * arreglo final listo para pegar en el código. El panel y `leva` nunca se
 * incluyen en el build de producción (import.meta.env.DEV se resuelve en
 * build time, así que el import() de abajo nunca se ejecuta fuera de dev).
 *
 * `id` debe ser único por lugar donde se usa (una página puede tener varias
 * secciones con remolinos) — se usa para guardar el borrador en
 * localStorage, así los ajustes sobreviven a un F5 o a un hot-reload de
 * Vite mientras sigues editando, en vez de perderse silenciosamente.
 */
export function EditableBrandSwirls({
  swirls: initialSwirls,
  className,
  id,
}: {
  swirls: SwirlPlacement[];
  className?: string;
  id: string;
}) {
  const [swirls, setSwirls] = useState(initialSwirls);
  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    const draft = loadDraft(id, initialSwirls.length);
    if (draft) {
      setSwirls(draft);
      setHasDraft(true);
    }
    // Solo al montar: initialSwirls es una constante del módulo que llama a
    // este componente, no cambia entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function handleSwirlChange(index: number, next: SwirlPlacement) {
    // Actualización funcional: cada carpeta del panel dispara su propio
    // efecto de forma independiente, así que si mueves varios sliders casi
    // al mismo tiempo, sus llamadas pueden intercalarse antes de que React
    // vuelva a renderizar. Partir siempre del `prev` real (no de un
    // `swirls` cerrado en un closure viejo) evita que una actualización
    // pise a otra y se pierdan ajustes.
    setSwirls((prev) => {
      const copy = [...prev];
      copy[index] = next;
      try {
        window.localStorage.setItem(draftStorageKey(id), JSON.stringify(copy));
      } catch {
        // localStorage lleno o bloqueado — el ajuste sigue funcionando en memoria
      }
      return copy;
    });
    setHasDraft(true);
  }

  function handleReset() {
    try {
      window.localStorage.removeItem(draftStorageKey(id));
    } catch {
      // ignorar
    }
    setSwirls(initialSwirls);
    setHasDraft(false);
  }

  return (
    <>
      <BrandSwirls swirls={swirls} className={className} />
      {import.meta.env.DEV && (
        <ClientOnly>
          {() => {
            if (!new URLSearchParams(window.location.search).has("editar")) return null;
            return (
              <Suspense fallback={null}>
                <Leva
                  titleBar={{
                    title: hasDraft ? "Remolinos de marca (borrador sin exportar)" : "Remolinos de marca",
                  }}
                />
                <BrandSwirlsEditor swirls={swirls} onChange={handleSwirlChange} onReset={handleReset} />
              </Suspense>
            );
          }}
        </ClientOnly>
      )}
    </>
  );
}
