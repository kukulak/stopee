import { PRODUCTS, type ProductSku } from "~/data/products";
import { PromotionModel } from "~/models/promotion.server";

export type EngineCartLine = { sku: ProductSku; quantity: number };

export type RequirementMatch = {
  id: string;
  name: string;
  rewardDiscountPercentage?: number;
  rewardGiftSku?: ProductSku;
};

/**
 * Evalúa las promociones "por requisito" activas contra el carrito actual y
 * regresa la primera que aplique (la más recientemente actualizada gana si
 * hay varias). A diferencia del resto de tipos de promoción (que hasta ahora
 * solo se configuran para mostrarse en el banner), esta sí se aplica de
 * verdad en /tienda y en el checkout — ver api.checkout.tsx y tienda.tsx.
 */
export async function evaluateRequirementPromotion(
  cartLines: EngineCartLine[],
  isFirstPurchase: boolean,
): Promise<RequirementMatch | null> {
  const now = new Date();
  const promos = await PromotionModel.find({
    type: "by_requirement",
    isActive: true,
    $and: [
      { $or: [{ startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: { $exists: false } }, { endsAt: { $gte: now } }] },
    ],
  })
    .sort({ updatedAt: -1 })
    .lean();

  for (const promo of promos) {
    const req = promo.byRequirement;
    if (!req) continue;

    let matches = false;
    if (req.condition === "first_purchase") {
      matches = isFirstPurchase;
    } else if (req.condition === "product_in_cart") {
      const line = cartLines.find((l) => l.sku === req.targetSku);
      matches = Boolean(line && line.quantity >= (req.minQuantity ?? 1));
    } else if (req.condition === "product_spend") {
      const line = cartLines.find((l) => l.sku === req.targetSku);
      const unitPrice = line ? PRODUCTS[line.sku]?.priceMxn ?? 0 : 0;
      const spend = line ? unitPrice * line.quantity : 0;
      matches = spend >= (req.minSpendMxn ?? 0);
    }

    if (matches) {
      const rewardGiftSku =
        req.rewardGiftSku && req.rewardGiftSku in PRODUCTS ? (req.rewardGiftSku as ProductSku) : undefined;
      return {
        id: String(promo._id),
        name: promo.name,
        rewardDiscountPercentage: req.rewardDiscountPercentage ?? undefined,
        rewardGiftSku,
      };
    }
  }

  return null;
}
