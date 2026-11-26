import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Solicitud para ser Punto de Recarga STOPee, enviada desde /puntos-de-recarga. No es un `Lead`
 * (esa colección es la lista de espera con cupón de bienvenida). Se revisa en /admin/aliados.
 */
const allyRequestSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    /** Nombre del negocio o punto, si lo tiene (un vecino puede no tener uno). */
    businessName: { type: String, trim: true, default: "", maxlength: 80 },
    businessOrType: { type: String, required: true, trim: true, maxlength: 40 },
    neighborhood: { type: String, required: true, trim: true, maxlength: 80 },
    address: { type: String, required: true, trim: true, maxlength: 160 },
    /** 10 dígitos, ya normalizado. */
    whatsapp: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 100 },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    /** La cuenta que se activó como aliado al aprobar esta solicitud (si ya existía o cuando se registró). */
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    /** Cuándo aceptó el aviso de privacidad al enviar la solicitud. */
    privacyAcceptedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
allyRequestSchema.index({ status: 1, createdAt: -1 });
allyRequestSchema.index({ email: 1 });

export type AllyRequestDoc = InferSchemaType<typeof allyRequestSchema>;

// En desarrollo se re-registra el modelo en cada recarga: si no, mongoose conserva el esquema viejo y descarta en
// silencio los campos nuevos al guardar (igual que en Product y User).
if (process.env.NODE_ENV !== "production" && models.AllyRequest) {
  mongoose.deleteModel("AllyRequest");
}

export const AllyRequestModel =
  (models.AllyRequest as Model<AllyRequestDoc>) ?? model<AllyRequestDoc>("AllyRequest", allyRequestSchema);
