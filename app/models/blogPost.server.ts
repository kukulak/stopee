import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const blogPostSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    excerpt: { type: String, required: true, trim: true },
    /** Markdown — se convierte a HTML al servir el artículo, ver ~/lib/markdown.server.ts. */
    content: { type: String, required: true },
    imageUrl: { type: String, default: "", trim: true },
    /** Opcional — si el admin no la llena, la imagen del artículo usa el título como alt (ver blog.$slug.tsx); la miniatura en /blog sigue siendo decorativa (alt="") porque ya está junto al mismo título. */
    imageAlt: { type: String, default: "", trim: true },
    readingMinutes: { type: Number, default: 3, min: 1 },
    /** Enlazado interno elegido a mano por el admin al editar el artículo — se muestran como "También te puede interesar" al final. */
    relatedPostSlugs: { type: [String], default: [] },
    relatedProductSkus: { type: [String], default: [] },
    /**
     * null = borrador, nunca visible públicamente. Fecha futura = programado
     * (se publica solo cuando llega esa fecha). Fecha pasada/actual =
     * publicado. No hay un campo `status` aparte que se pueda desincronizar
     * de esta fecha — las consultas públicas comparan directo contra `now`.
     */
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type BlogPostDoc = InferSchemaType<typeof blogPostSchema>;

export const BlogPostModel =
  (models.BlogPost as Model<BlogPostDoc>) ?? model<BlogPostDoc>("BlogPost", blogPostSchema);
