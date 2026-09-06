import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const videoSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    /** 'youtube' para enlaces externos, 'upload' para archivos subidos al servidor. */
    source: { type: String, enum: ["youtube", "upload"], default: "youtube" },
  },
  { _id: false },
);

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, default: 0, min: 0 },
    description: { type: String, default: "", trim: true },
    stock: { type: Number, default: 0, min: 0 },
    images: { type: [String], default: [] },
    videos: { type: [videoSchema], default: [] },
    isAvailable: { type: Boolean, default: true },
    /**
     * false para productos que solo existen para formar parte de un paquete
     * (p. ej. un squishable de regalo más chico que nunca se vende suelto).
     * La tienda pública nunca debe listarlos como compra individual.
     */
    isIndividuallySellable: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type ProductDoc = InferSchemaType<typeof productSchema>;

export const ProductModel =
  (models.Product as Model<ProductDoc>) ?? model<ProductDoc>("Product", productSchema);
