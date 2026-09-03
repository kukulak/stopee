import { useState } from "react";
import { useFetcher } from "@remix-run/react";

type Frequency = {
  value: "3-semanas" | "4-semanas" | "6-semanas" | "8-semanas";
  label: string;
  hint: string;
  recommended?: boolean;
};

const FREQUENCIES: Frequency[] = [
  { value: "3-semanas", label: "Cada 3 semanas", hint: "Perros grandes o paseos muy frecuentes" },
  { value: "4-semanas", label: "Cada 4 semanas", hint: "La opción más elegida", recommended: true },
  { value: "6-semanas", label: "Cada 6 semanas", hint: "Consumo moderado" },
  { value: "8-semanas", label: "Cada 8 semanas", hint: "Perros pequeños o paseos cortos" },
];

export function SubscriptionConfigurator() {
  const [frequency, setFrequency] = useState<Frequency["value"]>("4-semanas");
  const fetcher = useFetcher<{ error?: string }>();
  const isSubmitting = fetcher.state !== "idle";

  return (
    <div id="suscripcion" className="rounded-3xl border border-lima/30 bg-bosque/5 p-6 sm:p-8">
      <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
        Auto-envío periódico
      </p>
      <h3 className="mt-2 font-display text-2xl font-black text-carbon">
        Recibe tu STOPee 1L sin pensarlo, con 10% de descuento
      </h3>
      <p className="mt-2 max-w-2xl text-sm text-carbon/70">
        Prueba tu primer litro y mide cuánto te dura según los paseos de tu perro. Después,
        elige la frecuencia que mejor se ajuste — puedes pausarla o cambiarla cuando quieras
        desde tu cuenta.
      </p>

      <fetcher.Form method="post" action="/api/subscription" className="mt-6">
        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="sr-only">Elige tu frecuencia de entrega</legend>
          {FREQUENCIES.map((freq) => (
            <label
              key={freq.value}
              className={`relative flex min-h-11 cursor-pointer flex-col rounded-2xl border-2 p-4 transition-colors ${
                frequency === freq.value
                  ? "border-lima bg-lima/10"
                  : "border-carbon/10 bg-hueso hover:border-carbon/20"
              }`}
            >
              {freq.recommended && (
                <span className="absolute -top-2.5 left-4 rounded-full bg-lima px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-carbon">
                  Recomendado
                </span>
              )}
              <input
                type="radio"
                name="frequency"
                value={freq.value}
                checked={frequency === freq.value}
                onChange={() => setFrequency(freq.value)}
                className="sr-only"
              />
              <span className="font-display font-bold text-carbon">{freq.label}</span>
              <span className="mt-1 text-xs text-carbon/60">{freq.hint}</span>
            </label>
          ))}
        </fieldset>

        <div className="mt-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-sm text-carbon/60">
            Descuento aplicado automáticamente:{" "}
            <span className="font-bold text-bosque">10% en cada entrega</span>
          </p>
          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-11 w-full rounded-full bg-lima px-8 text-sm font-bold text-carbon transition-transform hover:scale-105 active:scale-95 disabled:opacity-60 sm:w-auto"
          >
            {isSubmitting ? "Redirigiendo…" : "Activar mi suscripción"}
          </button>
        </div>

        {fetcher.data?.error && (
          <p className="mt-3 text-sm font-semibold text-red-600">{fetcher.data.error}</p>
        )}
      </fetcher.Form>
    </div>
  );
}
