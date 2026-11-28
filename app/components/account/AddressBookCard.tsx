import { useEffect, useId, useState } from "react";
import { useFetcher } from "react-router";
import type { AddressFormField, AddressOption } from "~/lib/addressBook";

type AddressActionResult = {
  ok: boolean;
  error: string | null;
  savedIntent: string | null;
  errors?: Partial<Record<AddressFormField, string>>;
};

const quietButton =
  "min-h-11 rounded-full border border-carbon/15 px-4 text-sm font-semibold text-carbon hover:border-carbon/30 disabled:opacity-60";
const inputClass =
  "mt-1 min-h-11 w-full rounded-xl border border-carbon/15 bg-white px-4 text-base text-carbon focus:border-oliva focus:outline-none sm:text-sm";

/**
 * «Mis direcciones»: las casas a las que la persona envía, cada una con su nombre («Casa», «Casa de mamá»). Se agregan
 * aquí mismo o se guardan solas al pagar; al pagar se elige con un toque. Cada una se edita, se nombra, se hace
 * principal o se quita.
 */
export function AddressBookCard({ addresses }: { addresses: AddressOption[] }) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="rounded-3xl border border-carbon/10 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="font-display text-xl font-black text-carbon">Mis direcciones</h2>
          <p className="mt-1 text-sm text-carbon/60">
            Ponle nombre a cada lugar al que envías (casa, oficina, casa de mamá) y elígelo con un toque al pagar.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="min-h-11 shrink-0 rounded-full bg-carbon px-5 text-sm font-bold text-hueso hover:bg-carbon/90"
          >
            Agregar dirección
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-4 rounded-2xl border-2 border-lima bg-lima/10 p-4">
          <p className="font-display font-bold text-carbon">Nueva dirección</p>
          <AddressForm intent="address-add" submitLabel="Guardar dirección" onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
        </div>
      )}

      {addresses.length === 0 ? (
        !adding && (
          <p className="mt-4 rounded-2xl bg-carbon/5 p-4 text-sm text-carbon/70">
            Todavía no tienes direcciones guardadas. Agrega la primera con el botón de arriba.
          </p>
        )
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {addresses.map((address) => (
            <AddressRow key={address.id} address={address} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * El formulario de una dirección, igual para agregar que para editar. Se cierra solo cuando se guarda y, si falta
 * algo, lo dice debajo de cada campo sin borrar lo que ya se escribió.
 */
function AddressForm({
  intent,
  addressId,
  initial,
  submitLabel,
  onDone,
  onCancel,
}: {
  intent: "address-add" | "address-update";
  addressId?: string;
  initial?: AddressOption;
  submitLabel: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const fetcher = useFetcher<AddressActionResult>();
  const uid = useId();
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;
  const errors = result && !result.ok ? (result.errors ?? {}) : {};
  const generalError = result && !result.ok && !result.errors ? result.error : null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onDone();
    // Solo cuando llega la respuesta: `onDone` cambia en cada vuelta y no debe volver a dispararlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const f = initial?.fields;
  const field = (name: AddressFormField | "line2" | "state", label: string, defaultValue: string, opts: { placeholder?: string; type?: string; autoComplete?: string; wide?: boolean; optional?: boolean } = {}) => {
    const id = `${uid}-${name}`;
    const error = name in errors ? errors[name as AddressFormField] : undefined;
    return (
      <div className={opts.wide ? "sm:col-span-2" : ""}>
        <label htmlFor={id} className="text-sm font-semibold text-carbon">
          {label}
          {opts.optional && <span className="font-normal text-carbon/50"> (opcional)</span>}
        </label>
        <input
          id={id}
          name={name}
          type={opts.type ?? "text"}
          inputMode={name === "phone" ? "tel" : name === "postalCode" ? "numeric" : undefined}
          defaultValue={defaultValue}
          placeholder={opts.placeholder}
          autoComplete={opts.autoComplete ?? "off"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${inputClass} ${error ? "border-red-400" : ""}`}
        />
        {error && (
          <p id={`${id}-error`} className="mt-1 text-xs font-semibold text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <fetcher.Form method="post" action="/cuenta" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="intent" value={intent} />
      {addressId && <input type="hidden" name="addressId" value={addressId} />}
      {field("label", "Nombre de la dirección", initial?.label ?? "", { placeholder: "Casa de mamá", wide: true })}
      {field("name", "Nombre completo de quien recibe", f?.name ?? "", { placeholder: "Nombre y apellidos" })}
      {field("phone", "Teléfono", f?.phone ?? "", { type: "tel", placeholder: "10 dígitos" })}
      {field("line1", "Calle y número", f?.line1 ?? "", { wide: true })}
      {field("line2", "Colonia, interior…", f?.line2 ?? "", { wide: true, optional: true })}
      {field("city", "Alcaldía o municipio", f?.city ?? "")}
      {field("postalCode", "Código postal", f?.postalCode ?? "", { placeholder: "5 dígitos" })}
      {field("state", "Estado", "", { optional: true })}

      {generalError && (
        <p role="alert" className="text-sm font-semibold text-red-600 sm:col-span-2">
          {generalError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60">
          {busy ? "Guardando…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={quietButton}>
          Cancelar
        </button>
      </div>
    </fetcher.Form>
  );
}

function AddressRow({ address }: { address: AddressOption }) {
  const fetcher = useFetcher<AddressActionResult>();
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const busy = fetcher.state !== "idle";
  const error = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;
  const { name, phone, line1, line2, city, postalCode } = address.fields;

  return (
    <li className={`rounded-2xl border-2 p-4 ${address.isPrincipal ? "border-lima bg-lima/10" : "border-carbon/10 bg-hueso"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-display font-bold text-carbon">{address.label}</p>
        {address.isPrincipal && (
          <span className="rounded-full bg-lima px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-carbon">
            Principal
          </span>
        )}
      </div>

      {editing ? (
        <AddressForm
          intent="address-update"
          addressId={address.id}
          initial={address}
          submitLabel="Guardar cambios"
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <p className="mt-1 text-sm text-carbon/70">
            {[name, phone].filter(Boolean).join(" · ")}
            {(name || phone) && <br />}
            {[line1, line2].filter(Boolean).join(", ")}
            <br />
            {[city, postalCode && `CP ${postalCode}`].filter(Boolean).join(", ")}
          </p>

          {confirmingRemove ? (
            <fetcher.Form method="post" action="/cuenta" className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="intent" value="address-remove" />
              <input type="hidden" name="addressId" value={address.id} />
              <p className="text-sm font-semibold text-carbon">¿Quitar esta dirección?</p>
              <button
                type="submit"
                disabled={busy}
                className="min-h-11 rounded-full bg-red-600 px-5 text-sm font-bold text-white disabled:opacity-60"
              >
                {busy ? "Quitando…" : "Sí, quitar"}
              </button>
              <button type="button" onClick={() => setConfirmingRemove(false)} className={quietButton}>
                Cancelar
              </button>
            </fetcher.Form>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditing(true)} className={quietButton}>
                Editar
              </button>
              {!address.isPrincipal && (
                <>
                  <fetcher.Form method="post" action="/cuenta">
                    <input type="hidden" name="intent" value="address-make-principal" />
                    <input type="hidden" name="addressId" value={address.id} />
                    <button type="submit" disabled={busy} className={quietButton}>
                      {busy ? "Cambiando…" : "Hacer principal"}
                    </button>
                  </fetcher.Form>
                  <button type="button" onClick={() => setConfirmingRemove(true)} className={quietButton}>
                    Quitar
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}
    </li>
  );
}
