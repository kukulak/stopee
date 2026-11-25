/**
 * Validaciones de texto que el admin captura y que luego se insertan en la
 * página (scripts de rastreo, destinos de botones). Sin sufijo ".server": se
 * usan también al renderizar, para no confiar en lo que ya estaba guardado.
 */

/** ID de Google (Analytics / Ads / Tag Manager): G-XXXXXXXXXX, AW-123456789, GTM-XXXXXXX. */
export function isValidGooglePixelId(value: string): boolean {
  return /^[A-Z]{1,3}-[A-Z0-9]{4,20}$/.test(value);
}

/** ID de píxel de TikTok: letras mayúsculas y números (por ejemplo "C4ABCDEFGHIJ1234567"). */
export function isValidTikTokPixelId(value: string): boolean {
  return /^[A-Z0-9]{10,30}$/.test(value);
}

/** ID de píxel de Meta: solo dígitos. */
export function isValidMetaPixelId(value: string): boolean {
  return /^\d{8,20}$/.test(value);
}

/**
 * Destino de un botón o banner: una ruta del propio sitio ("/tienda",
 * "/blog/mi-articulo#parte") o una dirección https completa. Devuelve null si
 * no es válido: esquemas como "javascript:" o "data:" nunca pasan.
 */
export function normalizeLinkTarget(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return null;
  if (value.startsWith("/")) {
    return value.startsWith("//") || value.startsWith("/\\") ? null : value;
  }
  if (value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Para mostrar: el destino si es válido, y si no, el de respaldo. */
export function linkTargetOr(raw: string | null | undefined, fallback = "/tienda"): string {
  return normalizeLinkTarget(raw) ?? fallback;
}

export const LINK_TARGET_ERROR =
  'El destino del botón debe ser una ruta de este sitio (por ejemplo "/tienda") o una dirección que empiece con https://.';
