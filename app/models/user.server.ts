import mongoose, { type InferSchemaType, type Model } from "mongoose";
import bcrypt from "bcryptjs";

const { Schema, model, models } = mongoose;

const dogSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    birthday: { type: Date },
  },
  { _id: false },
);

const addressSchema = new Schema(
  {
    line1: { type: String, trim: true, default: "" },
    line2: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    postalCode: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "MX" },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, trim: true },
    stripeCustomerId: { type: String },
    /** @deprecated usar `dogs` — se conserva por el registro histórico y como fallback de despliegue. */
    dogName: { type: String, trim: true },
    phone: { type: String, trim: true, default: "" },
    address: { type: addressSchema, default: () => ({}) },
    dogs: { type: [dogSchema], default: [] },
    /**
     * Compras individuales confirmadas (no cuenta envíos de suscripción).
     * Al llegar a LOYALTY_PURCHASES_REQUIRED se activa `loyaltyDiscountActive`.
     */
    individualPurchaseCount: { type: Number, default: 0 },
    loyaltyDiscountActive: { type: Boolean, default: false },
    role: { type: String, enum: ["customer", "admin"], default: "customer" },
    /** Lifetime value: suma de netAmount de todas sus órdenes pagadas. */
    totalSpentLTV: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema>;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export const UserModel =
  (models.User as Model<UserDoc>) ?? model<UserDoc>("User", userSchema);
