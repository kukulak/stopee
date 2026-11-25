import { useEffect, useId, useRef, useState } from "react";
import { Link, useFetcher, useLocation } from "react-router";
import { OPEN_COOKIE_SETTINGS_EVENT, revokesConsent, type ConsentChoice, type ConsentChoices } from "~/lib/consent";
import { TAG_LOADERS, clearThirdPartyCookies } from "~/lib/consentTags";
import { INTEGRATIONS, integrationsIn, joinNames, type PixelIds } from "~/lib/integrations";

type PublicConsent = ConsentChoices & { decidedAt: string };

/** Botón que abre el panel de cookies desde cualquier página (pie de página, política de cookies). */
export function CookieSettingsButton({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT))}
    >
      {children ?? "Configurar cookies"}
    </button>
  );
}

function Switch({ checked, onChange, labelledBy }: { checked: boolean; onChange: (value: boolean) => void; labelledBy: string }) {
  return (
    <label className="relative inline-flex h-11 w-14 shrink-0 cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-labelledby={labelledBy}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="h-7 w-12 rounded-full bg-carbon/25 transition-colors peer-checked:bg-bosque peer-focus-visible:ring-2 peer-focus-visible:ring-bosque peer-focus-visible:ring-offset-2"
      />
      <span
        aria-hidden="true"
        className="absolute left-[0.45rem] h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
      />
    </label>
  );
}

const BUTTON = "min-h-11 rounded-full px-6 py-2.5 text-sm font-bold transition-colors";
const REJECT_BUTTON = `${BUTTON} bg-carbon text-hueso hover:bg-carbon/85`;
const ACCEPT_BUTTON = `${BUTTON} bg-lima text-carbon hover:bg-lima/80`;
const CONFIGURE_BUTTON = `${BUTTON} border-2 border-carbon/20 text-carbon hover:border-carbon/40`;

/**
 * Aviso de cookies. Se muestra mientras la persona no haya elegido; con los tres botones del mismo
 * tamaño (rechazar no cuesta más esfuerzo que aceptar) y sin bloquear el sitio. Nada de estadísticas
 * ni de publicidad se carga hasta que se acepta. «Configurar cookies» (en el pie) vuelve a abrir el
 * panel para cambiar la elección cuando se quiera.
 *
 * El servidor decide si hay elección (viene de la cookie) y por eso el HTML coincide con lo que el
 * navegador pinta: el aviso no parpadea ni aparece tarde.
 */
