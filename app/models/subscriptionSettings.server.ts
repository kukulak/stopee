import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { connectDB } from "~/lib/db.server";
import {
  DEFAULT_SUBSCRIPTION_CONFIG,
  MAX_FREQUENCY_WEEKS,
  MAX_SUBSCRIPTION_DISCOUNT_PERCENT,
  type SubscriptionConfig,
} from "~/lib/subscriptionConfig";
import { createTtlCache } from "~/lib/ttlCache.server";

const { Schema, model, models } = mongoose;

/**
 * Configuración del auto-envío periódico — singleton, igual que ShippingSettings.
 * Se edita en /admin/subscription; los valores por defecto viven en
 * ~/lib/subscriptionConfig y solo se usan mientras no se haya guardado nada.
 */
const frequencySchema = new Schema(
  {
    weeks: { type: Number, required: true, min: 1, max: MAX_FREQUENCY_WEEKS },
    hint: { type: String, trim: true, maxlength: 120, default: "" },
    recommended: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

const subscriptionSettingsSchema = new Schema(
  {
    programName: { type: String, trim: true, maxlength: 60 },
    discountPercent: { type: Number, min: 0, max: MAX_SUBSCRIPTION_DISCOUNT_PERCENT },
    headline: { type: String, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 400 },
    benefits: { type: [String] },
    ctaLabel: { type: String, trim: true, maxlength: 60 },
    disclaimer: { type: String, trim: true, maxlength: 600 },
    frequencies: { type: [frequencySchema] },
  },
  { timestamps: true },
);

export type SubscriptionSettingsDoc = InferSchemaType<typeof subscriptionSettingsSchema>;

export const SubscriptionSettingsModel =
  (models.SubscriptionSettings as Model<SubscriptionSettingsDoc>) ??
  model<SubscriptionSettingsDoc>("SubscriptionSettings", subscriptionSettingsSchema);

/** Lee la configuración y completa con los valores por defecto lo que todavía no se haya guardado. */
export async function getSubscriptionConfig(): Promise<SubscriptionConfig> {
  await connectDB();
  const stored = await SubscriptionSettingsModel.findOne().lean();
  const defaults = DEFAULT_SUBSCRIPTION_CONFIG;
  if (!stored) return { ...defaults, benefits: [...defaults.benefits], frequencies: defaults.frequencies.map((f) => ({ ...f })) };

  return {
    // Un texto guardado vacío es válido (p. ej. sin nombre de programa); solo "nunca guardado" cae al valor por defecto.
    programName: stored.programName ?? defaults.programName,
    discountPercent: typeof stored.discountPercent === "number" ? stored.discountPercent : defaults.discountPercent,
    headline: stored.headline || defaults.headline,
    description: stored.description ?? defaults.description,
    // El admin siempre guarda un título; si existe, la lista de ventajas (aunque esté vacía) es la que él dejó.
    benefits: stored.headline ? stored.benefits ?? [] : defaults.benefits,
    ctaLabel: stored.ctaLabel || defaults.ctaLabel,
    disclaimer: stored.disclaimer ?? defaults.disclaimer,
    frequencies:
      stored.frequencies && stored.frequencies.length > 0
        ? stored.frequencies.map((f) => ({
            weeks: f.weeks,
            hint: f.hint ?? "",
            recommended: Boolean(f.recommended),
            isActive: f.isActive !== false,
          }))
        : defaults.frequencies.map((f) => ({ ...f })),
  };
}

const getSubscriptionConfigCache = createTtlCache<Awaited<ReturnType<typeof getSubscriptionConfig>>>();

/** getSubscriptionConfig con caché corta, para el layout raíz (que lo lee en cada petición). */
export function getSubscriptionConfigCached() {
  return getSubscriptionConfigCache.get(getSubscriptionConfig);
}

export async function saveSubscriptionConfig(config: SubscriptionConfig) {
  getSubscriptionConfigCache.clear();
  await connectDB();
  await SubscriptionSettingsModel.findOneAndUpdate({}, { $set: config }, { upsert: true });
  getSubscriptionConfigCache.clear();
}
