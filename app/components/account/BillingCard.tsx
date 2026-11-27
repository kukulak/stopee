import { useState } from "react";
import { useFetcher } from "react-router";
import {
  INVOICE_FIELDS,
  REGIMENES_FISCALES,
  USOS_CFDI,
  optionText,
  regimenLabel,
  usoCfdiLabel,
  type BillingErrors,
  type BillingField,
  type BillingInfo,
} from "~/lib/fiscal";

type BillingActionResult = { ok: boolean; error: string | null; savedIntent: string | null; errors?: BillingErrors };

const inputClass =
  "min-h-11 w-full rounded-xl border border-carbon/15 bg-white px-3 text-base text-carbon placeholder:text-carbon/40 focus:border-oliva focus:outline-none sm:text-sm";

/**
 * «Datos de facturación (opcional)»: se guardan para llenarse solos cuando la persona pide factura al
 * pagar. Comprar nunca los exige. El precio es el mismo con o sin factura (ya incluye IVA).
 */
export function BillingCard({ billing, invoicesBoxes = false }: { billing: BillingInfo | null; /** Alguna caja del auto-envío se factura con estos datos. */ invoicesBoxes?: boolean }) {
  const fetcher = useFetcher<BillingActionResult>();
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;
  const errors = result && !result.ok ? result.errors : undefined;
  const saved = result?.ok && result.savedIntent === "billing-update" && !busy;
  const removed = result?.ok && result.savedIntent === "billing-remove" && !busy;
  const showForm = editing || !billing || Boolean(errors);

  const err = (field: BillingField) => errors?.[field];
  const invalid = (field: BillingField) => (err(field) ? { "aria-invalid": true, "aria-describedby": `billing-${field}-error` } : {});
  const fieldError = (field: BillingField) =>
    err(field) ? (
      <p id={`billing-${field}-error`} className="mt-1 text-xs font-semibold text-red-600">
        {err(field)}
      </p>
    ) : null;

  return (
    <div className="mt-8 rounded-3xl border border-carbon/10 bg-white p-6">
      <p className="font-display font-bold text-carbon">Datos de facturación (opcional)</p>
      <p className="mt-1 text-sm text-carbon/60">
        Guárdalos una vez y se llenan solos cuando marques «Requiero factura» al pagar. No los necesitas para comprar, y el
        precio es el mismo con o sin factura: ya incluye el IVA.
      </p>

      {!showForm && billing ? (
        <div className="mt-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-2xl bg-hueso p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-carbon/50">RFC</dt>
              <dd className="font-semibold text-carbon">{billing.rfc}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-carbon/50">Nombre o razón social</dt>
              <dd className="font-semibold text-carbon">{billing.razonSocial}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-carbon/50">Régimen fiscal</dt>
              <dd className="text-carbon">{regimenLabel(billing.regimenFiscal)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-carbon/50">Código postal fiscal</dt>
              <dd className="text-carbon">{billing.codigoPostalFiscal}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-carbon/50">Uso de CFDI</dt>
              <dd className="text-carbon">{usoCfdiLabel(billing.usoCfdi)}</dd>
            </div>
          </dl>

          {saved && <p className="mt-3 text-sm font-semibold text-bosque">Datos de facturación guardados.</p>}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="min-h-11 rounded-full border border-carbon/15 px-4 text-sm font-semibold text-carbon hover:border-carbon/30"
            >
              Editar
            </button>
            {!confirmingRemove ? (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                className="min-h-11 rounded-full px-4 text-sm font-semibold text-carbon/60 hover:text-red-700"
              >
                Quitar mis datos
              </button>
            ) : (
              <fetcher.Form method="post" action="/cuenta" className="flex flex-wrap items-center gap-2" onSubmit={() => setConfirmingRemove(false)}>
                <input type="hidden" name="intent" value="billing-remove" />
                <span className="text-sm text-carbon/70">
                  ¿Borrar tus datos fiscales guardados?{invoicesBoxes ? " Tus cajas dejarán de facturarse solas." : ""}
                </span>
                <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-red-600 px-4 text-sm font-bold text-white disabled:opacity-60">
                  Sí, borrarlos
                </button>
                <button type="button" onClick={() => setConfirmingRemove(false)} className="min-h-11 rounded-full px-4 text-sm font-semibold text-carbon/70">
                  Cancelar
                </button>
              </fetcher.Form>
            )}
          </div>
        </div>
      ) : (
        <fetcher.Form
          method="post"
          action="/cuenta"
          className="mt-4 flex flex-col gap-4"
          onSubmit={() => setEditing(false)}
        >
          <input type="hidden" name="intent" value="billing-update" />
          {removed && <p className="text-sm font-semibold text-bosque">Tus datos fiscales se borraron.</p>}

          <div>
            <label htmlFor="billing-rfc" className="mb-1 block text-sm font-semibold text-carbon">
              RFC
            </label>
            <input
              id="billing-rfc"
              name={INVOICE_FIELDS.rfc}
              defaultValue={billing?.rfc ?? ""}
              maxLength={16}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XAXX010101000"
              className={`${inputClass} uppercase sm:max-w-xs`}
              {...invalid("rfc")}
            />
            {fieldError("rfc")}
          </div>

          <div>
            <label htmlFor="billing-razonSocial" className="mb-1 block text-sm font-semibold text-carbon">
              Nombre o razón social
            </label>
            <input
              id="billing-razonSocial"
              name={INVOICE_FIELDS.razonSocial}
              defaultValue={billing?.razonSocial ?? ""}
              maxLength={200}
              className={inputClass}
              {...invalid("razonSocial")}
            />
            {err("razonSocial") ? (
              fieldError("razonSocial")
            ) : (
              <p className="mt-1 text-xs text-carbon/50">Tal como aparece en tu Constancia de Situación Fiscal, sin S.A. de C.V.</p>
            )}
          </div>

          <div>
            <label htmlFor="billing-regimenFiscal" className="mb-1 block text-sm font-semibold text-carbon">
              Régimen fiscal
            </label>
            <select
              id="billing-regimenFiscal"
              name={INVOICE_FIELDS.regimenFiscal}
              defaultValue={billing?.regimenFiscal ?? ""}
              className={inputClass}
              {...invalid("regimenFiscal")}
            >
              <option value="" disabled>
                Elige tu régimen
              </option>
              {REGIMENES_FISCALES.map((r) => (
                <option key={r.code} value={r.code}>
                  {optionText(r)}
                </option>
              ))}
            </select>
            {fieldError("regimenFiscal")}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <div>
              <label htmlFor="billing-codigoPostalFiscal" className="mb-1 block text-sm font-semibold text-carbon">
                Código postal fiscal
              </label>
              <input
                id="billing-codigoPostalFiscal"
                name={INVOICE_FIELDS.codigoPostalFiscal}
                defaultValue={billing?.codigoPostalFiscal ?? ""}
                inputMode="numeric"
                maxLength={5}
                autoComplete="off"
                placeholder="03100"
                className={inputClass}
                {...invalid("codigoPostalFiscal")}
              />
              {fieldError("codigoPostalFiscal")}
            </div>
            <div>
              <label htmlFor="billing-usoCfdi" className="mb-1 block text-sm font-semibold text-carbon">
                Uso de CFDI
              </label>
              <select
                id="billing-usoCfdi"
                name={INVOICE_FIELDS.usoCfdi}
                defaultValue={billing?.usoCfdi ?? "G03"}
                className={inputClass}
                {...invalid("usoCfdi")}
              >
                {USOS_CFDI.map((u) => (
                  <option key={u.code} value={u.code}>
                    {optionText(u)}
                  </option>
                ))}
              </select>
              {fieldError("usoCfdi")}
            </div>
          </div>

          {result && !result.ok && result.savedIntent === "billing-update" && (
            <p className="text-sm font-semibold text-red-600">{result.error ?? "Revisa los datos marcados en rojo."}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60">
              {busy ? "Guardando…" : "Guardar datos de facturación"}
            </button>
            {billing && (
              <button type="button" onClick={() => setEditing(false)} className="min-h-11 rounded-full px-4 text-sm font-semibold text-carbon/70">
                Cancelar
              </button>
            )}
          </div>
        </fetcher.Form>
      )}
    </div>
  );
}