export function CookieConsent({
  consent,
  pixelIds,
}: {
  consent: PublicConsent | null;
  pixelIds: PixelIds;
}) {
  const { pathname } = useLocation();
  const inAdmin = pathname.startsWith("/admin");
  const fetcher = useFetcher<{ ok: boolean }>();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const consentRef = useRef(consent);
  const revokedRef = useRef(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [analytics, setAnalytics] = useState(consent?.analytics ?? false);
  const [marketing, setMarketing] = useState(consent?.marketing ?? false);
  const [notice, setNotice] = useState("");
  const ids = useId();
  const titleId = `${ids}-title`;
  const analyticsId = `${ids}-analytics`;
  const marketingId = `${ids}-marketing`;

  consentRef.current = consent;

  // Cada herramienta se enciende solo si tiene ID y la persona aceptó su categoría.
  const idsKey = JSON.stringify(pixelIds);
  useEffect(() => {
    if (inAdmin || !consent) return;
    for (const integration of INTEGRATIONS) {
      const pixelId = pixelIds[integration.id];
      if (pixelId && consent[integration.category]) {
        TAG_LOADERS[integration.id](pixelId, { marketing: consent.marketing });
      }
    }
    // pixelIds se compara por su contenido (idsKey): el objeto es nuevo en cada carga de datos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inAdmin, consent?.analytics, consent?.marketing, idsKey]);

  // Abrir el panel desde el pie de página, con las casillas como estén guardadas.
  useEffect(() => {
    const open = () => {
      setAnalytics(consentRef.current?.analytics ?? false);
      setMarketing(consentRef.current?.marketing ?? false);
      setPanelOpen(true);
    };
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, open);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (panelOpen && !dialog.open) dialog.showModal();
    if (!panelOpen && dialog.open) dialog.close();
  }, [panelOpen]);

  // Resultado de guardar: avisar en voz alta (lectores de pantalla) o, si se retiró un permiso,
  // borrar lo que Google y Meta dejaron y recargar para que sus códigos dejen de ejecutarse.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (!fetcher.data.ok) {
      setNotice("No pudimos guardar tu elección. Inténtalo de nuevo.");
      return;
    }
    if (revokedRef.current) {
      revokedRef.current = false;
      clearThirdPartyCookies();
      window.location.reload();
      return;
    }
    setNotice("Listo: guardamos tus preferencias de cookies.");
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [fetcher.state, fetcher.data]);

  if (inAdmin) return null;

  function save(choice: ConsentChoice) {
    const next: ConsentChoices =
      choice === "all" ? { analytics: true, marketing: true } : choice === "none" ? { analytics: false, marketing: false } : { analytics, marketing };
    revokedRef.current = revokesConsent(consent, next);
    setNotice("");
    setPanelOpen(false);
    fetcher.submit(
      { choice, analytics: String(next.analytics), marketing: String(next.marketing), path: pathname },
      { method: "post", action: "/api/consent" },
    );
  }

  function openPanel() {
    setAnalytics(consent?.analytics ?? false);
    setMarketing(consent?.marketing ?? false);
    setPanelOpen(true);
  }

  const showBanner = consent === null && fetcher.state === "idle";

  return (
    <>
      {showBanner && (
        <section aria-label="Aviso de cookies" className="fixed inset-x-0 bottom-0 z-[70] p-3 sm:p-4">
          <div className="mx-auto max-w-4xl rounded-3xl border border-carbon/10 bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:gap-8">
              <div className="flex-1">
                <p className="font-display text-lg font-black text-carbon">Tú decides sobre las cookies</p>
                <p className="mt-1 text-sm text-carbon/75">
                  Usamos las cookies necesarias para que el sitio funcione. Con tu permiso, también usamos cookies de
                  estadísticas y de marketing para mejorar el sitio y medir nuestros anuncios.{" "}
                  <Link to="/politica-de-cookies" className="font-semibold underline hover:text-carbon">
                    Política de cookies
                  </Link>
                  {" · "}
                  <Link to="/aviso-de-privacidad" className="font-semibold underline hover:text-carbon">
                    Aviso de privacidad
                  </Link>
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row md:shrink-0">
                <button type="button" onClick={() => save("none")} className={REJECT_BUTTON}>
                  Rechazar
                </button>
                <button type="button" onClick={openPanel} className={CONFIGURE_BUTTON}>
                  Configurar
                </button>
                <button type="button" onClick={() => save("all")} className={ACCEPT_BUTTON}>
                  Aceptar todas
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setPanelOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setPanelOpen(false);
        }}
        className="m-auto max-h-[90dvh] w-[min(100%-1.5rem,36rem)] overflow-y-auto overscroll-contain rounded-3xl bg-white p-0 text-carbon shadow-2xl backdrop:bg-carbon/60"
      >
        <div className="p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="font-display text-2xl font-black text-carbon">
              Configurar cookies
            </h2>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="-mr-2 -mt-1 min-h-11 rounded-full px-4 text-sm font-semibold text-carbon/70 hover:text-carbon"
            >
              Cerrar
            </button>
          </div>
          <p className="mt-2 text-sm text-carbon/70">
            Elige qué cookies permites. Puedes cambiar esto cuando quieras desde «Configurar cookies», al final de
            cualquier página. Más detalle en la{" "}
            <Link to="/politica-de-cookies" onClick={() => setPanelOpen(false)} className="font-semibold underline hover:text-carbon">
              política de cookies
            </Link>
            .
          </p>

          <div className="mt-5 flex flex-col gap-3">
            <div className="rounded-2xl border border-carbon/10 p-4">
              <div className="flex items-start justify-between gap-4">
                <h3 className="font-display text-base font-bold">Necesarias</h3>
                <span className="shrink-0 rounded-full bg-bosque/10 px-3 py-1 text-xs font-bold text-bosque">
                  Siempre activas
                </span>
              </div>
              <p className="mt-1 text-sm text-carbon/70">
                Mantienen tu sesión y tu carrito, protegen el sitio y recuerdan esta elección. Sin ellas el sitio no
                funciona.
              </p>
            </div>

            <div className="rounded-2xl border border-carbon/10 p-4">
              <div className="flex items-start justify-between gap-4">
                <h3 id={analyticsId} className="font-display text-base font-bold">
                  Estadísticas
                </h3>
                <Switch checked={analytics} onChange={setAnalytics} labelledBy={analyticsId} />
              </div>
              <p className="-mt-2 text-sm text-carbon/70">
                Nos dicen qué páginas se visitan y cómo llegas a nosotros, sin identificarte. Usamos{" "}
                {joinNames([...integrationsIn("analytics", pixelIds).map((tool) => tool.name), "una medición propia del sitio"])}.
              </p>
            </div>

            <div className="rounded-2xl border border-carbon/10 p-4">
              <div className="flex items-start justify-between gap-4">
                <h3 id={marketingId} className="font-display text-base font-bold">
                  Marketing
                </h3>
                <Switch checked={marketing} onChange={setMarketing} labelledBy={marketingId} />
              </div>
              <p className="-mt-2 text-sm text-carbon/70">
                Permiten medir si nuestros anuncios funcionan.
                {integrationsIn("marketing", pixelIds).length > 0 &&
                  ` Usamos ${joinNames(integrationsIn("marketing", pixelIds).map((tool) => tool.name))}.`}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <button type="button" onClick={() => save("custom")} className={`${ACCEPT_BUTTON} w-full`}>
              Guardar mi elección
            </button>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => save("none")} className={`${CONFIGURE_BUTTON} flex-1`}>
                Rechazar todas
              </button>
              <button type="button" onClick={() => save("all")} className={`${CONFIGURE_BUTTON} flex-1`}>
                Aceptar todas
              </button>
            </div>
          </div>
        </div>
      </dialog>

      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4">
        {notice && (
          <p className="rounded-full bg-carbon px-5 py-3 text-sm font-semibold text-hueso shadow-xl">{notice}</p>
        )}
      </div>
    </>
  );
}
