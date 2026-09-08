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

/**
 * Recompensa ganada al completar un ciclo de lealtad, pendiente de usarse en
 * la SIGUIENTE compra (nunca permanente) — se limpia sola en cuanto se aplica.
 * Se copia aquí (en vez de solo referenciar la promoción) porque el ciclo en
 * que se ganó pudo usar una configuración de recompensas distinta a la
 * vigente hoy; así el premio ya otorgado no cambia si el admin edita la promo.
 */
const loyaltyRewardSchema = new Schema(
  {
    promotionId: { type: Schema.Types.ObjectId, ref: "Promotion" },
    promotionName: { type: String },
    rewardType: { type: String, enum: ["discount", "gift"], required: true },
    percentage: { type: Number },
    giftDescription: { type: String },
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
    /** Compras individuales confirmadas de por vida (no cuenta envíos de suscripción). */
    individualPurchaseCount: { type: Number, default: 0 },
    /** Compras dentro del ciclo actual — se reinicia a 0 cada vez que se completa un ciclo. */
    loyaltyCycleCount: { type: Number, default: 0 },
    /** Cuántos ciclos ha completado — determina qué recompensa de la lista le toca la próxima vez. */
    loyaltyCyclesCompleted: { type: Number, default: 0 },
    /** Recompensa ganada, lista para su próxima compra — null si no tiene ninguna pendiente. */
    loyaltyPendingReward: { type: loyaltyRewardSchema, default: null },
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
