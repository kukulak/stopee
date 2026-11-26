import { useState } from "react";
import { useFetcher } from "react-router";
import type { AddressOption } from "~/lib/addressBook";

type AddressActionResult = { ok: boolean; error: string | null; savedIntent: string | null };

const quietButton =
  "min-h-11 rounded-full border border-carbon/15 px-4 text-sm font-semibold text-carbon hover:border-carbon/30 disabled:opacity-60";

/**
 * "Mis direcciones": las que la persona ya dio al pagar (se guardan solas). Desde aquí las nombra
 * ("Casa de mamá"), cambia cuál es la principal o quita las que ya no usa. La principal se
 * edita en "Mi perfil", donde están todos sus datos.
 */
export function AddressBookCard({ addresses }: { addresses: AddressOption[] }) {
  return (
    <div className="mt-8 rounded-3xl border border-carbon/10 bg-white p-6">
      <p className="font-display font-bold text-carbon">Mis direcciones</p>
      <p className="mt-1 text-sm text-carbon/60">
        Cada dirección que escribes al pagar se guarda aquí para que no la repitas. Puedes enviar a otra persona, por
        ejemplo a casa de tu mamá.
      </p>

      {addresses.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-carbon/5 p-4 text-sm text-carbon/70">
          Todavía no tienes direcciones guardadas. Se guardan solas con tu primer pedido.
        </p>
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

function AddressRow({ address }: { address: AddressOption }) {
  const fetcher = useFetcher<AddressActionResult>();
  const [renaming, setRenaming] = useState(false);
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

      <p className="mt-1 text-sm text-carbon/70">
        {[name, phone].filter(Boolean).join(" · ")}
        {(name || phone) && <br />}
        {[line1, line2].filter(Boolean).join(", ")}
        <br />
        {[city, postalCode && `CP ${postalCode}`].filter(Boolean).join(", ")}
      </p>

      {renaming ? (
        <fetcher.Form
          method="post"
          action="/cuenta"
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={() => setRenaming(false)}
        >
          <input type="hidden" name="intent" value="address-rename" />
          <input type="hidden" name="addressId" value={address.id} />
          <label htmlFor={`label-${address.id}`} className="sr-only">
            Nombre de la dirección
          </label>
          <input
            id={`label-${address.id}`}
            name="label"
            defaultValue={address.label}
            maxLength={40}
            required
            autoFocus
            placeholder="Casa de mamá"
            className="min-h-11 flex-1 rounded-xl border border-carbon/15 bg-white px-4 text-base focus:border-oliva focus:outline-none sm:text-sm"
          />
          <button type="submit" className="min-h-11 rounded-full bg-carbon px-5 text-sm font-bold text-hueso">
            Guardar nombre
          </button>
          <button type="button" onClick={() => setRenaming(false)} className={quietButton}>
            Cancelar
          </button>
        </fetcher.Form>
      ) : confirmingRemove ? (
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
          <button type="button" onClick={() => setRenaming(true)} className={quietButton}>
            Cambiar nombre
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

      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}
    </li>
  );
}
