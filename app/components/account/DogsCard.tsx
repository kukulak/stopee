import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { CloseIcon, PawIcon } from "~/components/ui/Icons";

type Dog = { name: string; birthday: string };
/** Cada renglón lleva su propia llave: así, al quitar uno del medio, los demás conservan lo que ya escribieron. */
type Row = Dog & { key: number };
type DogsResult = { ok: boolean; error: string | null; savedIntent: string | null };

const MAX_DOGS = 8;
const inputClass =
  "min-h-11 rounded-xl border border-carbon/15 bg-white px-4 text-base text-carbon focus:border-oliva focus:outline-none sm:text-sm";

/** «2024-03-12» → «12 de marzo». Con mediodía fijo para que la zona horaria no mueva el día. */
function birthdayLabel(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}

/**
 * «Mis perritos»: lo más importante para esta gente, con su propia sección y tarjetas grandes con el nombre y el
 * cumpleaños de cada uno.
 */
export function DogsCard({ dogs }: { dogs: Dog[] }) {
  const fetcher = useFetcher<DogsResult>();
  const [editing, setEditing] = useState(false);
  const nextKey = useRef(0);
  const withKey = (dog: Dog): Row => ({ ...dog, key: nextKey.current++ });
  const [rows, setRows] = useState<Row[]>([]);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data?.savedIntent === "update-dogs" ? fetcher.data : null;

  // Al guardar bien, la tarjeta vuelve a su vista normal con los perritos ya actualizados.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.savedIntent === "update-dogs") setEditing(false);
  }, [fetcher.state, fetcher.data]);

  function startEditing() {
    setRows((dogs.length > 0 ? dogs : [{ name: "", birthday: "" }]).map(withKey));
    setEditing(true);
  }

  const savedNow = result?.ok && !editing && !busy;

  return (
    <div className="rounded-3xl border border-carbon/10 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="font-display text-xl font-black text-carbon">Mis perritos</h2>
          <p className="mt-1 text-sm text-carbon/60">Cuéntanos quiénes son y cuándo cumplen años.</p>
        </div>
        {!editing && dogs.length > 0 && (
          <button
            type="button"
            onClick={startEditing}
            className="min-h-11 shrink-0 rounded-full border border-carbon/15 px-5 text-sm font-semibold text-carbon hover:border-carbon/30"
          >
            Editar
          </button>
        )}
      </div>

      {savedNow && (
        <p role="status" className="mt-3 text-sm font-semibold text-bosque">
          Listo, guardamos a tus perritos.
        </p>
      )}

      {!editing ? (
        <>
          {dogs.length === 0 ? (
            <div className="mt-5 flex flex-col items-start gap-3 rounded-2xl bg-lima/15 p-5">
              <PawIcon className="h-9 w-9 text-bosque" />
              <p className="font-display text-lg font-black text-carbon">¿Cómo se llama tu perrito?</p>
              <p className="text-sm text-carbon/70">Agrégalo y te saludamos por su nombre.</p>
              <button
                type="button"
                onClick={startEditing}
                className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso hover:bg-carbon/90"
              >
                Agregar a mi perrito
              </button>
            </div>
          ) : (
            <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {dogs.map((dog, i) => (
                <li key={`${dog.name}-${i}`} className="flex items-center gap-4 rounded-2xl bg-lima/15 p-5">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-lima/50 text-bosque">
                    <PawIcon className="h-8 w-8" />
                  </span>
                  <div className="min-w-0">
                    <p className="break-words font-display text-2xl font-black leading-tight text-carbon">{dog.name}</p>
                    <p className="text-sm text-carbon/60">
                      {dog.birthday && birthdayLabel(dog.birthday) ? `Cumple el ${birthdayLabel(dog.birthday)}` : "Sin fecha de cumpleaños"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

        </>
      ) : (
        <fetcher.Form method="post" action="/cuenta" className="mt-5 flex flex-col gap-5">
          <input type="hidden" name="intent" value="update-dogs" />

          <div>
            <div className="flex flex-col gap-2">
              {rows.map((dog) => (
                <div key={dog.key} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-0 flex-1 basis-40">
                    <label htmlFor={`dog-name-${dog.key}`} className="text-sm font-semibold text-carbon">
                      Nombre
                    </label>
                    <input
                      id={`dog-name-${dog.key}`}
                      name="mascota"
                      autoComplete="off"
                      maxLength={40}
                      defaultValue={dog.name}
                      placeholder="Cómo se llama"
                      className={`mt-1 w-full ${inputClass}`}
                    />
                  </div>
                  <div>
                    <label htmlFor={`dog-birthday-${dog.key}`} className="text-sm font-semibold text-carbon">
                      Cumpleaños <span className="font-normal text-carbon/50">(opcional)</span>
                    </label>
                    <input
                      id={`dog-birthday-${dog.key}`}
                      name="dogBirthday"
                      type="date"
                      defaultValue={dog.birthday}
                      className={`mt-1 block ${inputClass}`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setRows((current) => current.filter((row) => row.key !== dog.key))}
                    aria-label={`Quitar a ${dog.name || "este perrito"}`}
                    className="min-h-11 min-w-11 rounded-full text-carbon/40 hover:text-carbon"
                  >
                    <CloseIcon className="mx-auto block h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            {rows.length < MAX_DOGS && (
              <button
                type="button"
                onClick={() => setRows((current) => [...current, withKey({ name: "", birthday: "" })])}
                className="mt-2 min-h-11 text-sm font-semibold text-bosque hover:underline"
              >
                + Agregar otro perrito
              </button>
            )}
          </div>

          {result && !result.ok && (
            <p role="alert" className="text-sm font-semibold text-red-600">
              {result.error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60">
              {busy ? "Guardando…" : "Guardar perritos"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="min-h-11 rounded-full border border-carbon/15 px-5 text-sm font-semibold text-carbon hover:border-carbon/30"
            >
              Cancelar
            </button>
          </div>
        </fetcher.Form>
      )}
    </div>
  );
}
