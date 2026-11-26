/**
 * Lo que necesita el navegador de un banner (sin ".server": lo usan los componentes). Cómo se leen
 * de la base de datos está en ~/lib/heroBanner.server.
 */

export type HeroBanner = {
  text: string;
  /** Frase de apoyo bajo el título (solo la usa el banner de la portada). */
  subtitle: string;
  imageUrl: string | null;
  imageAlt: string;
  ctaText: string;
  /**
   * A dónde lleva el botón o, en un banner solo imagen, toda la imagen. Vacío = sin enlace. Un banner con
   * botón siempre tiene destino (cae a /tienda si el guardado no es válido).
   */
  ctaHref: string;
};

/** ¿Es un banner solo imagen (sin texto ni botón)? Entonces la imagen entera es lo que se puede pulsar. */
export function isImageOnlyBanner(banner: Pick<HeroBanner, "text" | "subtitle" | "ctaText" | "imageUrl">): boolean {
  return Boolean(banner.imageUrl) && !banner.text && !banner.subtitle && !banner.ctaText;
}
