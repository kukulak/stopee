import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { connectDB } from "~/lib/db.server";

const { Schema, model, models } = mongoose;

/**
 * Reseñas/testimonios reales de clientes — el admin los captura a mano
 * (nombre, texto, calificación) conforme los va recibiendo. Nunca se generan
 * ni se inventan aquí; empieza vacío y el sitio simplemente no muestra la
 * sección de testimonios hasta que haya al menos uno publicado.
 */
const testimonialSchema = new Schema(
  {
    customerName: { type: String, required: true, trim: true },
    quote: { type: String, required: true, trim: true },
    rating: { type: Number, min: 1, max: 5, default: 5 },
    photoUrl: { type: String, default: "", trim: true },
    isPublished: { type: Boolean, default: false },
    /**
     * SKUs de los productos/paquetes a cuya página pertenece este testimonio.
     * Vacío = testimonio general (solo aparece en la sección de testimonios
     * del inicio); con SKUs, también sale en la página de esos productos.
     */
    productSkus: { type: [String], default: [] },
  },
  { timestamps: true },
);

export type TestimonialDoc = InferSchemaType<typeof testimonialSchema>;

// En desarrollo se re-registra el modelo en cada recarga: si no, mongoose
// conserva el esquema viejo y descarta en silencio los campos nuevos al guardar.
if (process.env.NODE_ENV !== "production" && models.Testimonial) {
  mongoose.deleteModel("Testimonial");
}

export const TestimonialModel =
  (models.Testimonial as Model<TestimonialDoc>) ?? model<TestimonialDoc>("Testimonial", testimonialSchema);

/** Los últimos testimonios publicados de un producto/paquete (máximo 3) — ninguno = la página no muestra la sección. */
export async function getTestimonialsForSku(sku: string, limit = 3) {
  await connectDB();
  return TestimonialModel.find({ isPublished: true, productSkus: sku }).sort({ createdAt: -1 }).limit(limit).lean();
}

export async function getPublishedTestimonials() {
  await connectDB();
  return TestimonialModel.find({ isPublished: true }).sort({ createdAt: -1 }).lean();
}
