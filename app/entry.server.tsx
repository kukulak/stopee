import { PassThrough } from "node:stream";
import type { ActionFunctionArgs, AppLoadContext, EntryContext, LoaderFunctionArgs } from "react-router";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { applySecurityHeaders } from "~/lib/securityHeaders.server";
import type { PixelIds } from "~/lib/integrations";
import { NonceContext } from "~/lib/nonce";
import { logError } from "~/lib/logger.server";

// React Router llama esto para cualquier error de servidor que NO sea un
// Response esperado (un 404 de "producto no encontrado" nunca llega aquí,
// solo excepciones de verdad) — sin un Sentry configurado, este es el único
// lugar donde nos enteramos de un error real de producción, así que queda
// en un formato fácil de buscar en los logs del hosting.
export function handleError(error: unknown, { request }: LoaderFunctionArgs | ActionFunctionArgs) {
  if (request.signal.aborted) return;
  logError("loader-or-action", error, { url: request.url, method: request.method });
}

declare module "react-router" {
  interface AppLoadContext {
    /** Generado por servidor en server.js, uno distinto por cada request — ver app/lib/securityHeaders.server.ts. */
    nonce: string;
  }
}

const ABORT_DELAY = 5_000;
// React Router corta también los datos que aún envía por partes pasado este tiempo.
export const streamTimeout = ABORT_DELAY;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: AppLoadContext,
) {
  const nonce = typeof loadContext?.nonce === "string" ? loadContext.nonce : "";
  // La política de seguridad abre solo los dominios de las herramientas configuradas; los IDs son los
  // mismos que el layout raíz usa para encenderlas, así que ambos siempre coinciden. Sin esos datos
  // (una página de error, un 404) no se abre ninguno.
  const rootData = routerContext.staticHandlerContext?.loaderData?.root as { pixelIds?: PixelIds } | undefined;
  applySecurityHeaders(responseHeaders, nonce, new URL(request.url).pathname, rootData?.pixelIds ?? {});

  return isbot(request.headers.get("user-agent") || "")
    ? handleBotRequest(request, responseStatusCode, responseHeaders, routerContext, nonce)
    : handleBrowserRequest(request, responseStatusCode, responseHeaders, routerContext, nonce);
}

function handleBotRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  nonce: string,
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      <NonceContext.Provider value={nonce}>
        <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
      </NonceContext.Provider>,
      {
        nonce,
        onAllReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            logError("render-stream", error, { url: request.url });
          }
        },
      },
    );
    setTimeout(abort, ABORT_DELAY);
  });
}

function handleBrowserRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  nonce: string,
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      <NonceContext.Provider value={nonce}>
        <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
      </NonceContext.Provider>,
      {
        nonce,
        // Se espera a que todo esté listo en vez de enviar el "cascarón" primero.
        // Con envío por partes, React manda el final de la página DESPUÉS de
        // </html>; Cloudflare reescribe el HTML en el camino y dejaba un "$"
        // visible al pie de la página. Los datos ya vienen resueltos del loader,
        // así que esperar no retrasa nada.
        onAllReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            logError("render-stream", error, { url: request.url });
          }
        },
      },
    );
    setTimeout(abort, ABORT_DELAY);
  });
}
