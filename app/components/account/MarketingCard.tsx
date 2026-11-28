import { useFetcher } from "react-router";

type MarketingResult = { ok: boolean; error: string | null; savedIntent: string | null };

/**
 * «Promociones y novedades por correo»: un interruptor en el mismo tablero, sin sección aparte (es solo sí o no).
 * Cambia al instante y se guarda al tocarlo; si algo falla, vuelve a su lugar y lo dice.
 */
export function MarketingCard({ subscribed }: { subscribed: boolean }) {
  const fetcher = useFetcher<MarketingResult>();
  const busy = fetcher.state !== "idle";
  // Lo que se acaba de pedir se ve al instante, sin esperar a que la página se vuelva a cargar.
  const pending = fetcher.formData ? fetcher.formData.get("marketing") === "on" : null;
  const on = pending ?? subscribed;
  const saved = fetcher.data?.ok && fetcher.data.savedIntent === "marketing-update" && !busy;
  const failed = fetcher.data && !fetcher.data.ok && !busy ? (fetcher.data.error ?? "No pudimos guardarlo. Intenta de nuevo.") : null;

  return (
    <fetcher.Form method="post" action="/cuenta" className="mt-8 rounded-2xl border border-carbon/10 bg-white p-4">
      <input type="hidden" name="intent" value="marketing-update" />
      <input type="hidden" name="marketing" value={on ? "off" : "on"} />
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p id="marketing-label" className="font-display font-bold text-carbon">
            Promociones y novedades por correo
          </p>
          <p id="marketing-hint" aria-live="polite" className="mt-0.5 text-sm text-carbon/60">
            {saved ? (on ? "Listo: recibirás promociones y novedades." : "Listo: ya no recibirás promociones.") : "Los avisos de tus pedidos te llegan siempre."}
          </p>
        </div>
        <button
          type="submit"
          role="switch"
          aria-checked={on}
          aria-labelledby="marketing-label"
          aria-describedby="marketing-hint"
          disabled={busy}
          className="group flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oliva"
        >
          <span className={`relative block h-7 w-12 rounded-full transition-colors motion-reduce:transition-none ${on ? "bg-bosque" : "bg-carbon/25"}`}>
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all motion-reduce:transition-none ${on ? "left-[1.375rem]" : "left-0.5"}`}
            />
          </span>
          <span className="sr-only">{on ? "Activado" : "Desactivado"}</span>
        </button>
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-600">
          {failed}
        </p>
      )}
    </fetcher.Form>
  );
}
