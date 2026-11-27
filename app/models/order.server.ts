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

/**
 * Qué efectos secundarios del pago ya se aplicaron para este pedido (existencias,
 * cupón, lista de espera, lealtad…). Cada uno se reclama de forma atómica antes
 * de ejecutarse, así que un reintento del webhook de Stripe (porque falló a la
 * mitad, o llegó dos veces) retoma lo que faltó sin repetir lo que ya se hizo.
 * Los pedidos anteriores a este control no lo tienen y no se vuelven a procesar.
 */
const effectsSchema = new Schema(
  {
    stock: { type: Boolean, default: false },
    promotion: { type: Boolean, default: false },
    lead: { type: Boolean, default: false },
    loyalty: { type: Boolean, default: false },
    subscription: { type: Boolean, default: false },
    refund: { type: Boolean, default: false },
    confirmationEmail: { type: Boolean, default: false },
  },
  { _id: false },
);

/** Datos fiscales que el cliente capturó al pagar (CFDI 4.0). Solo existen si pidió factura. */
const orderBillingSchema = new Schema(
  {
    rfc: { type: String, trim: true, uppercase: true },
    razonSocial: { type: String, trim: true },
    regimenFiscal: { type: String, trim: true },
    codigoPostalFiscal: { type: String, trim: true },
    usoCfdi: { type: String, trim: true },
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
    effects: { type: effectsSchema, default: undefined },
    attribution: { type: attributionSchema, default: () => ({}) },
    /** Promoción redimida en este pedido, si hubo una (para medir efectividad en el dashboard). */
    promotion: {
      id: { type: Schema.Types.ObjectId, ref: "Promotion" },
      name: { type: String },
      type: { type: String },
    },
    /** true si esta orden cuenta para el contador de fidelidad (compra individual, no de suscripción) */
    countsTowardLoyalty: { type: Boolean, default: true },
    /** Costo de envío cobrado en este pedido (ya incluido en netAmount) — ver ~/models/shipping.server. */
    shippingCost: { type: Number, default: 0 },
    /** Método elegido por el cliente: "pickup" (punto de entrega), "home" (domicilio) o vacío en pedidos anteriores / sin envío. */
    shippingMethod: { type: String, default: "" },
    /** Nombre del método tal como lo vio el cliente al pagar (se guarda porque el admin puede renombrarlo después). */
    shippingMethodLabel: { type: String, default: "" },
    /** true si el envío salió gratis por alcanzar el monto mínimo. */
    shippingFree: { type: Boolean, default: false },
    /** El cliente marcó «Requiero factura (CFDI)» al pagar. Sin marcar, puede pedirla después por correo. */
    requiresInvoice: { type: Boolean, default: false },
    billingInfo: { type: orderBillingSchema, default: undefined },
    /** Cuándo se marcó como facturada (la factura se emite a mano fuera de la tienda). */
    invoiceIssuedAt: { type: Date },
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

// Consultas frecuentes: "Mis pedidos" (por usuario), dashboard y exportaciones
// (por fecha y estado), búsqueda por correo y por PaymentIntent (reembolsos).
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ email: 1 });
orderSchema.index({ requiresInvoice: 1, createdAt: -1 });
orderSchema.index({ stripePaymentIntentId: 1 }, { sparse: true });

export type OrderDoc = InferSchemaType<typeof orderSchema>;

// En desarrollo se re-registra el modelo en cada recarga: si no, mongoose conserva el esquema viejo y descarta en
// silencio los campos nuevos al guardar (igual que en Product, User y Promotion).
if (process.env.NODE_ENV !== "production" && models.Order) {
  mongoose.deleteModel("Order");
}

export const OrderModel =
  (models.Order as Model<OrderDoc>) ?? model<OrderDoc>("Order", orderSchema);
