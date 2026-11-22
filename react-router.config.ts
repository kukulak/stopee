import type { Config } from "@react-router/dev/config";

// Con React Router 7 el renderizado en servidor y los antiguos "future flags" de Remix 2
// (single fetch, descubrimiento perezoso de rutas, etc.) ya son el comportamiento normal.
export default {
  ssr: true,
  // Protección contra envíos de formularios desde otros sitios: React Router rechaza un envío cuyo Origin
  // no coincide con la dirección que ve el servidor. Detrás de Cloudflare / Cloud Run la dirección que
  // llega al contenedor puede ser la interna (*.run.app) aunque el visitante use stopee.com.mx, así que
  // se declaran nuestros dominios como válidos (los mismos de OWN_HOSTS en server.js, que además revisa
  // el Origin de cualquier envío antes de llegar aquí).
  allowedActionOrigins: ["stopee.com.mx", "www.stopee.com.mx"],
} satisfies Config;
