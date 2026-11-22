import { RemixBrowser } from "@remix-run/react";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { NonceContext } from "~/lib/nonce";

// El nonce solo importa para el CSP de la respuesta SSR inicial — el cliente
// no necesita uno real (ver app/lib/nonce.ts).
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <NonceContext.Provider value="">
        <RemixBrowser />
      </NonceContext.Provider>
    </StrictMode>,
  );
});
