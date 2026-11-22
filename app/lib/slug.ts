/** Largo máximo recomendado para la dirección de un artículo (URLs cortas se leen y comparten mejor). */
export const SLUG_MAX_LENGTH = 80;

/**
 * Convierte texto libre en un slug: minúsculas, sin acentos, solo letras a-z,
 * números y guiones, sin guiones repetidos ni al inicio o al final. Con
 * `maxLength` corta en un guion para no dejar una palabra a medias.
 */
export function slugify(text: string, maxLength?: number): string {
  const slug = slugifyLive(text).replace(/-$/, "");
  if (!maxLength || slug.length <= maxLength) return slug;
  const cut = slug.slice(0, maxLength);
  const lastHyphen = cut.lastIndexOf("-");
  return (lastHyphen > maxLength * 0.5 ? cut.slice(0, lastHyphen) : cut).replace(/-$/, "");
}

/**
 * Igual que `slugify` pero conserva un guion final: sirve mientras la persona
 * escribe en el campo ("mi-" no debe perder el guion antes de la siguiente letra).
 */
export function slugifyLive(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-/, "");
}
