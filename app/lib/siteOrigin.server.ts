/**
 * Dirección pública del sitio (https://stopee.com.mx), para canonical, vistas previas al
 * compartir, datos para Google, sitemap y robots.
 *
 * No sale de la petición: detrás de Cloudflare la petición llega con la dirección
 * interna de Cloud Run (y por http), y eso terminaba anunciándose como si fuera el sitio.
 * Se usa APP_URL, que ya es la fuente de Stripe y de los correos; solo si falta
 * (desarrollo local) se cae a la de la petición.
 */
export function siteOrigin(request: Request): string {
  const configured = process.env.APP_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // APP_URL mal escrita: se usa la de la petición en vez de romper la página.
    }
  }
  return new URL(request.url).origin;
}
