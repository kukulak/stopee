import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { connectDB } from "~/lib/db.server";
import { DEFAULT_GATE_COPY } from "~/lib/passwordGateCopy";
import { createTtlCache } from "~/lib/ttlCache.server";

export { DEFAULT_GATE_COPY };

const { Schema, model, models } = mongoose;

/**
 * Compuerta de acceso exclusivo con contraseña — un solo documento
 * (singleton, igual que SiteSettings) que se reconfigura y reactiva para
 * cada campaña de ventas privadas, en vez de tener un texto/estado fijo en
 * código. Ver app/routes/acceso-privado.tsx (pantalla pública) y
 * app/routes/admin.password-gate.tsx (backoffice).
 */
const passwordGateSchema = new Schema(
  {
    // --- Estado y calendario ---
    /** Interruptor manual: en true fuerza la compuerta activa sin importar fechas. En false, manda el rango de fechas (si hay uno configurado). */
    isActive: { type: Boolean, default: false },
    startsAt: { type: Date },
    endsAt: { type: Date },

    // --- Alcance ---
    scopeType: { type: String, enum: ["all_store", "specific_routes", "specific_products"], default: "all_store" },
    /** Prefijos de ruta (p. ej. "/tienda", "/blog") — solo aplica con scopeType "specific_routes". */
    scopeRoutes: { type: [String], default: [] },
    /** SKUs de producto — solo aplica con scopeType "specific_products". */
    scopeProductSkus: { type: [String], default: [] },

    // --- Seguridad y descuento ---
    password: { type: String, default: "", trim: true },
    /** Promoción tipo "coupon" que se aplica automáticamente al desbloquear — ver /admin/discounts. */
    linkedPromotionId: { type: Schema.Types.ObjectId, ref: "Promotion" },

    // --- CMS dinámico de la pantalla pública (todo opcional; ver DEFAULT_GATE_COPY para el respaldo) ---
    kicker: { type: String, default: "", trim: true },
    title: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    passwordPlaceholder: { type: String, default: "", trim: true },
    buttonText: { type: String, default: "", trim: true },
    errorMessage: { type: String, default: "", trim: true },
    cartBannerMessage: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

export type PasswordGateDoc = InferSchemaType<typeof passwordGateSchema>;

export const PasswordGateModel =
  (models.PasswordGate as Model<PasswordGateDoc>) ?? model<PasswordGateDoc>("PasswordGate", passwordGateSchema);

async function getOrCreatePasswordGate() {
  await connectDB();
  const existing = await PasswordGateModel.findOne();
  if (existing) return existing;
  return PasswordGateModel.create({});
}

export async function getPasswordGateConfig() {
  const gate = await getOrCreatePasswordGate();
  return {
    id: String(gate._id),
    isActive: gate.isActive,
    startsAt: gate.startsAt ?? null,
    endsAt: gate.endsAt ?? null,
    scopeType: gate.scopeType as "all_store" | "specific_routes" | "specific_products",
    scopeRoutes: gate.scopeRoutes ?? [],
    scopeProductSkus: gate.scopeProductSkus ?? [],
    password: gate.password ?? "",
    linkedPromotionId: gate.linkedPromotionId ? String(gate.linkedPromotionId) : null,
    kicker: gate.kicker || DEFAULT_GATE_COPY.kicker,
    title: gate.title || DEFAULT_GATE_COPY.title,
    description: gate.description || DEFAULT_GATE_COPY.description,
    passwordPlaceholder: gate.passwordPlaceholder || DEFAULT_GATE_COPY.passwordPlaceholder,
    buttonText: gate.buttonText || DEFAULT_GATE_COPY.buttonText,
    errorMessage: gate.errorMessage || DEFAULT_GATE_COPY.errorMessage,
    cartBannerMessage: gate.cartBannerMessage || DEFAULT_GATE_COPY.cartBannerMessage,
  };
}

export type PasswordGateConfig = Awaited<ReturnType<typeof getPasswordGateConfig>>;

const getPasswordGateConfigCache = createTtlCache<Awaited<ReturnType<typeof getPasswordGateConfig>>>();

/** getPasswordGateConfig con caché corta, para el layout raíz (que lo lee en cada petición). */
export function getPasswordGateConfigCached() {
  return getPasswordGateConfigCache.get(getPasswordGateConfig);
}

export async function updatePasswordGateConfig(patch: Partial<PasswordGateDoc>) {
  getPasswordGateConfigCache.clear();
  const gate = await getOrCreatePasswordGate();
  Object.assign(gate, patch);
  await gate.save();
  getPasswordGateConfigCache.clear();
  return gate;
}

/**
 * Si la compuerta debe considerarse activa AHORA MISMO: el switch manual
 * manda si está en true (fuerza activa); si está en false, se respeta la
 * ventana de fechas cuando hay una configurada.
 */
export function isGateWindowActive(config: Pick<PasswordGateConfig, "isActive" | "startsAt" | "endsAt">): boolean {
  if (config.isActive) return true;
  if (config.startsAt && config.endsAt) {
    const now = Date.now();
    return now >= new Date(config.startsAt).getTime() && now <= new Date(config.endsAt).getTime();
  }
  return false;
}

/** Si la compuerta activa protege esta ruta en particular, según su alcance configurado. */
export function isPathGated(config: PasswordGateConfig, pathname: string): boolean {
  if (config.scopeType === "all_store") return pathname === "/tienda" || pathname.startsWith("/tienda/");
  if (config.scopeType === "specific_routes") return config.scopeRoutes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (config.scopeType === "specific_products") {
    const match = pathname.match(/^\/tienda\/([^/]+)$/);
    return Boolean(match && config.scopeProductSkus.some((sku) => sku.toLowerCase() === match[1].toLowerCase()));
  }
  return false;
}

/** Si un SKU puntual está protegido — usado para bloquear "agregar al carrito" en /tienda cuando el alcance es "productos seleccionados". */
export function isSkuGated(config: PasswordGateConfig, sku: string): boolean {
  if (config.scopeType === "all_store") return true;
  if (config.scopeType === "specific_products") return config.scopeProductSkus.some((s) => s.toLowerCase() === sku.toLowerCase());
  return false;
}
