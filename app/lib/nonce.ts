import { createContext, useContext } from "react";

/**
 * El nonce del CSP tiene que llegar a los <script>/<ScrollRestoration> del
 * root incluso cuando NINGUNA ruta hace match (un 404 real de una URL que no
 * existe) — en ese caso el loader del root nunca corre, así que no se puede
 * sacar el nonce de ahí. Este contexto lo provee entry.server.tsx directo
 * desde loadContext (ver server.js), que sí está disponible siempre.
 */
export const NonceContext = createContext<string>("");

export function useNonce() {
  return useContext(NonceContext);
}
