import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const subscriptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    stripeSubscriptionId: { type: String, required: true, unique: true },
    stripeCustomerId: { type: String, required: true },
    frequency: {
      type: String,
      enum: ["3-semanas", "4-semanas", "6-semanas", "8-semanas"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "paused", "cancelled", "past_due"],
      default: "active",
    },
    discountPercent: { type: Number, default: 10 },
    nextDeliveryDate: { type: Date },
    currentPeriodEnd: { type: Date },
    /** Incrementa con cada renovación de Stripe (factura pagada) que genera un Order. */
    totalOrdersGenerated: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type SubscriptionDoc = InferSchemaType<typeof subscriptionSchema>;

export const SubscriptionModel =
  (models.Subscription as Model<SubscriptionDoc>) ??
  model<SubscriptionDoc>("Subscription", subscriptionSchema);
