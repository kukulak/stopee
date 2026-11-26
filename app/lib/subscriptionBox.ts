/**
 * La caja del Club se arma en /tienda y se termina en /suscripcion. Lo único que
 * viaja entre las dos páginas son productos, cantidades y frecuencia, en la
 * dirección: `/suscripcion?caja=SKU-A:2,SKU-B:1&frecuencia=4-semanas`. Nunca
 * datos personales. Quien recibe la caja la vuelve a validar contra el catálogo
 * real (precios, existencia, si el producto es apto para auto-envío).
 */

export type BoxLine = { sku: string; quantity: number };

const MAX_LINES = 20;
const MAX_QUANTITY = 99;

/** Convierte las cantidades elegidas en el texto del parámetro `caja` ("SKU:2,SKU:1"). Vacío si no hay nada. */
export function buildBoxParam(quantities: Record<string, number>): string {
  return Object.entries(quantities)
    .filter(([sku, quantity]) => quantity > 0 && !/[,:]/.test(sku))
    .map(([sku, quantity]) => `${sku}:${Math.min(MAX_QUANTITY, Math.floor(quantity))}`)
    .join(",");
}

/**
 * Lee el parámetro `caja` (ya decodificado por la dirección). Descarta todo lo que
 * no sea un SKU de `allowedSkus` (productos aptos para auto-envío) con cantidad
 * entera de 1 a 99, y nunca repite un SKU. Un parámetro roto o manipulado da una
 * caja vacía, no un error.
 */
export function parseBoxParam(raw: string | null | undefined, allowedSkus: Iterable<string>): BoxLine[] {
  if (!raw || raw.length > 500) return [];
  const allowed = new Set(allowedSkus);
  const seen = new Set<string>();
  const lines: BoxLine[] = [];

  for (const part of raw.split(",").slice(0, MAX_LINES)) {
    const cut = part.lastIndexOf(":");
    if (cut <= 0) continue;
    const sku = part.slice(0, cut);
    const quantity = Number(part.slice(cut + 1));
    if (!allowed.has(sku) || seen.has(sku)) continue;
    if (!Number.isInteger(quantity) || quantity < 1) continue;
    seen.add(sku);
    lines.push({ sku, quantity: Math.min(MAX_QUANTITY, quantity) });
  }
  return lines;
}

/** La dirección de /suscripcion con la caja y la frecuencia elegidas. */
export function subscriptionPageUrl(quantities: Record<string, number>, frequency: string): string {
  const params = new URLSearchParams();
  const box = buildBoxParam(quantities);
  if (box) params.set("caja", box);
  if (frequency) params.set("frecuencia", frequency);
  const query = params.toString();
  return `/suscripcion${query ? `?${query}` : ""}`;
}
