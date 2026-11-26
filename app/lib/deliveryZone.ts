/**
 * Zona de entrega: qué códigos postales atiende la tienda. Es pura (sin base de
 * datos) a propósito: la usan el carrito en el navegador, el servidor al cobrar y
 * el panel de administración, y las tres tienen que decidir exactamente igual.
 *
 * Los rangos se guardan como texto ("01000-16999, 52000-52999") para que el
 * negocio los edite en /admin/shipping sin tocar el código.
 */

export type PostalRange = { from: number; to: number };

export type DeliveryZone = {
  /** Cómo se llama la zona ante el cliente y, también, el estado que lleva la dirección ("Ciudad de México"). */
  name: string;
  /** Rangos de código postal en texto, tal como los escribe el admin. */
  postalRanges: string;
};

/** Ciudad de México: de 01000 a 16999. Es lo que se atiende en el lanzamiento. */
export const DEFAULT_DELIVERY_ZONE: DeliveryZone = {
  name: "Ciudad de México",
  postalRanges: "01000-16999",
};

/**
 * Acepta 4 o 5 dígitos (muchos escriben "3100" por "03100") y devuelve siempre
 * 5. Con cualquier otra cosa devuelve null.
 */
export function normalizePostalCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.trim();
  if (!/^\d{4,5}$/.test(digits)) return null;
  return digits.padStart(5, "0");
}

/**
 * Lee "01000-16999, 52000" (comas, punto y coma o saltos de línea). Un código
 * suelto vale como un rango de uno. Si algo no se entiende devuelve el error en
 * lenguaje claro para mostrarlo en el panel.
 */
export function parsePostalRanges(text: string): { ranges: PostalRange[]; error: string | null } {
  const parts = text
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { ranges: [], error: "Escribe al menos un código postal o un rango, por ejemplo 01000-16999." };
  }

  const ranges: PostalRange[] = [];
  for (const part of parts) {
    const match = part.match(/^(\d{4,5})\s*(?:-|–|—|a)?\s*(\d{4,5})?$/);
    const from = match ? normalizePostalCode(match[1]) : null;
    const to = match ? (match[2] ? normalizePostalCode(match[2]) : from) : null;
    if (!from || !to) {
      return { ranges: [], error: `No entendí "${part}". Usa códigos de 5 dígitos, por ejemplo 01000-16999.` };
    }
    if (Number(from) > Number(to)) {
      return { ranges: [], error: `En "${part}" el primer código es mayor que el segundo.` };
    }
    ranges.push({ from: Number(from), to: Number(to) });
  }
  return { ranges, error: null };
}

export function isPostalCodeInRanges(postalCode: string, ranges: PostalRange[]): boolean {
  const normalized = normalizePostalCode(postalCode);
  if (!normalized) return false;
  const value = Number(normalized);
  return ranges.some((range) => value >= range.from && value <= range.to);
}

/** Atajo para quien tiene la zona tal como se guarda. Una zona ilegible no deja entregar a nadie. */
export function isPostalCodeInZone(postalCode: string, zone: DeliveryZone): boolean {
  return isPostalCodeInRanges(postalCode, parsePostalRanges(zone.postalRanges).ranges);
}
