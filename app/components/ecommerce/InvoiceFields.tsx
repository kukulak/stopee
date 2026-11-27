import { useEffect, useId, useState } from "react";
import {
  INVOICE_FIELDS,
  REGIMENES_FISCALES,
  USOS_CFDI,
  invoiceLaterNote,
  optionText,
  type BillingErrors,
  type BillingField,
  type BillingInfo,
} from "~/lib/fiscal";

const inputClass =
  "min-h-11 w-full rounded-xl border border-carbon/15 bg-white px-3 text-base text-carbon placeholder:text-carbon/40 focus:border-oliva focus:outline-none sm:text-sm";

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-carbon">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-carbon/50">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-semibold text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * «Requiero factura (CFDI)»: siempre opcional y sin cambiar el precio (ya incluye IVA). Con la casilla
 * marcada se piden los cinco datos fiscales, precargados con los de la cuenta si existen. Sin marcarla,
 * una nota explica cómo pedir la factura después. Los campos viajan con el formulario de pago (`form`).
 */
export function InvoiceFields({
  formId,
  defaults,
  errors,
  signedIn,
  invoiceEmail,
}: {
  formId: string;
  /** Los datos guardados en la cuenta (`null` = no tiene o es invitado). */
  defaults?: BillingInfo | null;
  /** Errores que devolvió el servidor, campo por campo. */
  errors?: BillingErrors;
  /** Con sesión se puede guardar para la próxima vez. */
  signedIn: boolean;
  /** A dónde pedir la factura después (de «Datos del negocio»). */
  invoiceEmail?: string | null;
}) {
  const uid = useId();
  const [requested, setRequested] = useState(false);
  const open = requested;
  // Si el servidor devolvió errores de facturación, la casilla se queda marcada para corregirlos ahí mismo.
  const hasErrors = Boolean(errors && Object.keys(errors).length > 0);
  useEffect(() => {
    if (hasErrors) setRequested(true);
  }, [hasErrors, errors]);
  const hasSaved = Boolean(defaults?.rfc);
  const id = (field: BillingField) => `${uid}-${field}`;
  const err = (field: BillingField) => errors?.[field];
  const invalid = (field: BillingField) => (err(field) ? { "aria-invalid": true, "aria-describedby": `${id(field)}-error` } : {});

  return (
    <fieldset className="min-w-0 border-t border-carbon/10 pt-4">
      <legend className="mb-1 text-sm font-bold text-carbon">Factura (opcional)</legend>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-carbon">
        <input
          type="checkbox"
          name="invoiceRequested"
          form={formId}
          checked={open}
          onChange={(e) => setRequested(e.target.checked)}
          className="h-5 w-5 shrink-0 accent-carbon"
        />
        Requiero factura (CFDI)
      </label>

      {!open ? (
        <p className="mt-1 text-xs text-carbon/60">{invoiceLaterNote(invoiceEmail)}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          <p className="text-xs text-carbon/60">
            {hasSaved ? "Usamos los datos guardados en tu cuenta; puedes corregirlos aquí. " : ""}Tu precio no cambia: ya incluye el IVA.
          </p>

          <Field id={id("rfc")} label="RFC" error={err("rfc")}>
            <input
              id={id("rfc")}
              name={INVOICE_FIELDS.rfc}
              form={formId}
              defaultValue={defaults?.rfc ?? ""}
              maxLength={16}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XAXX010101000"
              className={`${inputClass} uppercase`}
              {...invalid("rfc")}
            />
          </Field>

          <Field
            id={id("razonSocial")}
            label="Nombre o razón social"
            hint="Tal como aparece en tu Constancia de Situación Fiscal, sin S.A. de C.V."
            error={err("razonSocial")}
          >
            <input
              id={id("razonSocial")}
              name={INVOICE_FIELDS.razonSocial}
              form={formId}
              defaultValue={defaults?.razonSocial ?? ""}
              maxLength={200}
              autoComplete="organization"
              className={inputClass}
              {...invalid("razonSocial")}
            />
          </Field>

          <Field id={id("regimenFiscal")} label="Régimen fiscal" error={err("regimenFiscal")}>
            <select
              id={id("regimenFiscal")}
              name={INVOICE_FIELDS.regimenFiscal}
              form={formId}
              defaultValue={defaults?.regimenFiscal ?? ""}
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
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <Field id={id("codigoPostalFiscal")} label="CP fiscal" error={err("codigoPostalFiscal")}>
              <input
                id={id("codigoPostalFiscal")}
                name={INVOICE_FIELDS.codigoPostalFiscal}
                form={formId}
                defaultValue={defaults?.codigoPostalFiscal ?? ""}
                inputMode="numeric"
                maxLength={5}
                autoComplete="off"
                placeholder="03100"
                className={inputClass}
                {...invalid("codigoPostalFiscal")}
              />
            </Field>
            <Field id={id("usoCfdi")} label="Uso de CFDI" error={err("usoCfdi")}>
              <select
                id={id("usoCfdi")}
                name={INVOICE_FIELDS.usoCfdi}
                form={formId}
                defaultValue={defaults?.usoCfdi ?? "G03"}
                className={inputClass}
                {...invalid("usoCfdi")}
              >
                {USOS_CFDI.map((u) => (
                  <option key={u.code} value={u.code}>
                    {optionText(u)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {signedIn && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-carbon">
              <input
                type="checkbox"
                name="invSave"
                form={formId}
                // Sin datos guardados se ofrece guardarlos; si ya tenía, solo se actualizan cuando lo pide.
                defaultChecked={!hasSaved}
                className="h-5 w-5 shrink-0 accent-carbon"
              />
              {hasSaved ? "Actualizar mis datos de facturación guardados" : "Guardar estos datos en mi cuenta para la próxima vez"}
            </label>
          )}
        </div>
      )}
    </fieldset>
  );
}
