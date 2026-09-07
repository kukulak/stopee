import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const orderItemSchema = new Schema(
  {
    sku: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceMxn: { type: Number, required: true },
  },
  { _id: false },
);

const attributionSchema = new Schema(
  {
    utm_source: { type: String, default: "" },
    utm_medium: { type: String, default: "" },
    utm_campaign: { type: String, default: "" },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User" },
    email: { type: String, required: true },
    stripeCheckoutSessionId: { type: String, unique: true, sparse: true },
    stripePaymentIntentId: { type: String },
    /** Presente solo en pedidos generados por una renovación de suscripción. */
    stripeSubscriptionId: { type: String, index: true },
    items: { type: [orderItemSchema], required: true },
    // Bruto (suma de precios de lista) → descuento → neto (lo cobrado).
    totalAmount: { type: Number, required: true },
    discountAmount: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    netAmount: { type: Number, required: true },
    type: {
      type: String,
      enum: ["one_time", "subscription_first", "subscription_recurring"],
      default: "one_time",
    },
    status: {
      type: String,
      enum: ["paid", "processing", "shipped", "delivered", "cancelled", "refunded"],
      default: "paid",
    },
    trackingNumber: { type: String, default: "" },
    attribution: { type: attributionSchema, default: () => ({}) },
    /** Promoción redimida en este pedido, si hubo una (para medir efectividad en el dashboard). */
    promotion: {
      id: { type: Schema.Types.ObjectId, ref: "Promotion" },
      name: { type: String },
      type: { type: String },
    },
    /** true si esta orden cuenta para el contador de fidelidad (compra individual, no de suscripción) */
    countsTowardLoyalty: { type: Boolean, default: true },
    shippingAddress: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      postalCode: String,
      country: { type: String, default: "MX" },
    },
  },
  { timestamps: true },
);

export type OrderDoc = InferSchemaType<typeof orderSchema>;

export const OrderModel =
  (models.Order as Model<OrderDoc>) ?? model<OrderDoc>("Order", orderSchema);
