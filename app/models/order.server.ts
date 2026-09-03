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

const orderSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User" },
    email: { type: String, required: true },
    stripeCheckoutSessionId: { type: String, required: true, unique: true },
    stripePaymentIntentId: { type: String },
    items: { type: [orderItemSchema], required: true },
    subtotalMxn: { type: Number, required: true },
    discountPercent: { type: Number, default: 0 },
    totalMxn: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "paid", "fulfilled", "cancelled", "refunded"],
      default: "pending",
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
