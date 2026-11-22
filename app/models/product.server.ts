import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { UNIT_VALUES } from "~/lib/productUnit";

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
    /** Descripción principal: va abajo en la página del producto (acepta markdown). */
    description: { type: String, default: "", trim: true },
    /** Descripción secundaria: texto corto que aparece en las tarjetas de producto. */
    shortDescription: { type: String, default: "", trim: true, maxlength: 160 },
    stock: { type: Number, default: 0, min: 0 },
    images: { type: [String], default: [] },
    videos: { type: [videoSchema], default: [] },
    /** Fotos de cómo se usa el producto — sección "Así se usa" de la página (las de arriba son las fotos del producto). */
    usageImages: { type: [String], default: [] },
    isAvailable: { type: Boolean, default: true },
    /** Se muestra destacado ("glorificador") arriba del resto del catálogo en /tienda. */
    isFeatured: { type: Boolean, default: false },
    /** Si se puede incluir en la caja del auto-envío periódico (ver SubscriptionConfigurator). */
    isSubscribable: { type: Boolean, default: true },
    /**
     * false para productos que solo existen para formar parte de un paquete
     * (p. ej. un squishable de regalo más chico que nunca se vende suelto).
     * La tienda pública nunca debe listarlos como compra individual.
     */
    isIndividuallySellable: { type: Boolean, default: true },
    /** Presentación: cantidad + unidad (p. ej. 1 L, 500 g, 30 piezas) — reemplaza tener que describirlo en texto libre. */
    unitValue: { type: Number, min: 0.01, default: 1 },
    unit: { type: String, enum: UNIT_VALUES, default: "pieza" },
    /** Umbral de stock bajo propio de este producto — antes era un valor global fijo en Configuración. */
    lowStockThreshold: { type: Number, min: 0, default: 10 },
  },
  { timestamps: true },
);

export type ProductDoc = InferSchemaType<typeof productSchema>;

// En desarrollo se re-registra el modelo en cada recarga: si no, mongoose
// conserva el esquema viejo y descarta en silencio los campos nuevos al guardar.
if (process.env.NODE_ENV !== "production" && models.Product) {
  mongoose.deleteModel("Product");
}

export const ProductModel =
  (models.Product as Model<ProductDoc>) ?? model<ProductDoc>("Product", productSchema);
