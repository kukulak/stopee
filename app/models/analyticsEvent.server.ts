import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Registro mínimo de eventos de producto para poder calcular el embudo de
 * conversión (sesiones → vista de producto → carrito → checkout → compra)
 * con datos reales en vez de estimarlo. Las compras NO se duplican aquí:
 * ese conteo sale directo de `Order` para no tener dos fuentes de verdad.
 */
const analyticsEventSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["page_view", "view_item", "add_to_cart", "begin_checkout", "banner_click"],
      required: true,
      index: true,
    },
    sessionId: { type: String, required: true, index: true },
    sku: { type: String },
    /**
     * Solo se llena cuando el evento ocurre con sesión iniciada — permite
     * detectar carritos abandonados con datos de contacto reales. La mayoría
     * de las visitas son anónimas y se quedan sin estos dos campos.
     */
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    email: { type: String },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

export type AnalyticsEventDoc = InferSchemaType<typeof analyticsEventSchema>;

export const AnalyticsEventModel =
  (models.AnalyticsEvent as Model<AnalyticsEventDoc>) ??
  model<AnalyticsEventDoc>("AnalyticsEvent", analyticsEventSchema);
