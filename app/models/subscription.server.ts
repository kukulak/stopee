import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const subscriptionItemSchema = new Schema(
  {
    sku: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceMxn: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const subscriptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    stripeSubscriptionId: { type: String, required: true, unique: true },
    stripeCustomerId: { type: String, required: true },
    /** Lo que el cliente armó para su caja — cada renovación factura exactamente esto. */
    items: { type: [subscriptionItemSchema], default: [] },
    /** Cada cuántas semanas llega la caja, p. ej. "4-semanas" (ver ~/lib/subscriptionConfig). */
    frequency: {
      type: String,
      match: /^\d{1,2}-semanas$/,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "paused", "cancelled", "past_due"],
      default: "active",
    },
    /** Descuento que tenía vigente al contratar; se guarda para no depender del valor actual de la configuración. */
    discountPercent: { type: Number, default: 0 },
    nextDeliveryDate: { type: Date },
    currentPeriodEnd: { type: Date },
    /** Incrementa con cada renovación de Stripe (factura pagada) que genera un Order. */
    totalOrdersGenerated: { type: Number, default: 0 },
    /** A dónde llega la caja: la dirección que escribió al contratar. Cada renovación genera su pedido con esta misma. */
    shippingAddress: {
      name: String,
      phone: String,
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

export type SubscriptionDoc = InferSchemaType<typeof subscriptionSchema>;

export const SubscriptionModel =
  (models.Subscription as Model<SubscriptionDoc>) ??
  model<SubscriptionDoc>("Subscription", subscriptionSchema);
