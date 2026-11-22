import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { connectDB } from "~/lib/db.server";
import { createTtlCache } from "~/lib/ttlCache.server";

const { Schema, model, models } = mongoose;

/**
 * Configuración única (singleton, igual patrón que SiteSettings/LegalSettings)
 * del popup de "no te vayas" — todo editable desde /admin/exit-intent, nada
 * hardcodeado: si está apagado o sin mensaje, no se muestra.
 */
const exitIntentPopupSchema = new Schema(
  {
    isEnabled: { type: Boolean, default: false },
    title: { type: String, default: "" },
    message: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    ctaText: { type: String, default: "" },
    ctaHref: { type: String, default: "/tienda" },
    // En qué secciones del sitio puede aparecer — nunca en /admin ni /cuenta.
    showOnHome: { type: Boolean, default: true },
    showOnTienda: { type: Boolean, default: true },
    showOnBlog: { type: Boolean, default: false },
    // Días antes de volver a mostrárselo a la misma persona (cookie del navegador).
    snoozeDays: { type: Number, default: 7, min: 1 },
  },
  { timestamps: true },
);

export type ExitIntentPopupDoc = InferSchemaType<typeof exitIntentPopupSchema>;

export const ExitIntentPopupModel =
  (models.ExitIntentPopup as Model<ExitIntentPopupDoc>) ??
  model<ExitIntentPopupDoc>("ExitIntentPopup", exitIntentPopupSchema);

export async function getExitIntentPopup() {
  await connectDB();
  const existing = await ExitIntentPopupModel.findOne().lean();
  if (existing) return existing;
  const created = await ExitIntentPopupModel.create({});
  return created.toObject();
}

const getExitIntentPopupCache = createTtlCache<Awaited<ReturnType<typeof getExitIntentPopup>>>();

/** getExitIntentPopup con caché corta, para el layout raíz (que lo lee en cada petición). */
export function getExitIntentPopupCached() {
  return getExitIntentPopupCache.get(getExitIntentPopup);
}

export async function updateExitIntentPopup(data: Partial<ExitIntentPopupDoc>) {
  getExitIntentPopupCache.clear();
  await connectDB();
  const existing = await ExitIntentPopupModel.findOne();
  if (existing) {
    Object.assign(existing, data);
    await existing.save();
    getExitIntentPopupCache.clear();
    return existing.toObject();
  }
  const created = await ExitIntentPopupModel.create(data);
  getExitIntentPopupCache.clear();
  return created.toObject();
}
