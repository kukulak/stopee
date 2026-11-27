import type { getUser } from "~/lib/session.server";
import { checkCouponEligibility } from "~/lib/couponRules.server";
import { stackPercents } from "~/lib/couponRules";
import { pickBestDiscount, type DiscountSource } from "~/lib/discountChoice";
import { evaluateRequirementPromotion, type RequirementMatch } from "~/lib/promotionEngine.server";
import { findAutoApplyCoupons, findRedeemableCoupon } from "~/models/promotion.server";

export type AppliedPromotion = { id: string; name: string; type: string };

type Candidate = {
  source: DiscountSource;
  percent: number;
  label: string;
  promotion: AppliedPromotion;
  /** Gasta la recompensa de lealtad del cliente (solo si el cupón está marcado «se suma a lealtad»). */
  usesLoyaltyReward: boolean;
  /** Para el letrero del carrito: el nombre de la recompensa de lealtad que se sumó. */
  stackedLabel?: string;
};

export type CartDiscount = {
  /** 0 = sin descuento. */
  percent: number;
  label: string;
  promotion: AppliedPromotion | null;
  source: DiscountSource | null;
  usedLoyaltyReward: boolean;
  /** Regalo de una promoción por requisito (aparte del descuento: los regalos no compiten). */
  requirement: RequirementMatch | null;
  loyaltyGiftDescription?: string;
  /** El cupón escrito por el cliente que SÍ se está aplicando. */
  appliedCouponCode: string | null;
  /** El cupón escrito no se puede usar todavía (mínimo, producto requerido, sesión…). */
  couponProblem: { code: string; reason: string; kind: "login" | "verify" | "identity" | "cart" } | null;
  /** El cupón escrito sí es válido, pero otro descuento le conviene más al cliente. */
  couponBeaten: { code: string; percentage: number } | null;
  /** Una recompensa de lealtad en descuento que no se usó porque otro descuento era mejor: se guarda. */
  loyaltyKept: { percentage: number } | null;
};

type Viewer = Awaited<ReturnType<typeof getUser>>;

/**
 * Elige el descuento de un carrito. La usan el carrito (para mostrarlo) y el pago (para cobrarlo), así
 * nunca pueden diferir. Compiten el cupón escrito, los cupones que se aplican solos, la promoción por
 * requisito y la recompensa de lealtad; gana el de mayor porcentaje y no se suman, salvo que el cupón esté
 * marcado «se suma a lealtad». Los regalos no compiten: se entregan todos.
 */
export async function resolveCartDiscount(input: {
  lines: { sku: string; quantity: number; unitPriceMxn: number }[];
  user: Viewer;
  nameBySku: Map<string, string>;
  couponCode: string | null;
  /** Letrero especial para un cupón (p. ej. el beneficio del Acceso privado). */
  couponLabel?: (promotionId: string) => Promise<string | null>;
}): Promise<CartDiscount> {
  const { lines, user, nameBySku, couponCode } = input;
  const ctx = { lines, user, nameBySku };

  const pending = user?.loyaltyPendingReward;
  const loyaltyPercent = pending?.rewardType === "discount" ? pending.percentage ?? 0 : 0;
  const loyaltyName = pending?.promotionName ?? "Recompensa de lealtad";
  const loyaltyGiftDescription =
    pending?.rewardType === "gift" && pending.giftDescription ? pending.giftDescription : undefined;

  const candidates: Candidate[] = [];

  const addCoupon = async (
    promo: NonNullable<Awaited<ReturnType<typeof findRedeemableCoupon>>>,
    source: "coupon" | "auto",
  ) => {
    const base = promo.coupon?.percentage ?? 0;
    const stacks = Boolean(promo.coupon?.stackable) && loyaltyPercent > 0;
    const baseLabel =
      (source === "coupon" ? await input.couponLabel?.(String(promo._id)) : null) ??
      (source === "coupon" ? `Cupón ${promo.coupon?.code ?? ""}`.trim() : promo.name);
    candidates.push({
      source,
      percent: stacks ? stackPercents(base, loyaltyPercent) : base,
      label: baseLabel,
      promotion: { id: String(promo._id), name: promo.name, type: "coupon" },
      usesLoyaltyReward: stacks,
      stackedLabel: stacks ? loyaltyName : undefined,
    });
  };

  // 1) El cupón que escribió el cliente.
  let couponProblem: CartDiscount["couponProblem"] = null;
  let typed: { code: string; percentage: number; promotionId: string } | null = null;
  if (couponCode) {
    const promo = await findRedeemableCoupon(couponCode);
    if (promo?.coupon?.percentage) {
      const eligibility = await checkCouponEligibility(promo, ctx);
      if (eligibility.ok) {
        typed = { code: couponCode, percentage: promo.coupon.percentage, promotionId: String(promo._id) };
        await addCoupon(promo, "coupon");
      } else {
        couponProblem = { code: couponCode, reason: eligibility.reason, kind: eligibility.kind };
      }
    }
  }

  // 2) Los cupones que se aplican solos (sin escribir nada), si el carrito y la cuenta cumplen sus reglas.
  for (const promo of await findAutoApplyCoupons()) {
    if (typed && typed.promotionId === String(promo._id)) continue;
    if (!promo.coupon?.percentage) continue;
    if ((await checkCouponEligibility(promo, ctx)).ok) await addCoupon(promo, "auto");
  }

  // 3) La promoción por requisito (su regalo se entrega aparte).
  const isFirstPurchase = Boolean(user && user.individualPurchaseCount === 0);
  const requirement = await evaluateRequirementPromotion(lines, isFirstPurchase);
  if (requirement?.rewardDiscountPercentage) {
    candidates.push({
      source: "requirement",
      percent: requirement.rewardDiscountPercentage,
      label: requirement.name,
      promotion: { id: requirement.id, name: requirement.name, type: "by_requirement" },
      usesLoyaltyReward: false,
    });
  }

  // 4) La recompensa de lealtad ganada en una compra anterior (es solo para ESTA compra).
  if (loyaltyPercent > 0) {
    candidates.push({
      source: "loyalty",
      percent: loyaltyPercent,
      label: loyaltyName,
      promotion: {
        id: pending?.promotionId ? String(pending.promotionId) : "loyalty",
        name: pending?.promotionName ?? "Lealtad",
        type: "loyalty",
      },
      usesLoyaltyReward: true,
    });
  }

  const winner = pickBestDiscount(candidates);

  let promotion = winner?.promotion ?? null;
  // Un regalo sin descuento igual deja registrada su promoción, para medir su efectividad en el panel.
  if (!promotion && requirement?.rewardGiftSku) {
    promotion = { id: requirement.id, name: requirement.name, type: "by_requirement" };
  }

  return {
    percent: winner?.percent ?? 0,
    label: winner ? (winner.stackedLabel ? `${winner.label} + ${winner.stackedLabel}` : winner.label) : "",
    promotion,
    source: winner?.source ?? null,
    usedLoyaltyReward: Boolean(loyaltyGiftDescription) || Boolean(winner?.usesLoyaltyReward),
    requirement,
    loyaltyGiftDescription,
    appliedCouponCode: winner?.source === "coupon" && typed ? typed.code : null,
    couponProblem,
    couponBeaten: typed && winner?.source !== "coupon" ? { code: typed.code, percentage: typed.percentage } : null,
    loyaltyKept: loyaltyPercent > 0 && winner && !winner.usesLoyaltyReward ? { percentage: loyaltyPercent } : null,
  };
}
