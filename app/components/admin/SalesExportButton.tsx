import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import {
  DEFAULT_SALES_EXPORT,
  isDay,
  lastMonthRange,
  mexicoToday,
  salesExportQuery,
  thisMonthRange,
  type SalesExportOptions,
} from "~/lib/salesExport";

type Summary = { count: number; validCount: number; revenue: number; cancelled: number; refunded: number };

const money = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const fieldClass =
  "min-h-11 w-full rounded-xl border border-carbon/15 bg-white px-3 text-base text-carbon focus:border-oliva focus:outline-none sm:text-sm";
const chipClass = "min-h-11 rounded-full px-3 text-sm font-semibold text-bosque underline hover:text-carbon";

/**
 * «Exportar ventas»: el botón y la ventana con el periodo y lo que se quiere incluir. Antes de descargar muestra
 * cuántos pedidos y cuánto dinero salen, así que sirve también para saber «cuánto vendimos» sin bajar nada.
 */
export function SalesExportButton({ className }: { className: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<SalesExportOptions>(() => ({
    ...thisMonthRange(mexicoToday()),
    ...DEFAULT_SALES_EXPORT,
  }));
  const fetcher = useFetcher<Summary & { error?: string }>();

  const datesValid = (!options.from || isDay(options.from)) && (!options.to || isDay(options.to));
  const orderedOk = !options.from || !options.to || options.from <= options.to;
  const query = salesExportQuery(options);

  // La ventana mide el tamaño del archivo cada vez que cambia un filtro.
  const { load } = fetcher;
  useEffect(() => {
    if (open && datesValid && orderedOk) load(`/admin/exports/sales?resumen=1&${query}`);
  }, [open, datesValid, orderedOk, query, load]);

  function show() {
    // Cada vez que se abre, vuelve a lo más común: este mes.
    setOptions({ ...thisMonthRange(mexicoToday()), ...DEFAULT_SALES_EXPORT });
    setOpen(true);
    dialogRef.current?.showModal();
  }
  function hide() {
    setOpen(false);
    dialogRef.current?.close();
  }
  const set = (patch: Partial<SalesExportOptions>) => setOptions((o) => ({ ...o, ...patch }));

  const summary = fetcher.data && !fetcher.data.error ? fetcher.data : null;
  const loading = fetcher.state !== "idle" || (!summary && datesValid && orderedOk);
  const empty = summary !== null && summary.count === 0;
  const excluded = summary ? summary.cancelled + summary.refunded : 0;

  return (
    <>
      <button type="button" onClick={show} className={className}>
        Exportar ventas
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) hide();
        }}
        aria-labelledby="sales-export-title"
        className="m-auto w-[min(34rem,calc(100vw-2rem))] max-w-full rounded-2xl bg-hueso p-0 text-carbon backdrop:bg-carbon/50"
      >
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div>
            <h2 id="sales-export-title" className="font-display text-xl font-black text-carbon">
              Exportar ventas
            </h2>
            <p className="mt-1 text-sm text-carbon/60">Elige el periodo y baja solo lo que necesitas.</p>
          </div>

          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-bold text-carbon">Periodo</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="export-from" className="mb-1 block text-sm font-semibold text-carbon">
                  Desde
                </label>
                <input
                  id="export-from"
                  type="date"
                  value={options.from}
                  max={options.to || undefined}
                  onChange={(e) => set({ from: e.target.value })}
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor="export-to" className="mb-1 block text-sm font-semibold text-carbon">
                  Hasta
                </label>
                <input
                  id="export-to"
                  type="date"
                  value={options.to}
                  min={options.from || undefined}
                  onChange={(e) => set({ to: e.target.value })}
                  className={fieldClass}
                />
              </div>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3">
              <button type="button" onClick={() => set(thisMonthRange(mexicoToday()))} className={chipClass}>
                Este mes
              </button>
              <button type="button" onClick={() => set(lastMonthRange(mexicoToday()))} className={chipClass}>
                Mes pasado
              </button>
            </div>
            {!orderedOk && (
              <p role="alert" className="mt-1 text-sm font-semibold text-red-600">
                La fecha de inicio es posterior a la final. Cámbiala para continuar.
              </p>
            )}
          </fieldset>

          <fieldset className="grid min-w-0 grid-cols-1 gap-3">
            <legend className="mb-2 text-sm font-bold text-carbon">Qué incluir</legend>
            <div>
              <label htmlFor="export-estado" className="mb-1 block text-sm font-semibold text-carbon">
                Ventas
              </label>
              <select
                id="export-estado"
                value={options.estado}
                onChange={(e) => set({ estado: e.target.value as SalesExportOptions["estado"] })}
                className={fieldClass}
              >
                <option value="validas">Válidas (sin canceladas ni reembolsadas)</option>
                <option value="todas">Todas, con canceladas y reembolsadas (para análisis)</option>
              </select>
            </div>
            <div>
              <label htmlFor="export-facturacion" className="mb-1 block text-sm font-semibold text-carbon">
                Factura
              </label>
              <select
                id="export-facturacion"
                value={options.facturacion}
                onChange={(e) => set({ facturacion: e.target.value as SalesExportOptions["facturacion"] })}
                className={fieldClass}
              >
                <option value="todas">Todas</option>
                <option value="sin">Solo las que no pidieron factura (para la factura global)</option>
                <option value="con">Solo las que sí pidieron factura</option>
              </select>
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-carbon">
              <input
                type="checkbox"
                checked={options.manuales}
                onChange={(e) => set({ manuales: e.target.checked })}
                className="h-5 w-5 shrink-0 accent-carbon"
              />
              Incluir las ventas que registramos a mano (efectivo, vecinos…)
            </label>
          </fieldset>

          <div role="status" aria-live="polite" className="rounded-2xl border border-carbon/10 bg-white p-4 text-sm">
            {!datesValid || !orderedOk ? (
              <p className="text-carbon/60">Corrige las fechas para ver cuántas ventas salen.</p>
            ) : loading && !summary ? (
              <p className="text-carbon/60">Contando…</p>
            ) : empty ? (
              <p className="font-semibold text-carbon">No hay ventas con estos filtros. Prueba con otro periodo.</p>
            ) : summary ? (
              <div className={loading ? "opacity-60" : ""}>
                <p className="text-carbon">
                  <strong className="text-lg">{plural(summary.count, "pedido", "pedidos")}</strong> en el archivo
                </p>
                <p className="mt-1 text-carbon/70">
                  Vendido en pedidos válidos: <strong className="text-carbon">{money(summary.revenue)}</strong>
                </p>
                {excluded > 0 && (
                  <p className="mt-1 text-xs text-carbon/60">
                    {options.estado === "validas" ? "No incluye " : "Incluye "}
                    {[summary.cancelled > 0 ? plural(summary.cancelled, "cancelado", "cancelados") : "", summary.refunded > 0 ? plural(summary.refunded, "reembolsado", "reembolsados") : ""]
                      .filter(Boolean)
                      .join(" y ")}
                    .
                  </p>
                )}
              </div>
            ) : (
              <p className="text-carbon/60">No pudimos contar las ventas. Aun así puedes descargar el archivo.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={hide}
              className="min-h-11 rounded-full px-4 text-sm font-semibold text-carbon/70 hover:text-carbon"
            >
              Cancelar
            </button>
            {datesValid && orderedOk && !empty ? (
              <a
                href={`/admin/exports/sales?${query}`}
                onClick={() => setTimeout(hide, 300)}
                className="flex min-h-11 items-center rounded-full bg-carbon px-6 text-sm font-bold text-hueso hover:bg-carbon/90"
              >
                Descargar CSV
              </a>
            ) : (
              <span
                aria-disabled="true"
                className="flex min-h-11 items-center rounded-full bg-carbon/30 px-6 text-sm font-bold text-hueso"
              >
                Descargar CSV
              </span>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
