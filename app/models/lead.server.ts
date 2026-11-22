import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const leadSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  registeredAt: { type: Date, default: Date.now },
  discountCodeAssigned: { type: String, default: "BIENVENIDA10" },
  /** 'converted' se marca cuando el lead completa su primera compra pagada. 'pending' = aún sin compra. */
  status: { type: String, enum: ["pending", "converted"], default: "pending" },
  /** Fecha en que el admin ya le escribió (exportó el CSV o lo marcó a mano). Vacío = sin contactar. */
  contactedAt: { type: Date },
  source: {
    type: String,
    enum: ["meta_ads", "google", "blog", "direct", "other"],
    default: "direct",
  },
});

export type LeadDoc = InferSchemaType<typeof leadSchema>;

export const LeadModel = (models.Lead as Model<LeadDoc>) ?? model<LeadDoc>("Lead", leadSchema);
