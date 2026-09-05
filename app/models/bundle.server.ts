import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const bundleItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
  },
  { _id: false },
);

const bundleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    products: { type: [bundleItemSchema], required: true },
    bundlePrice: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type BundleDoc = InferSchemaType<typeof bundleSchema>;

export const BundleModel =
  (models.Bundle as Model<BundleDoc>) ?? model<BundleDoc>("Bundle", bundleSchema);
