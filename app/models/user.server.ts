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
    /** Cuándo confirmó que el correo es suyo (enlace del correo o restablecer contraseña). Vacío = sin confirmar. */
    emailVerifiedAt: { type: Date },
    /** Último cambio de contraseña: las sesiones iniciadas antes de este momento dejan de valer. */
    passwordChangedAt: { type: Date },
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
    role: { type: String, enum: ["customer", "admin", "superadmin"], default: "customer" },
    /**
     * Verificación en dos pasos de administradores (ver ~/lib/twoFactor.server). Los secretos van
     * cifrados y los códigos de recuperación solo como huella.
     */
    twoFactor: {
      type: new Schema(
        {
          secretEnc: { type: String },
          /** Secreto generado en la pantalla de activación que todavía no se confirma con un código. */
          pendingSecretEnc: { type: String },
          enabledAt: { type: Date },
          /** Último paso de 30 s aceptado: impide reutilizar un código. */
          lastUsedStep: { type: Number },
          recoveryCodes: {
            type: [new Schema({ hash: { type: String, required: true }, usedAt: { type: Date } }, { _id: false })],
            default: [],
          },
        },
        { _id: false },
      ),
      default: undefined,
    },
    /** Lifetime value: suma de netAmount de todas sus órdenes pagadas. */
    totalSpentLTV: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema>;

/** Costo de bcrypt para contraseñas nuevas (2^12 vueltas). */
const BCRYPT_COST = 12;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST);
}

// Hash de relleno para comparar cuando el correo no existe: así responder
// "correo o contraseña incorrectos" tarda lo mismo exista o no la cuenta, y
// no se puede averiguar qué correos están registrados midiendo el tiempo.
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash() {
  dummyHashPromise ??= bcrypt.hash("contrasena-de-relleno-sin-uso", BCRYPT_COST);
  return dummyHashPromise;
}

/** `hash` puede venir vacío (usuario inexistente): se compara contra el relleno y siempre devuelve false. */
export async function verifyPassword(password: string, hash: string | null | undefined) {
  if (!hash) {
    await bcrypt.compare(password, await getDummyHash());
    return false;
  }
  return bcrypt.compare(password, hash);
}

export const UserModel =
  (models.User as Model<UserDoc>) ?? model<UserDoc>("User", userSchema);
