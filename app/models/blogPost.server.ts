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
    readingMinutes: { type: Number, default: 3, min: 1 },
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
