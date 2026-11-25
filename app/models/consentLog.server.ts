import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Prueba de la elección de cookies: cuándo se eligió, qué versión del aviso se mostraba y qué se
 * aceptó o rechazó. No guarda IP ni datos de la persona: solo un identificador aleatorio (el mismo
 * que va en su cookie de elección), para poder demostrar el consentimiento si alguien lo pregunta.
 */
const consentLogSchema = new Schema(
  {
    consentId: { type: String, required: true, index: true },
    version: { type: Number, required: true },
    analytics: { type: Boolean, required: true },
    marketing: { type: Boolean, required: true },
    /** Botón que se pulsó: all | none | custom. */
    choice: { type: String, enum: ["all", "none", "custom"], required: true },
    /** Página donde se decidió, sin parámetros. */
    path: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

export type ConsentLogDoc = InferSchemaType<typeof consentLogSchema>;

export const ConsentLogModel =
  (models.ConsentLog as Model<ConsentLogDoc>) ?? model<ConsentLogDoc>("ConsentLog", consentLogSchema);
