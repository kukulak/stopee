import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { AUDIENCES, type AudienceKey } from "~/lib/campaignAudiences";

type Summary = { count: number; excluded: number };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * «Lista para campañas»: elige una lista de personas y baja el CSV. Solo salen quienes aceptaron recibir
 * promociones; antes de bajar se ve cuántas son y cuántas se dejaron fuera por no haber aceptado.
 */
export function CampaignExportButton({ className }: { className: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<AudienceKey>("compraron");
  const fetcher = useFetcher<Summary & { error?: string }>();

  const { load } = fetcher;
  useEffect(() => {
    if (open) load(`/admin/exports/campaigns?resumen=1&lista=${audience}`);
  }, [open, audience, load]);

  const show = () => {
    setOpen(true);
    dialogRef.current?.showModal();
  };
  const hide = () => {
    setOpen(false);
    dialogRef.current?.close();
  };

  const summary = fetcher.data && !fetcher.data.error ? fetcher.data : null;
  const loading = fetcher.state !== "idle" || !summary;
  const empty = summary !== null && summary.count === 0;
  const current = AUDIENCES.find((a) => a.key === audience)!;

  return (
    <>
      <button type="button" onClick={show} className={className}>
        Lista para campañas
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) hide();
        }}
        aria-labelledby="campaign-export-title"
        className="m-auto w-[min(32rem,calc(100vw-2rem))] max-w-full rounded-2xl bg-hueso p-0 text-carbon backdrop:bg-carbon/50"
      >
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div>
            <h2 id="campaign-export-title" className="font-display text-xl font-black text-carbon">
              Lista para campañas
            </h2>
            <p className="mt-1 text-sm text-carbon/60">
              Solo salen las personas que aceptaron recibir promociones por correo.
            </p>
          </div>

          <div>
            <label htmlFor="campaign-audience" className="mb-1 block text-sm font-semibold text-carbon">
              Lista
            </label>
            <select
              id="campaign-audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value as AudienceKey)}
              className="min-h-11 w-full rounded-xl border border-carbon/15 bg-white px-3 text-base text-carbon focus:border-oliva focus:outline-none sm:text-sm"
            >
              {AUDIENCES.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-carbon/60">{current.hint}</p>
          </div>

          <div role="status" aria-live="polite" className="rounded-2xl border border-carbon/10 bg-white p-4 text-sm">
            {loading ? (
              <p className="text-carbon/60">Contando…</p>
            ) : empty ? (
              <div>
                <p className="font-semibold text-carbon">Nadie en esta lista ha aceptado recibir correos todavía.</p>
                {summary.excluded > 0 && (
                  <p className="mt-1 text-xs text-carbon/60">
                    {plural(summary.excluded, "persona queda", "personas quedan")} fuera por no haber aceptado.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <p className="text-carbon">
                  <strong className="text-lg">{plural(summary.count, "persona", "personas")}</strong> en el archivo
                </p>
                {summary.excluded > 0 && (
                  <p className="mt-1 text-xs text-carbon/60">
                    {plural(summary.excluded, "persona más no aceptó", "personas más no aceptaron")} recibir correos y no se
                    {summary.excluded === 1 ? " incluye" : " incluyen"}.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={hide} className="min-h-11 rounded-full px-4 text-sm font-semibold text-carbon/70 hover:text-carbon">
              Cancelar
            </button>
            {!loading && !empty ? (
              <a
                href={`/admin/exports/campaigns?lista=${audience}`}
                onClick={() => setTimeout(hide, 300)}
                className="flex min-h-11 items-center rounded-full bg-carbon px-6 text-sm font-bold text-hueso hover:bg-carbon/90"
              >
                Descargar CSV
              </a>
            ) : (
              <span aria-disabled="true" className="flex min-h-11 items-center rounded-full bg-carbon/30 px-6 text-sm font-bold text-hueso">
                Descargar CSV
              </span>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
