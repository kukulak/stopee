import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const discountSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    percentage: { type: Number, required: true, min: 1, max: 100 },
    validUntil: { type: Date, required: true },
    timesUsed: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type DiscountDoc = InferSchemaType<typeof discountSchema>;

export const DiscountModel =
  (models.Discount as Model<DiscountDoc>) ?? model<DiscountDoc>("Discount", discountSchema);
