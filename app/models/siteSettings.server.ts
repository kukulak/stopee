import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { connectDB } from "~/lib/db.server";

const { Schema, model, models } = mongoose;

const siteSettingsSchema = new Schema(
  {
    isStoreActive: { type: Boolean, default: false },
    googlePixelId: { type: String, default: "" },
    metaPixelId: { type: String, default: "" },
    // El texto se conserva aunque la barra esté apagada, para no perder la
    // última redacción al desactivarla temporalmente.
    announcementBarText: { type: String, default: "" },
    announcementBarActive: { type: Boolean, default: false },
    lowStockThresholdBottle1L: { type: Number, default: 20 },
    lowStockThresholdSquishable: { type: Number, default: 20 },
  },
  { timestamps: true },
);

export type SiteSettingsDoc = InferSchemaType<typeof siteSettingsSchema>;

export const SiteSettingsModel =
  (models.SiteSettings as Model<SiteSettingsDoc>) ??
  model<SiteSettingsDoc>("SiteSettings", siteSettingsSchema);

/**
 * Documento único de configuración (patrón singleton): siempre se lee/edita
 * el mismo registro, creándolo con valores por defecto si aún no existe.
 */
export async function getSiteSettings() {
  await connectDB();
  const existing = await SiteSettingsModel.findOne().lean();
  if (existing) return existing;
  const created = await SiteSettingsModel.create({});
  return created.toObject();
}

export async function updateSiteSettings(data: Partial<SiteSettingsDoc>) {
  await connectDB();
  const existing = await SiteSettingsModel.findOne();
  if (existing) {
    Object.assign(existing, data);
    await existing.save();
    return existing.toObject();
  }
  const created = await SiteSettingsModel.create(data);
  return created.toObject();
}
