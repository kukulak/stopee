/**
 * Los descuentos de un pedido no se juntan: de todos los que le tocan al cliente se aplica el que más le
 * conviene. Esta es la regla pura (sin base de datos) para poder probarla y usarla igual en el carrito y al pagar.
 */

export type DiscountSource = "coupon" | "auto" | "requirement" | "loyalty";

/** Si dos descuentos empatan, gana el que el cliente eligió escribiendo, luego el que se aplica solo. */
const TIE_ORDER: Record<DiscountSource, number> = { coupon: 0, auto: 1, requirement: 2, loyalty: 3 };

export function pickBestDiscount<T extends { source: DiscountSource; percent: number }>(candidates: T[]): T | null {
  const valid = candidates.filter((c) => Number.isFinite(c.percent) && c.percent > 0);
  valid.sort((a, b) => b.percent - a.percent || TIE_ORDER[a.source] - TIE_ORDER[b.source]);
  return valid[0] ?? null;
}
