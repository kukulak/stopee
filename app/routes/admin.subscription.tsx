import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { getSubscriptionConfig, saveSubscriptionConfig } from "~/models/subscriptionSettings.server";
import {
  MAX_FREQUENCY_WEEKS,
  MAX_SUBSCRIPTION_DISCOUNT_PERCENT,
  frequencyLabelForWeeks,
  type SubscriptionConfig,
  type SubscriptionFrequencyConfig,
} from "~/lib/subscriptionConfig";
import { Field, inputClass } from "~/components/admin/MediaFields";
import { requireAdmin } from "~/lib/session.server";
import { cleanPlainText } from "~/lib/formGuard.server";

export const meta: MetaFunction = () => [{ title: "Suscripción — Admin STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return data({ config: await getSubscriptionConfig() });
}

function parseFrequencies(raw: FormDataEntryValue | null): SubscriptionFrequencyConfig[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? "[]"));
  } catch {
    return "No se pudieron leer las frecuencias. Recarga la página e intenta de nuevo.";
  }
  if (!Array.isArray(parsed)) return "No se pudieron leer las frecuencias. Recarga la página e intenta de nuevo.";

  const seen = new Set<number>();
  const result: SubscriptionFrequencyConfig[] = [];
  for (const row of parsed as Record<string, unknown>[]) {
    const weeks = Number(row.weeks);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_FREQUENCY_WEEKS) {
      return `Cada frecuencia debe ser un número entero de semanas, entre 1 y ${MAX_FREQUENCY_WEEKS}.`;
    }
    if (seen.has(weeks)) return `Ya hay una frecuencia de ${frequencyLabelForWeeks(weeks).toLowerCase()}. Quita la repetida.`;
    seen.add(weeks);
    result.push({
      weeks,
      hint: cleanPlainText(row.hint).slice(0, 120),
      recommended: Boolean(row.recommended),
      isActive: row.isActive !== false,
    });
  }

  // Solo una puede llevar la etiqueta "Recomendado".
  const firstRecommended = result.findIndex((f) => f.recommended);
  result.forEach((f, i) => {
    f.recommended = i === firstRecommended;
  });
  return result.sort((a, b) => a.weeks - b.weeks);
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const formData = await request.formData();

  const discountPercent = Number(String(formData.get("discountPercent") ?? "").replace(",", "."));
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > MAX_SUBSCRIPTION_DISCOUNT_PERCENT) {
    return data(
      { ok: false as const, error: `El descuento debe ser un número entero de 0 a ${MAX_SUBSCRIPTION_DISCOUNT_PERCENT}.` },
      { status: 400 },
    );
  }

  const headline = cleanPlainText(formData.get("headline")).slice(0, 160);
  const ctaLabel = cleanPlainText(formData.get("ctaLabel")).slice(0, 60);
  if (!headline) return data({ ok: false as const, error: "Escribe el título del bloque." }, { status: 400 });
  if (!ctaLabel) return data({ ok: false as const, error: "Escribe el texto del botón." }, { status: 400 });

  const frequencies = parseFrequencies(formData.get("frequencies"));
  if (typeof frequencies === "string") return data({ ok: false as const, error: frequencies }, { status: 400 });
  if (!frequencies.some((f) => f.isActive)) {
    return data({ ok: false as const, error: "Deja al menos una frecuencia activa para que se pueda contratar." }, { status: 400 });
  }

  const benefits = cleanPlainText(formData.get("benefits"), { multiline: true })
    .split("\n")
    .map((line) => line.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 8);

  const next: SubscriptionConfig = {
    programName: cleanPlainText(formData.get("programName")).slice(0, 60),
    discountPercent,
    headline,
    description: cleanPlainText(formData.get("description"), { multiline: true }).slice(0, 400),
    benefits,
    ctaLabel,
    disclaimer: cleanPlainText(formData.get("disclaimer"), { multiline: true }).slice(0, 600),
    frequencies,
  };
  await saveSubscriptionConfig(next);
  return data({ ok: true as const, error: null });
}

