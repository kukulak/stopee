import { useEffect, useId, useState } from "react";
import { Link, useFetcher } from "react-router";
import { PasswordField } from "~/components/ui/PasswordField";

type Result = { ok: boolean; error: string | null; savedIntent: string | null };

const inputClass =
  "mt-1 min-h-11 w-full rounded-xl border border-carbon/15 bg-white px-4 text-base text-carbon focus:border-oliva focus:outline-none sm:text-sm";
const quietButton =
  "min-h-11 shrink-0 rounded-full border border-carbon/15 px-5 text-sm font-semibold text-carbon hover:border-carbon/30 disabled:opacity-60";

/**
 * «Mi perfil»: los datos de la persona (nombre, correo, teléfono) y su contraseña. Los perritos tienen su propia
 * sección y las direcciones también. El correo se muestra pero no se cambia aquí: ligan los pedidos y los avisos.
 */
export function ProfileCard({
  name,
  firstName,
  lastName,
  email,
  emailVerified,
  phone,
}: {
  /** Nombre completo, tal como se muestra. */
  name: string;
  /** Lo que se llena al editar (en cuentas con un solo nombre, una sugerencia). */
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  phone: string;
}) {
  return (
    <div className="rounded-3xl border border-carbon/10 bg-white p-6">
      <h2 className="font-display text-xl font-black text-carbon">Mi perfil</h2>
      <p className="mt-1 text-sm text-carbon/60">Tus datos, tu correo y tu contraseña.</p>

      <DetailsBlock name={name} firstName={firstName} lastName={lastName} email={email} emailVerified={emailVerified} phone={phone} />
      <EmailBlock email={email} />
      <PasswordBlock />
    </div>
  );
}

