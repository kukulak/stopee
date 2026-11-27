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
    imageAlt: { type: String, default: "", trim: true },
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
      // --- Reglas opcionales (vacío = sin restricción). Ver ~/lib/couponRules.server ---
      /** Cada cliente puede usarlo una sola vez (por cuenta o correo). Exige sesión iniciada. */
      oncePerCustomer: { type: Boolean, default: false },
      /** Solo estos correos pueden usarlo (en minúsculas). Exige sesión iniciada. */
      allowedEmails: { type: [String], default: [] },
      /** Solo para clientes que todavía no han comprado. Exige sesión iniciada. */
      firstPurchaseOnly: { type: Boolean, default: false },
      /** Compra mínima en pesos (antes del descuento). */
      minSpendMxn: { type: Number, min: 0 },
      /** Mínimo de piezas en el carrito. */
      minQuantity: { type: Number, min: 1 },
      /** El carrito debe traer al menos uno de estos productos o paquetes (SKU). */
      requiredSkus: { type: [String], default: [] },
      /**
       * ¿Para quién es el cupón? Clientes normales, Puntos de Recarga (aliados) o ambos. Los cupones
       * anteriores a este campo no lo traen y cuentan como "para los dos": siguen funcionando como siempre.
       * Un cupón nuevo se crea solo para clientes salvo que el administrador marque también a los aliados.
       */
      forCustomers: { type: Boolean },
      forAllies: { type: Boolean },
      /** Puede sumarse a la recompensa de lealtad del cliente. Por defecto, no se combina con nada. */
      stackable: { type: Boolean, default: false },
      /**
       * Se aplica sola al carrito de quien cumpla sus reglas, sin escribir ningún código (p. ej. «10% de
       * apertura en toda la tienda»). Con esto el código es opcional.
       */
      autoApply: { type: Boolean, default: false },
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
      // SKU del catálogo real de la tienda (~/lib/catalog.server, respaldado
      // por Product/Bundle en MongoDB — ver /admin/catalog).
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

// En desarrollo se re-registra el modelo en cada recarga: si no, mongoose conserva el esquema viejo y descarta en
// silencio los campos nuevos al guardar (igual que en Product, User y AllyRequest).
if (process.env.NODE_ENV !== "production" && models.Promotion) {
  mongoose.deleteModel("Promotion");
}

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

function activeBannerPromotionFilter() {
  const now = new Date();
  return {
    isActive: true,
    "banner.enabled": true,
    $and: [
      { $or: [{ startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: { $exists: false } }, { endsAt: { $gte: now } }] },
    ],
  };
}

/** Todas las promociones activas con banner habilitado, para el carrusel del hero de /tienda. */
export async function getActiveBannerPromotions() {
  return PromotionModel.find(activeBannerPromotionFilter()).sort({ updatedAt: -1 }).lean();
}

/** Vigente hoy y con usos disponibles: lo que debe cumplir un cupón para poder canjearse. */
function redeemableWindow() {
  const now = new Date();
  return [
    { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
    { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
    {
      $or: [
        { usageLimit: { $exists: false } },
        { usageLimit: null },
        { usageLimit: 0 },
        { $expr: { $lt: [{ $ifNull: ["$timesUsed", 0] }, "$usageLimit"] } },
      ],
    },
  ];
}

/**
 * Cupón activo y vigente por código, para redimir en checkout. Respeta la
 * fecha de inicio, la de fin y el tope de usos (`usageLimit`): un cupón con
 * "primeros 100" deja de servir en cuanto se canjea el número 100.
 */
export async function findRedeemableCoupon(code: string) {
  return PromotionModel.findOne({
    type: "coupon",
    isActive: true,
    "coupon.code": code.toUpperCase().trim(),
    $and: redeemableWindow(),
  });
}

/** Cupones vigentes marcados «se aplica sola»: se prueban contra cada carrito sin que el cliente escriba nada. */
export async function findAutoApplyCoupons() {
  return PromotionModel.find({
    type: "coupon",
    isActive: true,
    "coupon.autoApply": true,
    $and: redeemableWindow(),
  });
}
