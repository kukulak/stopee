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

/**
 * Recompensa por ciclo de lealtad: la 1ª vez que un cliente completa el
 * ciclo puede recibir un premio distinto a la 2ª o 3ª vez (p. ej. 10% →
 * 15% → un regalo físico). Si hay más ciclos completados que recompensas
 * definidas, se repite la última — ver resolveLoyaltyTier.
 */
const loyaltyTierSchema = new Schema(
  {
    rewardType: { type: String, enum: ["discount", "gift"], default: "discount" },
    percentage: { type: Number, min: 1, max: 100 },
    giftDescription: { type: String, trim: true },
  },
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
      /**
       * Nunca es un descuento permanente: al completar el ciclo se gana la
       * recompensa de este arreglo (según cuántas veces ya lo completó) para
       * SU SIGUIENTE compra, y el contador se reinicia — ver
       * app/lib/loyalty.ts#resolveLoyaltyTier.
       */
      tiers: { type: [loyaltyTierSchema], default: [] },
    },
    /**
     * A diferencia de `tieredSpend` (escalones sobre el gasto TOTAL del
     * carrito), aquí el requisito siempre gira en torno a UN producto o
     * paquete puntual (o a ser primera compra) — permite reglas como "2L en
     * el carrito → regalo" o "$500 en concentrado → regalo" sin forzar esos
     * casos dentro de un escalonado que no aplica.
     */
    byRequirement: {
      condition: { type: String, enum: ["product_in_cart", "product_spend", "first_purchase"], default: "product_in_cart" },
      // SKU del catálogo real de la tienda (app/data/products.ts) — NO el
      // catálogo de /admin/catalog, que es un sistema aparte usado solo para
      // inventario/margen y no es lo que hay en el carrito del cliente.
      targetSku: { type: String },
      minQuantity: { type: Number, min: 1 },
      minSpendMxn: { type: Number, min: 0 },
      rewardDiscountPercentage: { type: Number, min: 1, max: 100 },
      rewardGiftSku: { type: String },
    },

    banner: { type: bannerSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export type PromotionDoc = InferSchemaType<typeof promotionSchema>;

export const PromotionModel =
  (models.Promotion as Model<PromotionDoc>) ?? model<PromotionDoc>("Promotion", promotionSchema);

const DEFAULT_LOYALTY_TIER = { rewardType: "discount" as const, percentage: 10 };
const DEFAULT_LOYALTY = { purchasesRequired: 5, tiers: [DEFAULT_LOYALTY_TIER] };

/** Config de lealtad vigente — si no hay ninguna creada en el admin, usa el default histórico. */
export async function getActiveLoyaltyConfig() {
  const promo = await PromotionModel.findOne({ type: "loyalty", isActive: true }).sort({ updatedAt: -1 }).lean();
  const tiers = promo?.loyalty?.tiers?.length ? promo.loyalty.tiers : DEFAULT_LOYALTY.tiers;
  return {
    id: promo ? String(promo._id) : null,
    name: promo?.name ?? null,
    purchasesRequired: promo?.loyalty?.purchasesRequired ?? DEFAULT_LOYALTY.purchasesRequired,
    tiers,
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
