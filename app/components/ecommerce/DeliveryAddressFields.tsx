import { useEffect, useId, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { ADDRESS_FIELDS, type AddressErrors, type AddressFieldKey, type AddressMode } from "~/lib/deliveryAddress";
import { isPostalCodeInRanges, parsePostalRanges, type DeliveryZone } from "~/lib/deliveryZone";

export type AddressDefaults = Partial<Record<AddressFieldKey, string>>;

const inputClass =
  "min-h-11 w-full rounded-xl border border-carbon/15 bg-white px-3 text-base text-carbon placeholder:text-carbon/40 focus:border-oliva focus:outline-none sm:text-sm";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs font-semibold text-red-600">
      {message}
    </p>
  );
}

/**
 * La dirección de entrega, escrita aquí y no en la pantalla de Stripe: así se
 * puede cerrar la tienda a una sola zona y el pedido guarda la dirección sin un
 * paso extra. Va DENTRO del formulario de pago (sus campos viajan con él).
 *
 * El código postal va primero a propósito: si está fuera de la zona, la persona
 * se entera antes de escribir nada más, y puede dejar su correo para que le
 * avisemos cuando lleguemos a su zona. El servidor repite la misma revisión, así
 * que esto es ayuda para el cliente y no el candado.
 */
export function DeliveryAddressFields({
  formId,
  mode,
  zone,
  defaults,
  errors,
  onOutOfZoneChange,
}: {
  /** El `id` del formulario de pago: los campos se dibujan donde conviene pero viajan con ese formulario. */
  formId: string;
  mode: AddressMode;
  zone: DeliveryZone;
  defaults?: AddressDefaults;
  /** Errores que devolvió el servidor, campo por campo. */
  errors?: AddressErrors;
  /** Avisa al botón de pagar para que se desactive mientras el código postal esté fuera de la zona. */
  onOutOfZoneChange?: (outOfZone: boolean) => void;
}) {
  const uid = useId();
  const ranges = useMemo(() => parsePostalRanges(zone.postalRanges).ranges, [zone.postalRanges]);
  const [postalCode, setPostalCode] = useState(defaults?.postalCode ?? "");
  // Solo se juzga con los 5 dígitos completos: "0310" camino a "03100" no debe mostrar un falso aviso.
  const outOfZone = /^\d{5}$/.test(postalCode) && !isPostalCodeInRanges(postalCode, ranges);

  useEffect(() => {
    onOutOfZoneChange?.(outOfZone);
  }, [outOfZone, onOutOfZoneChange]);

  const id = (key: AddressFieldKey) => `${uid}-${key}`;
  const describedBy = (key: AddressFieldKey) => (errors?.[key] ? `${id(key)}-error` : undefined);

  return (
    <fieldset className="min-w-0 border-t border-carbon/10 pt-4">
      <legend className="mb-1 text-sm font-bold text-carbon">¿A dónde lo enviamos?</legend>
      <p className="mb-3 text-xs text-carbon/60">
        Por ahora entregamos solo en <strong className="text-carbon">{zone.name}</strong>.
      </p>

      <div className="flex flex-col gap-3">
        <div className="max-w-[10rem]">
          <label htmlFor={id("postalCode")} className="mb-1 block text-xs font-semibold text-carbon/70">
            Código postal
          </label>
          <input
            id={id("postalCode")}
            name={ADDRESS_FIELDS.postalCode}
            form={formId}
            value={postalCode}
            onChange={(event) => setPostalCode(event.target.value.replace(/\D/g, "").slice(0, 5))}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={5}
            pattern="\d{5}"
            required
            aria-invalid={Boolean(errors?.postalCode) || outOfZone}
            aria-describedby={describedBy("postalCode")}
            className={inputClass}
          />
        </div>
        {!outOfZone && <FieldError id={`${id("postalCode")}-error`} message={errors?.postalCode} />}

        {outOfZone && <OutOfZoneNotice zone={zone} postalCode={postalCode} />}

        {/* Los campos siguen montados (solo ocultos) para no perder lo escrito si se corrige el código postal. */}
        <div className={outOfZone ? "hidden" : "flex flex-col gap-3"}>
          <div>
            <label htmlFor={id("name")} className="mb-1 block text-xs font-semibold text-carbon/70">
              Nombre de quien recibe
            </label>
            <input
              id={id("name")}
              name={ADDRESS_FIELDS.name}
              form={formId}
              defaultValue={defaults?.name ?? ""}
              autoComplete="name"
              maxLength={100}
              required
              aria-invalid={Boolean(errors?.name)}
              aria-describedby={describedBy("name")}
              className={inputClass}
            />
            <FieldError id={`${id("name")}-error`} message={errors?.name} />
          </div>

          <div>
            <label htmlFor={id("phone")} className="mb-1 block text-xs font-semibold text-carbon/70">
              Teléfono (lo usa la paquetería)
            </label>
            <input
              id={id("phone")}
              name={ADDRESS_FIELDS.phone}
              form={formId}
              defaultValue={defaults?.phone ?? ""}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
              required
              aria-invalid={Boolean(errors?.phone)}
              aria-describedby={describedBy("phone")}
              className={inputClass}
            />
            <FieldError id={`${id("phone")}-error`} message={errors?.phone} />
          </div>

          {mode === "home" ? (
            <>
              <div>
                <label htmlFor={id("line1")} className="mb-1 block text-xs font-semibold text-carbon/70">
                  Calle y número
                </label>
                <input
                  id={id("line1")}
                  name={ADDRESS_FIELDS.line1}
                  form={formId}
                  defaultValue={defaults?.line1 ?? ""}
                  autoComplete="address-line1"
                  maxLength={120}
                  required
                  aria-invalid={Boolean(errors?.line1)}
                  aria-describedby={describedBy("line1")}
                  className={inputClass}
                />
                <FieldError id={`${id("line1")}-error`} message={errors?.line1} />
              </div>
              <div>
                <label htmlFor={id("line2")} className="mb-1 block text-xs font-semibold text-carbon/70">
                  Colonia, interior o referencias <span className="font-normal text-carbon/50">(opcional)</span>
                </label>
                <input
                  id={id("line2")}
                  name={ADDRESS_FIELDS.line2}
                  form={formId}
                  defaultValue={defaults?.line2 ?? ""}
                  autoComplete="address-line2"
                  maxLength={120}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={id("city")} className="mb-1 block text-xs font-semibold text-carbon/70">
                  Alcaldía o municipio
                </label>
                <input
                  id={id("city")}
                  name={ADDRESS_FIELDS.city}
                  form={formId}
                  defaultValue={defaults?.city ?? ""}
                  autoComplete="address-level2"
                  maxLength={80}
                  required
                  aria-invalid={Boolean(errors?.city)}
                  aria-describedby={describedBy("city")}
                  className={inputClass}
                />
                <FieldError id={`${id("city")}-error`} message={errors?.city} />
              </div>
            </>
          ) : (
            <p className="rounded-xl bg-carbon/5 px-3 py-2 text-xs text-carbon/70">
              Con tu código postal te asignamos el punto de entrega más cercano. No necesitas escribir tu calle.
            </p>
          )}
        </div>
      </div>
    </fieldset>
  );
}

