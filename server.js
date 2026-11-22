import { createRequestHandler } from "@remix-run/express";
import { randomBytes } from "node:crypto";
import express from "express";
import * as build from "./build/server/index.js";

// Servidor de producción a la medida (en vez de `remix-serve` tal cual):
// necesitamos generar un nonce distinto por cada request para poder tener un
// Content-Security-Policy estricto en script-src (ver
// app/lib/securityHeaders.server.ts) — remix-serve no da un lugar para
// engancharse antes de cada respuesta y generar ese valor.
const app = express();
app.disable("x-powered-by");

// Páginas con datos personales o del panel (y sus peticiones de datos, como
// /cuenta.data): nunca deben quedar en una caché compartida como la de
// Cloudflare, o un visitante podría recibir la página de otra persona.
app.use((req, res, next) => {
  if (/^\/(cuenta|admin|acceso-privado|gracias)(\/|\.|$)/.test(req.path)) {
    res.set("Cache-Control", "private, no-store");
  }
  next();
});

// Envíos (POST, etc.) que declaran venir de OTRO sitio se rechazan aquí, antes de
// llegar a ninguna ruta. Los navegadores siempre mandan `Origin` en un envío, y no
// lo pueden falsear desde la página de un tercero. Las peticiones sin `Origin`
// (herramientas, servidores) pasan: la protección de las cuentas es la cookie
// SameSite=Lax, y esto es una segunda barrera. El webhook de Stripe llega sin `Origin`.
const OWN_HOSTS = new Set(["stopee.com.mx", "www.stopee.com.mx"]);
try {
  if (process.env.APP_URL) OWN_HOSTS.add(new URL(process.env.APP_URL).host.toLowerCase());
} catch {
  // APP_URL mal escrita: se queda solo con los hosts propios.
}
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.get("origin");
  if (!origin) return next();

  let host = null;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    // "null" u otro valor que no es una dirección: se rechaza abajo.
  }
  const requestHost = (req.get("x-forwarded-host") ?? req.get("host") ?? "").split(",")[0].trim().toLowerCase();
  const isLocalDev =
    process.env.NODE_ENV !== "production" && host !== null && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

  if (host && (OWN_HOSTS.has(host) || host === requestHost || isLocalDev)) return next();

  console.warn(JSON.stringify({ level: "warn", context: "request.foreign-origin", method: req.method, path: req.path, origin }));
  res.status(403).type("text/plain").send("No pudimos verificar el origen de la solicitud.");
});

app.use(
  "/assets",
  express.static("build/client/assets", { immutable: true, maxAge: "1y" }),
);
app.use(express.static("build/client", { maxAge: "1h" }));

app.all(
  "*",
  createRequestHandler({
    build,
    getLoadContext(_req, res) {
      const nonce = randomBytes(16).toString("base64");
      res.locals.nonce = nonce;
      return { nonce };
    },
  }),
);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`STOPee escuchando en http://localhost:${port}`);
});
