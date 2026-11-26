/**
 * Piezas de las reglas de cupón que no tocan la base de datos, para poder usarlas
 * también en el navegador (lista del admin). La evaluación real vive en
 * couponRules.server.ts.
 */

export type CouponRules = {
  oncePerCustomer?: boolean | null;
  allowedEmails?: string[] | null;
  firstPurchaseOnly?: boolean | null;
  minSpendMxn?: number | null;
  minQuantity?: number | null;
  requiredSkus?: string[] | null;
  stackable?: boolean | null;
  /** Para clientes normales. Vacío (cupones anteriores) = sí. */
  forCustomers?: boolean | null;
  /** Para Puntos de Recarga (aliados). Vacío (cupones anteriores) = sí. */
  forAllies?: boolean | null;
};

/**
 * ¿Puede usar este cupón quien compra? Un aliado usa los cupones marcados «para aliados» y un cliente
 * normal los marcados «para clientes»; si están los dos, es para todos. Un campo vacío (cupón anterior
 * a esta opción) cuenta como «sí», para que nada de lo que ya existe cambie de pronto.
 */
export function couponAudienceAllows(rules: CouponRules | null | undefined, buyerIsAlly: boolean): boolean {
  if (!rules) return true;
  return buyerIsAlly ? rules.forAllies !== false : rules.forCustomers !== false;
}

export const mxn = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;

export function couponNeedsAccount(rules: CouponRules | null | undefined): boolean {
  return Boolean(
    rules &&
      (rules.oncePerCustomer ||
        rules.firstPurchaseOnly ||
        // Un cupón solo para aliados: sin sesión no hay forma de saber si quien compra lo es.
        rules.forCustomers === false ||
        (rules.allowedEmails && rules.allowedEmails.length > 0)),
  );
}

/** Dos descuentos en porcentaje aplicados uno tras otro: 10% y 15% dan 23.5% (se redondea), no 25%. */
export function stackPercents(a: number, b: number): number {
  return Math.min(100, Math.round(100 - ((100 - a) * (100 - b)) / 100));
}

/** Resumen corto de las reglas de un cupón, para la lista del admin. */
export function describeCouponRules(rules: CouponRules | null | undefined): string[] {
  if (!rules) return [];
  const out: string[] = [];
  if (rules.forCustomers === false) out.push("solo aliados");
  else if (rules.forAllies === false) out.push("solo clientes");
  if (rules.oncePerCustomer) out.push("1 uso por cliente");
  if (rules.firstPurchaseOnly) out.push("solo primera compra");
  if (rules.allowedEmails?.length) {
    out.push(`${rules.allowedEmails.length} ${rules.allowedEmails.length === 1 ? "correo" : "correos"}`);
  }
  if (rules.minSpendMxn) out.push(`mín. ${mxn(rules.minSpendMxn)}`);
  if (rules.minQuantity) out.push(`mín. ${rules.minQuantity} pzas`);
  if (rules.requiredSkus?.length) {
    out.push(`requiere ${rules.requiredSkus.length === 1 ? "1 producto" : `1 de ${rules.requiredSkus.length} productos`}`);
  }
  if (rules.stackable) out.push("se suma a lealtad");
  return out;
}