/**
 * Aviso de zona sin servicio, con la salida útil: dejar el correo para que
 * avisemos cuando lleguemos. Sus campos NO llevan `name` ni van en un `<form>`
 * propio (estaría anidado dentro del de pago): se envían con un fetcher aparte.
 */
function OutOfZoneNotice({ zone, postalCode }: { zone: DeliveryZone; postalCode: string }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [email, setEmail] = useState("");
  const inputId = useId();
  const sending = fetcher.state !== "idle";
  const done = fetcher.data?.ok === true;

  function submit() {
    fetcher.submit({ email, postalCode }, { method: "post", action: "/api/cobertura" });
  }

  return (
    <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">Aún no llegamos al código postal {postalCode}.</p>
      <p className="mt-1">
        Por ahora entregamos solo en {zone.name}, así que no podemos cobrar este pedido. Deja tu correo y te avisamos
        cuando lleguemos a tu zona.
      </p>
      {done ? (
        <p role="status" className="mt-3 font-semibold text-bosque">
          Listo, te avisaremos cuando lleguemos a tu zona.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label htmlFor={inputId} className="sr-only">
            Tu correo para avisarte
          </label>
          <input
            id={inputId}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // Enter aquí no debe enviar el formulario de pago que lo contiene.
                event.preventDefault();
                if (email) submit();
              }
            }}
            inputMode="email"
            autoComplete="email"
            placeholder="tu@correo.com"
            className={inputClass}
          />
          <button
            type="button"
            onClick={submit}
            disabled={sending || !email}
            className="min-h-11 shrink-0 rounded-full bg-carbon px-5 text-sm font-bold text-hueso disabled:opacity-60"
          >
            {sending ? "Enviando…" : "Avísame"}
          </button>
        </div>
      )}
      {fetcher.data?.ok === false && fetcher.data.error && (
        <p className="mt-2 text-xs font-semibold text-red-700">{fetcher.data.error}</p>
      )}
      {!done && (
        <p className="mt-2 text-xs text-amber-900/80">
          Usaremos tu correo solo para avisarte cuando lleguemos a tu zona, como explica nuestro{" "}
          <a href="/aviso-de-privacidad" target="_blank" rel="noreferrer" className="font-semibold underline">
            aviso de privacidad
          </a>
          .
        </p>
      )}
    </div>
  );
}
