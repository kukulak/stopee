import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const videoSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    source: { type: String, enum: ["youtube", "upload"], default: "youtube" },
  },
  { _id: false },
);

const bundleItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    /**
     * Descuento aplicado SOLO a este componente dentro del paquete. El
     * precio del paquete no se captura a mano: se recalcula sumando
     * (precio del producto × cantidad × (1 - descuento%)) de cada renglón,
     * así el margen de cada paquete queda explícito y auditable.
     */
    discountPercentage: { type: Number, min: 0, max: 100, default: 0 },
  },
  { _id: false },
);

const bundleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /** Generado del nombre al crear el paquete — es lo que identifica al paquete en el carrito, checkout y promociones (igual que `sku` en Product). */
    sku: { type: String, required: true, unique: true, trim: true, lowercase: true },
    products: { type: [bundleItemSchema], required: true },
    /** Calculado automáticamente a partir de `products` — ver `computeBundlePrice`. */
    bundlePrice: { type: Number, required: true, min: 0 },
    images: { type: [String], default: [] },
    videos: { type: [videoSchema], default: [] },
    isActive: { type: Boolean, default: true },
    /** Se muestra destacado ("glorificador") arriba del resto del catálogo en /tienda. */
    isFeatured: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type BundleDoc = InferSchemaType<typeof bundleSchema>;

export const BundleModel =
  (models.Bundle as Model<BundleDoc>) ?? model<BundleDoc>("Bundle", bundleSchema);

