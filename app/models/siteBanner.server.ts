import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Banner del hero del home independiente de las promociones — para cuando
 * el admin solo quiere cambiar la imagen/mensaje de portada sin que eso
 * implique crear un descuento. Compite por el mismo espacio que el banner
 * de una promoción activa; ver ~/lib/heroBanner.server.ts.
 */
const siteBannerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    imageUrl: { type: String, default: "", trim: true },
    /** Si el banner no lleva texto (banner.text vacío), la imagen es el único contenido — sin esto, quedaría sin alt real para lectores de pantalla. */
    imageAlt: { type: String, default: "", trim: true },
    text: { type: String, default: "", trim: true },
    ctaText: { type: String, default: "", trim: true },
    ctaHref: { type: String, default: "/tienda", trim: true },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type SiteBannerDoc = InferSchemaType<typeof siteBannerSchema>;

export const SiteBannerModel =
  (models.SiteBanner as Model<SiteBannerDoc>) ?? model<SiteBannerDoc>("SiteBanner", siteBannerSchema);

export async function getActiveCustomBanner() {
  return SiteBannerModel.findOne({ isActive: true }).sort({ updatedAt: -1 }).lean();
}

/** Todos los banners activos, para el carrusel del hero de /tienda (a diferencia de getActiveCustomBanner, que solo da el más reciente para el hero único del home). */
export async function getActiveCustomBanners() {
  return SiteBannerModel.find({ isActive: true }).sort({ updatedAt: -1 }).lean();
}
