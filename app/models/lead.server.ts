import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const leadSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  registeredAt: { type: Date, default: Date.now },
  discountCodeAssigned: { type: String, default: "BIENVENIDA10" },
  status: { type: String, enum: ["pending", "notified"], default: "pending" },
});

export type LeadDoc = InferSchemaType<typeof leadSchema>;

export const LeadModel = (models.Lead as Model<LeadDoc>) ?? model<LeadDoc>("Lead", leadSchema);
