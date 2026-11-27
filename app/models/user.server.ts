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
    /** Cómo la llama la persona ("Casa", "Casa de mamá"). Vacío = sin nombre todavía. */
    label: { type: String, trim: true, default: "", maxlength: 40 },
    /** A nombre de quién se entrega (puede no ser la persona de la cuenta: un regalo). */
    recipientName: { type: String, trim: true, default: "", maxlength: 100 },
  },
  { _id: false },
);

/**
 * Direcciones guardadas además de la principal (`address`). Se llenan solas con cada dirección
 * nueva que la persona escribe al pagar o al activar el Club, para que no la escriba dos veces
 * (ver ~/lib/addressBook.server). Cada una lleva a quién se entrega y su teléfono porque puede
 * ser la casa de alguien más.
 */
const savedAddressSchema = new Schema({
  label: { type: String, trim: true, default: "", maxlength: 40 },
  name: { type: String, trim: true, default: "", maxlength: 100 },
  phone: { type: String, trim: true, default: "", maxlength: 20 },
  line1: { type: String, trim: true, default: "" },
  line2: { type: String, trim: true, default: "" },
  city: { type: String, trim: true, default: "" },
  state: { type: String, trim: true, default: "" },
  postalCode: { type: String, trim: true, default: "" },
  country: { type: String, trim: true, default: "MX" },
  /** Calle + código postal normalizados: así la misma dirección escrita distinto no se guarda dos veces. */
  key: { type: String, default: "" },
  lastUsedAt: { type: Date, default: Date.now },
});

/**
 * Punto de Recarga STOPee: veterinaria, pet shop o vecino aliado que recarga bidones. Solo lo
 * activa un administrador (ver /admin/aliados y la ficha del cliente). Sus datos se publican en
 * /puntos-de-recarga únicamente si `isPublic` está activo, y eso lo marca el admin cuando el
 * aliado lo autoriza: nunca por defecto.
 */
const allyStationSchema = new Schema(
  {
    businessName: { type: String, trim: true, default: "", maxlength: 80 },
    neighborhood: { type: String, trim: true, default: "", maxlength: 80 },
    city: { type: String, trim: true, default: "CDMX", maxlength: 60 },
    address: { type: String, trim: true, default: "", maxlength: 160 },
    schedule: { type: String, trim: true, default: "", maxlength: 120 },
    whatsapp: { type: String, trim: true, default: "", maxlength: 20 },
    /** Enlace de Google Maps al punto (opcional). Sin él, el botón del directorio busca la dirección en Maps. */
    mapsUrl: { type: String, trim: true, default: "", maxlength: 500 },
    isPublic: { type: Boolean, default: false },
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

/**
 * Datos para facturar (CFDI 4.0). Totalmente opcionales: nadie queda sin comprar por no tenerlos. Se
 * guardan ya limpios (ver validateBillingInfo en ~/lib/fiscal) y los códigos del SAT van como código
 * ("612", "G03"), no como texto, para poder copiarlos tal cual al sistema que emite la factura.
 */
const billingInfoSchema = new Schema(
  {
    rfc: { type: String, trim: true, uppercase: true, maxlength: 13 },
    razonSocial: { type: String, trim: true, maxlength: 200 },
    regimenFiscal: { type: String, trim: true, maxlength: 3 },
    codigoPostalFiscal: { type: String, trim: true, maxlength: 5 },
    usoCfdi: { type: String, trim: true, maxlength: 3 },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    /** Cuándo confirmó que el correo es suyo (enlace del correo o restablecer contraseña). Vacío = sin confirmar. */
    emailVerifiedAt: { type: Date },
    /** Cuándo aceptó recibir promociones y novedades por correo. Vacío = no ha aceptado (ver ~/lib/marketing). */
    marketingOptInAt: { type: Date },
    /** Último cambio de contraseña: las sesiones iniciadas antes de este momento dejan de valer. */
    passwordChangedAt: { type: Date },
    name: { type: String, trim: true },
    stripeCustomerId: { type: String },
    /** @deprecated usar `dogs` — se conserva por el registro histórico y como fallback de despliegue. */
    dogName: { type: String, trim: true },
    phone: { type: String, trim: true, default: "" },
    address: { type: addressSchema, default: () => ({}) },
    savedAddresses: { type: [savedAddressSchema], default: [] },
    /** Datos de facturación guardados para futuras compras. Vacío = no ha guardado ninguno. */
    billingInfo: { type: billingInfoSchema, default: undefined },
    /** Aliado de recarga: lo activa un administrador. No es un rol (el rol es solo del equipo). */
    isRefillAlly: { type: Boolean, default: false },
    allyStation: { type: allyStationSchema, default: undefined },
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

// En desarrollo se re-registra el modelo en cada recarga: si no, mongoose conserva el esquema
// viejo y descarta en silencio los campos nuevos al guardar (igual que en Product).
if (process.env.NODE_ENV !== "production" && models.User) {
  mongoose.deleteModel("User");
}

export const UserModel =
  (models.User as Model<UserDoc>) ?? model<UserDoc>("User", userSchema);
