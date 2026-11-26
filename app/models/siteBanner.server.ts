import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

/** Dónde se muestra un banner: la portada (mensajes de beneficios e identidad) o la tienda (productos, paquetes, promociones). */
export const BANNER_PLACEMENTS = ["home", "tienda"] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];

export function parseBannerPlacement(value: unknown): BannerPlacement {
  return value === "home" ? "home" : "tienda";
}

/**
 * Banner editable desde /admin/banners, independiente de las promociones. Cada uno se muestra en
 * un solo lugar (`placement`): en la portada, un banner a lo ancho de la pantalla (solo se muestra
 * el activo más reciente); en /tienda, el carrusel junto con las promociones que tengan banner.
 * Ver ~/lib/heroBanner.server.ts.
 */
const siteBannerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /**
     * Los banners creados antes de este campo no lo tienen: se tratan como de la tienda (que es donde
     * se mostraban), por eso las consultas usan `$ne: "home"` y no `"tienda"`.
     */
    placement: { type: String, enum: BANNER_PLACEMENTS, default: "tienda" },
    imageUrl: { type: String, default: "", trim: true },
    /** Si el banner no lleva texto (banner.text vacío), la imagen es el único contenido — sin esto, quedaría sin alt real para lectores de pantalla. */
    imageAlt: { type: String, default: "", trim: true },
    text: { type: String, default: "", trim: true },
    /** Frase de apoyo bajo el título; solo la usa el banner de la portada. */
    subtitle: { type: String, default: "", trim: true },
    ctaText: { type: String, default: "", trim: true },
    /**
     * Destino del botón o, si el banner es solo imagen, de toda la imagen. Vacío = sin enlace (un
     * banner solo imagen deja de ser clicable); con botón, vacío cae a /tienda.
     */
    ctaHref: { type: String, default: "/tienda", trim: true },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type SiteBannerDoc = InferSchemaType<typeof siteBannerSchema>;

export const SiteBannerModel =
  (models.SiteBanner as Model<SiteBannerDoc>) ?? model<SiteBannerDoc>("SiteBanner", siteBannerSchema);

/**
 * Todos los banners activos de la portada, para su carrusel. Van del más nuevo al más viejo según su
 * fecha de creación (no la de edición): corregir un texto no debe cambiar el orden en que rotan.
 */
export async function getActiveHomeBanners() {
  return SiteBannerModel.find({ isActive: true, placement: "home" }).sort({ createdAt: -1 }).lean();
}

/** Todos los banners activos de la tienda, para el carrusel del hero de /tienda. */
export async function getActiveCustomBanners() {
  return SiteBannerModel.find({ isActive: true, placement: { $ne: "home" } }).sort({ updatedAt: -1 }).lean();
}
