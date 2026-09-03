import { STRIPE_PRICES } from "~/lib/stripe.server";
import type { ProductSku } from "~/data/products";

export const STRIPE_PRICE_BY_SKU: Record<ProductSku, string> = {
  "concentrado-1l": STRIPE_PRICES.concentrado1L,
  squishable: STRIPE_PRICES.squishable,
  "pack-basico": STRIPE_PRICES.packBasico,
  "pack-duo": STRIPE_PRICES.packDuo,
  "pack-manada": STRIPE_PRICES.packManada,
};
