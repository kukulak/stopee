import { useFetcher } from "react-router";

type MarketingResult = { ok: boolean; error: string | null; savedIntent: string | null };

/** «Correos de STOPee»: si la persona recibe promociones y novedades, y un botón para cambiarlo en un clic. */
export function MarketingCard({ subscribed }: { subscribed: boolean }) {
  const fetcher = useFetcher<MarketingResult>();
  const busy = fetcher.state !== "idle";
  // Lo que se acaba de pedir se ve al instante, sin esperar a que la página se vuelva a cargar.
  const pending = fetcher.formData ? fetcher.formData.get("marketing") === "on" : null;
  const on = pending ?? subscribed;
  const saved = fetcher.data?.ok && fetcher.data.savedIntent === "marketing-update" && !busy;

  return (
    <div className="mt-8 rounded-3xl border border-carbon/10 bg-white p-6">
      <h2 className="font-display text-xl font-black text-carbon">Correos de STOPee</h2>
      <p className="mt-2 text-sm text-carbon/70">
        {on
          ? "Recibes promociones y novedades por correo. Los avisos de tus pedidos te llegan siempre."
          : "No recibes promociones ni novedades. Los avisos de tus pedidos te llegan siempre."}
      </p>
      <fetcher.Form method="post" className="mt-4 flex flex-wrap items-center gap-3">
        <input type="hidden" name="intent" value="marketing-update" />
        <input type="hidden" name="marketing" value={on ? "off" : "on"} />
        <button
          type="submit"
          disabled={busy}
          className={`min-h-11 rounded-full px-5 text-sm font-bold disabled:opacity-60 ${
            on ? "border border-carbon/20 text-carbon hover:border-carbon/40" : "bg-carbon text-hueso hover:bg-carbon/90"
          }`}
        >
          {on ? "Dejar de recibirlas" : "Quiero recibirlas"}
        </button>
        <span role="status" aria-live="polite" className="text-sm font-semibold text-bosque">
          {saved ? (on ? "Listo: recibirás promociones y novedades." : "Listo: ya no recibirás promociones.") : ""}
        </span>
      </fetcher.Form>
      {fetcher.data && !fetcher.data.ok && fetcher.data.error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-600">
          {fetcher.data.error}
        </p>
      )}
    </div>
  );
}