function DetailsBlock({
  name,
  firstName,
  lastName,
  email,
  emailVerified,
  phone,
}: {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  phone: string;
}) {
  const fetcher = useFetcher<Result>();
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data?.savedIntent === "update-profile" ? fetcher.data : null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.savedIntent === "update-profile") setEditing(false);
  }, [fetcher.state, fetcher.data]);

  return (
    <section aria-label="Mis datos" className="mt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="font-display font-bold text-carbon">Mis datos</p>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className={quietButton}>
            Editar
          </button>
        )}
      </div>

      {result?.ok && !editing && !busy && (
        <p role="status" className="mt-2 text-sm font-semibold text-bosque">
          Listo, guardamos tus datos.
        </p>
      )}

      {!editing ? (
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 rounded-2xl bg-hueso p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-carbon/50">Nombre completo</dt>
            <dd className="font-semibold text-carbon">{name || "sin registrar"}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-carbon/50">Teléfono</dt>
            <dd className="font-semibold text-carbon">{phone || "sin registrar"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-bold uppercase tracking-wide text-carbon/50">Correo</dt>
            <dd className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-carbon">
              <span className="break-all">{email}</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  emailVerified ? "bg-lima/40 text-bosque" : "bg-amber-100 text-amber-900"
                }`}
              >
                {emailVerified ? "Confirmado" : "Sin confirmar"}
              </span>
            </dd>
            <dd className="mt-1 text-xs font-normal text-carbon/60">
              ¿Ya no tienes acceso a ese correo?{" "}
              <Link to="/contacto" className="font-semibold text-bosque underline">
                Escríbenos
              </Link>{" "}
              y te pediremos datos de tus pedidos para comprobar que eres tú.
            </dd>
          </div>
        </dl>
      ) : (
        <fetcher.Form method="post" action="/cuenta" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="intent" value="update-profile" />
          <div>
            <label htmlFor={`${uid}-first`} className="text-sm font-semibold text-carbon">
              Nombre(s)
            </label>
            <input id={`${uid}-first`} name="firstName" defaultValue={firstName} required maxLength={60} autoComplete="given-name" className={inputClass} />
          </div>
          <div>
            <label htmlFor={`${uid}-last`} className="text-sm font-semibold text-carbon">
              Apellidos
            </label>
            <input id={`${uid}-last`} name="lastName" defaultValue={lastName} maxLength={80} autoComplete="family-name" className={inputClass} />
          </div>
          <div>
            <label htmlFor={`${uid}-phone`} className="text-sm font-semibold text-carbon">
              Teléfono
            </label>
            <input
              id={`${uid}-phone`}
              name="phone"
              type="tel"
              inputMode="tel"
              defaultValue={phone}
              autoComplete="tel"
              className={inputClass}
            />
          </div>
          {result && !result.ok && (
            <p role="alert" className="text-sm font-semibold text-red-600 sm:col-span-2">
              {result.error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60">
              {busy ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={quietButton}>
              Cancelar
            </button>
          </div>
        </fetcher.Form>
      )}
    </section>
  );
}

/** Cambiar el correo: contraseña actual + correo nuevo; el cambio se hace al abrir el enlace que llega al correo nuevo. */
function EmailBlock({ email }: { email: string }) {
  const fetcher = useFetcher<Result & { maskedEmail?: string }>();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data?.savedIntent === "change-email" ? fetcher.data : null;
  const sent = result?.ok ? result.maskedEmail : null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.savedIntent === "change-email") setOpen(false);
  }, [fetcher.state, fetcher.data]);

  return (
    <section aria-label="Correo" className="mt-6 border-t border-carbon/10 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <p className="font-display font-bold text-carbon">Correo de la cuenta</p>
          <p className="mt-0.5 text-sm text-carbon/60">
            Para cambiarlo te pedimos tu contraseña y confirmamos el correo nuevo con un enlace.
          </p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className={quietButton}>
            Cambiar correo
          </button>
        )}
      </div>

      {sent && !open && (
        <p role="status" className="mt-2 text-sm font-semibold text-bosque">
          Te mandamos un enlace a {sent}. Ábrelo para terminar el cambio; mientras tanto tu correo sigue siendo {email}.
        </p>
      )}

      {open && (
        <fetcher.Form method="post" action="/cuenta" className="mt-3 flex max-w-sm flex-col gap-3">
          <input type="hidden" name="intent" value="change-email" />
          <div>
            <label htmlFor={`${uid}-new`} className="text-sm font-semibold text-carbon">
              Correo nuevo
            </label>
            <input
              id={`${uid}-new`}
              name="newEmail"
              type="email"
              required
              autoComplete="off"
              maxLength={160}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${uid}-pass`} className="text-sm font-semibold text-carbon">
              Tu contraseña actual
            </label>
            <PasswordField id={`${uid}-pass`} name="currentPassword" required autoComplete="current-password" inputClassName={inputClass} />
          </div>
          {result && !result.ok && (
            <p role="alert" className="text-sm font-semibold text-red-600">
              {result.error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60">
              {busy ? "Enviando…" : "Enviar enlace al correo nuevo"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={quietButton}>
              Cancelar
            </button>
          </div>
        </fetcher.Form>
      )}
    </section>
  );
}

function PasswordBlock() {
  const fetcher = useFetcher<Result>();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const busy = fetcher.state !== "idle";
  const result = fetcher.data?.savedIntent === "change-password" ? fetcher.data : null;
  const mismatch = confirm.length > 0 && next !== confirm;

  // Al cambiarla bien, el formulario se cierra y se limpia: no queda ninguna contraseña escrita en pantalla.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.savedIntent === "change-password") {
      setOpen(false);
      setNext("");
      setConfirm("");
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <section aria-label="Contraseña" className="mt-6 border-t border-carbon/10 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <p className="font-display font-bold text-carbon">Contraseña</p>
          <p className="mt-0.5 text-sm text-carbon/60">
            Al cambiarla, se cierran tus otras sesiones abiertas y te avisamos por correo.
          </p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className={quietButton}>
            Cambiar contraseña
          </button>
        )}
      </div>

      {result?.ok && !open && !busy && (
        <p role="status" className="mt-2 text-sm font-semibold text-bosque">
          Listo, tu contraseña quedó cambiada.
        </p>
      )}

      {open && (
        <fetcher.Form method="post" action="/cuenta" className="mt-3 flex max-w-sm flex-col gap-3">
          <input type="hidden" name="intent" value="change-password" />
          <div>
            <label htmlFor={`${uid}-current`} className="text-sm font-semibold text-carbon">
              Contraseña actual
            </label>
            <PasswordField
              id={`${uid}-current`}
              name="currentPassword"
              required
              autoComplete="current-password"
              inputClassName={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${uid}-new`} className="text-sm font-semibold text-carbon">
              Contraseña nueva
            </label>
            <PasswordField
              id={`${uid}-new`}
              name="newPassword"
              required
              minLength={8}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              inputClassName={inputClass}
            />
            <p className="mt-1 text-xs text-carbon/60">Mínimo 8 caracteres.</p>
          </div>
          <div>
            <label htmlFor={`${uid}-confirm`} className="text-sm font-semibold text-carbon">
              Repite la contraseña nueva
            </label>
            <PasswordField
              id={`${uid}-confirm`}
              name="confirmPassword"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={mismatch || undefined}
              inputClassName={inputClass}
            />
            {mismatch && <p className="mt-1 text-xs font-semibold text-red-600">Las contraseñas no coinciden.</p>}
          </div>

          {result && !result.ok && (
            <p role="alert" className="text-sm font-semibold text-red-600">
              {result.error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy || mismatch}
              className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60"
            >
              {busy ? "Guardando…" : "Guardar contraseña"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setNext("");
                setConfirm("");
              }}
              className={quietButton}
            >
              Cancelar
            </button>
          </div>
        </fetcher.Form>
      )}
    </section>
  );
}
