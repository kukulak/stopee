/**
 * Content-Security-Policy con nonce por request: script-src es estricto (sin
 * 'unsafe-inline') y solo permite los scripts inline que traigan el nonce
 * correcto — así una inyección de HTML no puede ejecutar JS arbitrario aunque
 * encuentre un hueco (XSS reflejado, un campo sin sanitizar, etc.).
 *
 * style-src sí lleva 'unsafe-inline': el sitio usa `style={{...}}` calculado
 * en runtime en varios componentes (los remolinos de fondo, el logo
 * editable) — los nonces de CSP no cubren el atributo `style` de un elemento
 * (solo bloques <style> y scripts), así que bloquear inline styles habría
 * roto el layout. Es un riesgo mucho menor que permitir scripts inline: css
 * inyectado no puede ejecutar código.
 */
export function buildContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com https://connect.facebook.net https://analytics.tiktok.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "media-src 'self' https://storage.googleapis.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.facebook.com https://analytics.tiktok.com https://analytics-ipv6.tiktokw.us",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Aplica todas las cabeceras de seguridad a una respuesta de documento. */
export function applySecurityHeaders(headers: Headers, nonce: string, pathname = ""): void {
  // Páginas con datos personales o del panel: nunca deben guardarse en una caché
  // compartida (Cloudflare, un proxy). Si alguien activara "Cache Everything",
  // un cliente podría recibir la página de otro, con su sesión.
  if (/^\/(cuenta|admin|acceso-privado|gracias)(\/|$)/.test(pathname)) {
    headers.set("Cache-Control", "private, no-store");
  }

  // `npm run dev` (Vite) no pasa por server.js, así que no hay quien genere
  // un nonce real — sin este chequeo se mandaba un CSP con 'nonce-' vacío
  // que bloqueaba hasta los propios scripts de hidratación de Remix en
  // desarrollo local. Sin nonce, no hay CSP; en producción (node server.js)
  // siempre hay uno.
  if (nonce) {
    headers.set("Content-Security-Policy", buildContentSecurityPolicy(nonce));
  }
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // HSTS solo tiene sentido si de verdad se sirve por HTTPS (en dev local
  // por HTTP sería un header vacío de contenido, y podría confundir).
  if (process.env.NODE_ENV === "production") {
    headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
}
