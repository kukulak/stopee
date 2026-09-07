import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { PROMOTION_TYPES } from "~/data/promotionTypes";

export { PROMOTION_TYPES };
export type { PromotionType } from "~/data/promotionTypes";

const { Schema, model, models } = mongoose;

/**
 * Un solo modelo cubre varias estrategias de promoción. Cada tipo solo usa
 * su propio sub-objeto de configuración (el resto queda vacío) — evita
 * discriminadores de Mongoose, que añadirían complejidad sin necesidad real
 * para el volumen de promociones que maneja una tienda de este tamaño.
 */

const tierSchema = new Schema(
  { minSpendMxn: { type: Number, required: true, min: 0 }, percentage: { type: Number, required: true, min: 1, max: 100 } },
  { _id: false },
);

const bannerSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    text: { type: String, default: "", trim: true },
    imageUrl: { type: String, default: "", trim: true },
    ctaText: { type: String, default: "", trim: true },
    ctaHref: { type: String, default: "/tienda", trim: true },
  },
  { _id: false },
);

const promotionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: PROMOTION_TYPES, required: true },
    isActive: { type: Boolean, default: true },
    startsAt: { type: Date },
    endsAt: { type: Date },
    usageLimit: { type: Number, min: 0 },
    timesUsed: { type: Number, default: 0 },

    // --- Config específica por tipo (solo se llena la del `type` elegido) ---
    coupon: {
      code: { type: String, uppercase: true, trim: true },
      percentage: { type: Number, min: 1, max: 100 },
    },
    bogo: {
      buyQuantity: { type: Number, min: 1, default: 1 },
      getQuantity: { type: Number, min: 1, default: 1 },
      getDiscountPercentage: { type: Number, min: 1, max: 100, default: 100 },
      applicableSku: { type: String, trim: true },
    },
    freeGift: {
      minSpendMxn: { type: Number, min: 0 },
      giftProduct: { type: Schema.Types.ObjectId, ref: "Product" },
    },
    newCustomer: {
      percentage: { type: Number, min: 1, max: 100 },
    },
    tieredSpend: {
      tiers: { type: [tierSchema], default: [] },
    },
    custom: {
      percentage: { type: Number, min: 1, max: 100 },
      description: { type: String, trim: true, default: "" },
    },
    flashSale: {
      percentage: { type: Number, min: 1, max: 100 },
    },
    vipEarly: {
      percentage: { type: Number, min: 1, max: 100 },
      maxCustomers: { type: Number, min: 1 },
    },
    buyTogether: {
      productIds: { type: [Schema.Types.ObjectId], ref: "Product", default: [] },
      percentage: { type: Number, min: 1, max: 100 },
    },
    loyalty: {
      purchasesRequired: { type: Number, min: 2, default: 5 },
      percentage: { type: Number, min: 1, max: 100, default: 10 },
    },

    banner: { type: bannerSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export type PromotionDoc = InferSchemaType<typeof promotionSchema>;

export const PromotionModel =
  (models.Promotion as Model<PromotionDoc>) ?? model<PromotionDoc>("Promotion", promotionSchema);

const DEFAULT_LOYALTY = { purchasesRequired: 5, percentage: 10 };

/** Config de lealtad vigente — si no hay ninguna creada en el admin, usa el default histórico. */
export async function getActiveLoyaltyConfig() {
  const promo = await PromotionModel.findOne({ type: "loyalty", isActive: true }).sort({ updatedAt: -1 }).lean();
  return {
    id: promo ? String(promo._id) : null,
    name: promo?.name ?? null,
    purchasesRequired: promo?.loyalty?.purchasesRequired ?? DEFAULT_LOYALTY.purchasesRequired,
    percentage: promo?.loyalty?.percentage ?? DEFAULT_LOYALTY.percentage,
  };
}

/** Promoción activa (con banner habilitado) para mostrar en el hero de la tienda. */
export async function getActiveBannerPromotion() {
  const now = new Date();
  return PromotionModel.findOne({
    isActive: true,
    "banner.enabled": true,
    $and: [
      { $or: [{ startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: { $exists: false } }, { endsAt: { $gte: now } }] },
    ],
  })
    .sort({ updatedAt: -1 })
    .lean();
}

/** Cupón activo y vigente por código, para redimir en checkout. */
export async function findRedeemableCoupon(code: string) {
  const now = new Date();
  return PromotionModel.findOne({
    type: "coupon",
    isActive: true,
    "coupon.code": code.toUpperCase().trim(),
    $or: [{ endsAt: { $exists: false } }, { endsAt: { $gte: now } }],
  });
}