type FrequencyRow = SubscriptionFrequencyConfig & { rowId: number };

function FrequencyEditor({ initial }: { initial: SubscriptionFrequencyConfig[] }) {
  const [nextId, setNextId] = useState(initial.length);
  const [rows, setRows] = useState<FrequencyRow[]>(() => initial.map((f, i) => ({ ...f, rowId: i })));

  const update = (rowId: number, patch: Partial<SubscriptionFrequencyConfig>) =>
    setRows((current) => current.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));

  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* El servidor recibe las filas ya armadas; los campos de abajo no se envían por sí solos. */}
      <input
        type="hidden"
        name="frequencies"
        value={JSON.stringify(
          rows.map((r) => ({
            weeks: r.weeks,
            hint: r.hint,
            recommended: r.recommended,
            isActive: r.isActive,
          })),
        )}
      />

      {rows.map((row) => (
        <div key={row.rowId} className="min-w-0 rounded-2xl border border-carbon/10 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <Field label="Cada (semanas)" htmlFor={`weeks-${row.rowId}`}>
              <input
                id={`weeks-${row.rowId}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_FREQUENCY_WEEKS}
                step={1}
                value={Number.isFinite(row.weeks) ? row.weeks : ""}
                onChange={(e) => update(row.rowId, { weeks: e.target.value === "" ? NaN : Number(e.target.value) })}
                className={inputClass}
              />
            </Field>
            <Field label="Para quién es (opcional)" htmlFor={`hint-${row.rowId}`}>
              <input
                id={`hint-${row.rowId}`}
                maxLength={120}
                value={row.hint}
                onChange={(e) => update(row.rowId, { hint: e.target.value })}
                placeholder="Ej. Consumo moderado"
                className={inputClass}
              />
            </Field>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-carbon">
              <input
                type="checkbox"
                checked={row.isActive}
                onChange={(e) => update(row.rowId, { isActive: e.target.checked })}
                className="h-5 w-5 shrink-0 accent-lima"
              />
              Ofrecer a clientes
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-carbon">
              <input
                type="radio"
                name="recommendedChoice"
                checked={row.recommended}
                onChange={() => setRows((current) => current.map((r) => ({ ...r, recommended: r.rowId === row.rowId })))}
                className="h-5 w-5 shrink-0 accent-lima"
              />
              Marcar como recomendada
            </label>
            <button
              type="button"
              onClick={() => setRows((current) => current.filter((r) => r.rowId !== row.rowId))}
              className="ml-auto min-h-11 rounded-full px-3 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              Quitar
            </button>
          </div>
        </div>
      ))}

      <div>
        <button
          type="button"
          onClick={() => {
            setRows((current) => [...current, { rowId: nextId, weeks: NaN, hint: "", recommended: false, isActive: true }]);
            setNextId(nextId + 1);
          }}
          className="min-h-11 rounded-full border border-carbon/15 px-5 text-sm font-semibold text-carbon hover:border-carbon/30"
        >
          Agregar frecuencia
        </button>
      </div>
    </div>
  );
}

export default function AdminSubscription() {
  const { config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state !== "idle";

  return (
    <div className="w-full min-w-0 max-w-3xl">
      <h1 className="font-display text-2xl font-black text-carbon sm:text-3xl">Suscripción</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Lo que ve el cliente al armar su caja periódica: nombre, descuento, frecuencias y textos.{" "}
        <a href="/suscripcion" target="_blank" rel="noreferrer" className="font-semibold text-bosque underline">
          Ver la página
        </a>
        . Los cambios aplican a nuevas suscripciones; quien ya tiene una conserva su frecuencia y su descuento.
      </p>

      {/* key: al guardar, los campos se vuelven a leer de la base de datos. */}
      <Form method="post" className="mt-6 flex w-full min-w-0 flex-col gap-5" key={JSON.stringify(config)}>
        <fieldset className="w-full min-w-0 max-w-full rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
          <legend className="sr-only">Nombre y descuento</legend>
          <h2 className="font-display text-lg font-bold text-carbon">Nombre y descuento</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label="Nombre del programa (opcional)" htmlFor="programName">
              <input id="programName" name="programName" maxLength={60} defaultValue={config.programName} placeholder="Ej. Club STOPee" className={inputClass} />
            </Field>
            <Field label="Descuento (%)" htmlFor="discountPercent">
              <input
                id="discountPercent"
                name="discountPercent"
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_SUBSCRIPTION_DISCOUNT_PERCENT}
                step={1}
                required
                defaultValue={config.discountPercent}
                className={inputClass}
              />
            </Field>
          </div>
          <p className="mt-2 text-xs text-carbon/50">
            Sin nombre, el sitio solo dice &ldquo;Suscripción&rdquo;. El descuento se aplica en cada entrega; con 0 no se cobra descuento
            y desaparece de los textos que lo mencionan.
          </p>
        </fieldset>

        <fieldset className="w-full min-w-0 max-w-full rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
          <legend className="sr-only">Textos de la página</legend>
          <h2 className="font-display text-lg font-bold text-carbon">Textos de la página</h2>
          <div className="mt-4 flex flex-col gap-4">
            <Field label="Título" htmlFor="headline">
              <input id="headline" name="headline" required maxLength={160} defaultValue={config.headline} className={inputClass} />
              <p className="mt-1 text-xs text-carbon/50">
                Escribe <code>{"{descuento}"}</code> donde quieras que aparezca el porcentaje.
              </p>
            </Field>
            <Field label="Descripción" htmlFor="description">
              <textarea id="description" name="description" rows={3} maxLength={400} defaultValue={config.description} className={inputClass} />
            </Field>
            <Field label="Ventajas (una por renglón)" htmlFor="benefits">
              <textarea
                id="benefits"
                name="benefits"
                rows={4}
                defaultValue={config.benefits.join("\n")}
                className={inputClass}
              />
            </Field>
            <Field label="Texto del botón" htmlFor="ctaLabel">
              <input id="ctaLabel" name="ctaLabel" required maxLength={60} defaultValue={config.ctaLabel} className={inputClass} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="w-full min-w-0 max-w-full rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
          <legend className="sr-only">Frecuencias</legend>
          <h2 className="font-display text-lg font-bold text-carbon">Frecuencias</h2>
          <p className="mt-1 text-xs text-carbon/50">
            Cada cuántas semanas puede llegar la caja. Si quitas o apagas una, los clientes que ya la tienen la conservan, pero ya no
            se ofrece a nadie más. Se cobra cada N semanas exactas.
          </p>
          <FrequencyEditor initial={config.frequencies} />
        </fieldset>

        <fieldset className="w-full min-w-0 max-w-full rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
          <legend className="sr-only">Aviso sobre fechas</legend>
          <h2 className="font-display text-lg font-bold text-carbon">Aviso sobre fechas de entrega</h2>
          <div className="mt-4">
            <Field label="Texto que aparece bajo el precio y al confirmar" htmlFor="disclaimer">
              <textarea id="disclaimer" name="disclaimer" rows={4} maxLength={600} defaultValue={config.disclaimer} className={inputClass} />
            </Field>
            <p className="mt-1 text-xs text-carbon/50">
              Explica aquí cómo se programan las fechas (por ejemplo, que salen en días de despacho específicos). Vacío = no se muestra.
            </p>
          </div>
        </fieldset>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button type="submit" disabled={isSaving} className="min-h-11 w-full rounded-full bg-carbon px-8 text-sm font-bold text-hueso disabled:opacity-60 sm:w-auto">
            {isSaving ? "Guardando…" : "Guardar cambios"}
          </button>
          {actionData?.error && <p className="text-sm font-semibold text-red-600">{actionData.error}</p>}
          {actionData?.ok && !isSaving && <p className="text-sm font-semibold text-bosque">Cambios guardados.</p>}
        </div>
      </Form>
    </div>
  );
}
