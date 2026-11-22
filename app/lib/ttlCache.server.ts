/**
 * Caché de un solo valor con vencimiento corto, para documentos de
 * configuración que el layout raíz lee en CADA petición (ajustes, textos
 * legales, popup, auto-envío, acceso privado). Sin esto, cada visita pagaba
 * 4-5 consultas a Mongo antes de pintar nada.
 *
 * Quien guarda un cambio llama a `clear()` para que el siguiente visitante vea
 * lo nuevo de inmediato; si el cambio se hiciera directo en la base, tardaría
 * como máximo `ttlMs` en notarse. Los valores devueltos se comparten entre
 * peticiones: quien los usa debe tratarlos como solo lectura.
 */
export function createTtlCache<T>(ttlMs = 30_000) {
  let value: T | undefined;
  let expiresAt = 0;
  let pending: Promise<T> | undefined;

  return {
    async get(load: () => Promise<T>): Promise<T> {
      if (value !== undefined && Date.now() < expiresAt) return value;
      // Varias peticiones simultáneas comparten la misma carga.
      pending ??= load()
        .then((loaded) => {
          value = loaded;
          expiresAt = Date.now() + ttlMs;
          return loaded;
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
    clear() {
      value = undefined;
      expiresAt = 0;
      pending = undefined;
    },
  };
}
