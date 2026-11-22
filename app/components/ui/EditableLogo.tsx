import { lazy, Suspense, useEffect, useState } from "react";
import { Logo } from "./Logo";
import { ClientOnly } from "~/components/ui/ClientOnly";

const LogoSizeEditor = lazy(() => import("./LogoSizeEditor").then((m) => ({ default: m.LogoSizeEditor })));

function draftStorageKey(id: string) {
  return `stopee:logo-draft:${id}`;
}

function loadDraft(id: string): number | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(id));
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // borrador corrupto o localStorage no disponible — se ignora
    return null;
  }
}

/**
 * Igual que <Logo>, pero en desarrollo agrega ?editar=1 a la URL para
 * ajustar su altura en vivo desde una carpeta "Logo" en el mismo panel
 * de EditableBrandSwirls (comparten el panel <Leva> global — esta pieza
 * no monta uno propio, así que la página también debe tener al menos un
 * <EditableBrandSwirls> para que el panel aparezca).
 *
 * `id` debe ser único por lugar donde se usa — se usa para guardar el
 * borrador en localStorage, igual que en EditableBrandSwirls.
 */
export function EditableLogo({
  className,
  heightPx: initialHeightPx,
  id,
}: {
  className?: string;
  heightPx: number;
  id: string;
}) {
  const [heightPx, setHeightPx] = useState(initialHeightPx);

  useEffect(() => {
    const draft = loadDraft(id);
    if (draft != null) setHeightPx(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function handleChange(next: number) {
    setHeightPx(next);
    try {
      window.localStorage.setItem(draftStorageKey(id), String(next));
    } catch {
      // localStorage lleno o bloqueado — el ajuste sigue funcionando en memoria
    }
  }

  return (
    <>
      <Logo className={className} style={{ height: `${heightPx}px`, width: "auto" }} />
      {import.meta.env.DEV && (
        <ClientOnly>
          {() => {
            if (!new URLSearchParams(window.location.search).has("editar")) return null;
            return (
              <Suspense fallback={null}>
                <LogoSizeEditor heightPx={heightPx} onChange={handleChange} />
              </Suspense>
            );
          }}
        </ClientOnly>
      )}
    </>
  );
}
