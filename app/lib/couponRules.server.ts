import { OrderModel } from "~/models/order.server";
import { couponNeedsAccount, mxn, type CouponRules } from "~/lib/couponRules";

/**
 * Reglas de un cupón más allá del código y el porcentaje. Todas son opcionales:
 * un cupón sin reglas funciona como siempre. Se evalúan en tres momentos —al
 * aplicar el código (solo las de identidad), cada vez que se muestra el carrito
 * y al pagar— con esta misma función, para que lo que ve el cliente coincida
 * con lo que se cobra.
 */

export type CouponPromoLike = { _id: unknown; coupon?: CouponRules | null };

export type CouponContext = {
  lines: { sku: string; quantity: number; unitPriceMxn: number }[];
  user: { _id: unknown; email: string; individualPurchaseCount?: number | null; emailVerifiedAt?: Date | null } | null;
  /** Nombre legible de un SKU, para los mensajes ("Agrega Concentrado 1L…"). */
  nameBySku?: Map<string, string>;
};

export type CouponEligibility =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      /** "login": hace falta iniciar sesión · "verify": falta confirmar el correo · "identity": esta cuenta no califica · "cart": el carrito aún no cumple. */
      kind: "login" | "verify" | "identity" | "cart";
    };

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `scope: "identity"` revisa solo quién es el cliente (al escribir el código el
 * carrito puede estar vacío todavía); `"all"` revisa también el carrito.
 */
export async function checkCouponEligibility(
  promo: CouponPromoLike,
  ctx: CouponContext,
  scope: "identity" | "all" = "all",
): Promise<CouponEligibility> {
  const rules = promo.coupon;
  if (!rules) return { ok: true };

  if (couponNeedsAccount(rules) && !ctx.user) {
    return { ok: false, kind: "login", reason: "Inicia sesión para usar este cupón." };
  }

  if (ctx.user) {
    const email = ctx.user.email.trim().toLowerCase();

    if (rules.allowedEmails && rules.allowedEmails.length > 0) {
      // Un cupón para correos específicos solo vale si el correo de la cuenta está
      // confirmado: si no, cualquiera podría registrarse con el correo de otra persona.
      if (!ctx.user.emailVerifiedAt) {
        return { ok: false, kind: "verify", reason: "Confirma tu correo para usar este cupón. Te enviamos un enlace al registrarte." };
      }
      const allowed = rules.allowedEmails.map((e) => e.trim().toLowerCase());
      if (!allowed.includes(email)) {
        return { ok: false, kind: "identity", reason: "Este cupón no está disponible para tu cuenta." };
      }
    }

    if (rules.firstPurchaseOnly && (ctx.user.individualPurchaseCount ?? 0) > 0) {
      return { ok: false, kind: "identity", reason: "Este cupón es solo para tu primera compra." };
    }

    if (rules.oncePerCustomer) {
      const used = await OrderModel.exists({
        "promotion.id": promo._id,
        status: { $nin: ["cancelled", "refunded"] },
        $or: [{ user: ctx.user._id }, { email: new RegExp(`^${escapeRegex(email)}$`, "i") }],
      });
      if (used) {
        return { ok: false, kind: "identity", reason: "Ya usaste este cupón. Es de un solo uso por cliente." };
      }
    }
  }

  if (scope === "identity") return { ok: true };

  const subtotal = ctx.lines.reduce((sum, l) => sum + l.unitPriceMxn * l.quantity, 0);
  const units = ctx.lines.reduce((sum, l) => sum + l.quantity, 0);

  if (rules.requiredSkus && rules.requiredSkus.length > 0) {
    const required = rules.requiredSkus;
    if (!ctx.lines.some((l) => required.includes(l.sku))) {
      const names = required.map((sku) => ctx.nameBySku?.get(sku) ?? sku);
      return {
        ok: false,
        kind: "cart",
        reason:
          names.length === 1
            ? `Este cupón aplica al llevar ${names[0]}. Agrégalo a tu carrito para activarlo.`
            : `Este cupón aplica al llevar ${names.slice(0, -1).join(", ")} o ${names[names.length - 1]}. Agrega uno a tu carrito para activarlo.`,
      };
    }
  }

  if (rules.minSpendMxn && subtotal < rules.minSpendMxn) {
    return {
      ok: false,
      kind: "cart",
      reason: `Te faltan ${mxn(rules.minSpendMxn - subtotal)} para activar este cupón (compra mínima ${mxn(rules.minSpendMxn)}).`,
    };
  }

  if (rules.minQuantity && units < rules.minQuantity) {
    const missing = rules.minQuantity - units;
    return {
      ok: false,
      kind: "cart",
      reason: `Agrega ${missing} ${missing === 1 ? "pieza más" : "piezas más"} para activar este cupón (mínimo ${rules.minQuantity}).`,
    };
  }

  return { ok: true };
}
