import { useEffect, useState } from "react";

/**
 * Cuenta cuántas veces el navegador devolvió esta página desde su memoria al
 * usar el botón «atrás» (bfcache). Ese regreso congela la página tal como se
 * dejó: un botón que decía «Redirigiendo al pago…» sigue diciéndolo y apagado,
 * aunque la persona ya volvió. Quien lo use cambia de `key` en sus `useFetcher`
 * cuando este número sube, y el formulario vuelve a estar listo sin perder lo
 * que ya se había escrito.
 */
export function usePageShowReset(): number {
  const [restores, setRestores] = useState(0);

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setRestores((count) => count + 1);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return restores;
}
