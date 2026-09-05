import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    description: { type: String, default: "", trim: true },
    stock: { type: Number, default: 0, min: 0 },
    images: { type: [String], default: [] },
    isAvailable: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type ProductDoc = InferSchemaType<typeof productSchema>;

export const ProductModel =
  (models.Product as Model<ProductDoc>) ?? model<ProductDoc>("Product", productSchema);
