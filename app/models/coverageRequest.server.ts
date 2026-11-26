import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Personas que quisieron comprar desde un código postal fuera de la zona de
 * entrega y dejaron su correo para que les avisemos cuando lleguemos. Sirve para
 * decidir a dónde crecer: se ve cuánta gente pide cada zona. El correo se usa
 * únicamente para ese aviso (así se les dice en el formulario).
 */
const coverageRequestSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    postalCode: { type: String, required: true, match: /^\d{5}$/ },
  },
  { timestamps: true },
);

// Una persona que lo pide dos veces desde el mismo código postal cuenta una sola vez.
coverageRequestSchema.index({ email: 1, postalCode: 1 }, { unique: true });
coverageRequestSchema.index({ createdAt: -1 });

export type CoverageRequestDoc = InferSchemaType<typeof coverageRequestSchema>;

export const CoverageRequestModel =
  (models.CoverageRequest as Model<CoverageRequestDoc>) ??
  model<CoverageRequestDoc>("CoverageRequest", coverageRequestSchema);
