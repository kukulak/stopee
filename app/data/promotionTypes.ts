/** Client-safe: usado tanto por el modelo (server) como por el selector de tipo en el admin. */
export const PROMOTION_TYPES = [
  "coupon",
  "bogo",
  "free_gift",
  "new_customer",
  "tiered_spend",
  "custom",
  "flash_sale",
  "vip_early",
  "buy_together",
  "loyalty",
] as const;

export type PromotionType = (typeof PROMOTION_TYPES)[number];
