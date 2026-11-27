import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { connectDB } from "~/lib/db.server";

const { Schema, model, models } = mongoose;

/**
 * Envíos del lanzamiento: dos métodos fijos (punto de entrega y domicilio) en
 * vez de zonas por código postal. Todo lo que el negocio puede querer cambiar
 * (nombre, nota, costo, si está activo, envío gratis desde cierto monto) vive
 * aquí y se edita en /admin/shipping — nada de esto está escrito en el código
 * de la tienda.
 */
import { SHIPPING_METHOD_IDS, isShippingMethodId, type ShippingMethodId } from "~/lib/shippingMethods";
import { DEFAULT_DELIVERY_ZONE, parsePostalRanges, type DeliveryZone } from "~/lib/deliveryZone";

export { SHIPPING_METHOD_IDS, isShippingMethodId };
export type { ShippingMethodId };

export type ShippingMethodConfig = {
  label: string;
  note: string;
  cost: number;
  isActive: boolean;
  /** Tiempo estimado de entrega, en una frase corta (p. ej. "3 a 5 días hábiles"). Vacío = no se muestra. */
  deliveryTime: string;
  /** Explicación para la página /envios, en markdown. */
  details: string;
};

export type ShippingConfig = {
  /** Apagado = todos los pedidos salen sin costo de envío y el carrito no ofrece métodos. */
  isEnabled: boolean;
  methods: Record<ShippingMethodId, ShippingMethodConfig>;
  freeShippingEnabled: boolean;
  /** Subtotal (ya con descuentos) a partir del cual el envío es gratis. */
  freeShippingThreshold: number;
  /** Envío gratis para Puntos de Recarga (aliados): tiene su propio interruptor, independiente del de clientes. */
  allyFreeShippingEnabled: boolean;
  /** Subtotal a partir del cual el envío es gratis para un aliado. */
  allyFreeShippingThreshold: number;
  /** Dónde se entrega: fuera de estos códigos postales no se puede pagar (ver ~/lib/deliveryZone). */
  zone: DeliveryZone;
};

export const DEFAULT_SHIPPING_CONFIG: ShippingConfig = {
  isEnabled: true,
  methods: {
    pickup: {
      label: "Recolección en punto de entrega",
      note: "Te asignaremos el punto comercial más cercano a tu código postal.",
      cost: 69,
      isActive: true,
      deliveryTime: "",
      details: `Recibes tu pedido en un **punto de entrega** cercano a ti, en lugar de en tu casa: un locker PuntoPost o un comercio aliado.

## Cómo funciona

1. Eliges esta opción en el carrito y, al pagar, nos das tu dirección con tu código postal.
2. Te asignamos el punto comercial más cercano a ese código postal.
3. Recoges tu pedido en ese punto.

## Ideal si

- No siempre hay alguien en casa para recibir paquetes.
- Prefieres el costo de envío más bajo.`,
    },
    home: {
      label: "Envío estándar a domicilio",
      note: "Despachos programados los días martes y viernes.",
      cost: 150,
      isActive: true,
      deliveryTime: "",
      details: `Te lo llevamos a la **dirección que escribas al pagar**, con FedEx o Estafeta.

## Cómo funciona

1. Eliges esta opción en el carrito y, al pagar, escribes tu dirección completa y un teléfono de contacto.
2. Despachamos los pedidos **los días martes y viernes**.
3. La paquetería lo entrega en tu domicilio.

## Ideal si

- Quieres recibirlo directamente en tu casa u oficina.
- No tienes un punto de entrega cerca.`,
    },
  },
  freeShippingEnabled: false,
  freeShippingThreshold: 599,
  allyFreeShippingEnabled: true,
  allyFreeShippingThreshold: 1699,
  zone: DEFAULT_DELIVERY_ZONE,
};

const methodSchema = new Schema(
  {
    label: { type: String, trim: true, maxlength: 100 },
    note: { type: String, trim: true, maxlength: 200 },
    cost: { type: Number, min: 0 },
    isActive: { type: Boolean },
    deliveryTime: { type: String, trim: true, maxlength: 120 },
    details: { type: String, maxlength: 4000 },
  },
  { _id: false },
);

/** Configuración general del envío — singleton, igual que SiteSettings. */
const shippingSettingsSchema = new Schema(
  {
    isEnabled: { type: Boolean, default: true },
    pickup: { type: methodSchema },
    home: { type: methodSchema },
    freeShippingEnabled: { type: Boolean, default: false },
    freeShippingThreshold: { type: Number, min: 0, default: 599 },
    allyFreeShippingEnabled: { type: Boolean, default: true },
    allyFreeShippingThreshold: { type: Number, min: 0, default: 1699 },
    zoneName: { type: String, trim: true, maxlength: 80 },
    zonePostalRanges: { type: String, trim: true, maxlength: 2000 },
  },
  { timestamps: true },
);

export type ShippingSettingsDoc = InferSchemaType<typeof shippingSettingsSchema>;

// En desarrollo se re-registra el modelo en cada recarga: si no, mongoose conserva el esquema viejo y descarta en
// silencio los campos nuevos al guardar (igual que en Product, User y AllyRequest).
if (process.env.NODE_ENV !== "production" && models.ShippingSettings) {
  mongoose.deleteModel("ShippingSettings");
}

export const ShippingSettingsModel =
  (models.ShippingSettings as Model<ShippingSettingsDoc>) ??
  model<ShippingSettingsDoc>("ShippingSettings", shippingSettingsSchema);

function mergeMethod(
  stored:
    | {
        label?: string | null;
        note?: string | null;
        cost?: number | null;
        isActive?: boolean | null;
        deliveryTime?: string | null;
        details?: string | null;
      }
    | null
    | undefined,
  fallback: ShippingMethodConfig,
): ShippingMethodConfig {
  return {
    label: stored?.label?.trim() || fallback.label,
    note: stored?.note ?? fallback.note,
    cost: typeof stored?.cost === "number" && stored.cost >= 0 ? stored.cost : fallback.cost,
    isActive: typeof stored?.isActive === "boolean" ? stored.isActive : fallback.isActive,
    deliveryTime: stored?.deliveryTime ?? fallback.deliveryTime,
    details: typeof stored?.details === "string" ? stored.details : fallback.details,
  };
}

/** Lee la configuración y completa con los valores por defecto lo que falte (p. ej. la base de datos de antes de este cambio). */
export async function getShippingConfig(): Promise<ShippingConfig> {
  await connectDB();
  const stored = await ShippingSettingsModel.findOne().lean();
  return {
    isEnabled: stored?.isEnabled ?? DEFAULT_SHIPPING_CONFIG.isEnabled,
    methods: {
      pickup: mergeMethod(stored?.pickup, DEFAULT_SHIPPING_CONFIG.methods.pickup),
      home: mergeMethod(stored?.home, DEFAULT_SHIPPING_CONFIG.methods.home),
    },
    freeShippingEnabled: stored?.freeShippingEnabled ?? DEFAULT_SHIPPING_CONFIG.freeShippingEnabled,
    freeShippingThreshold: stored?.freeShippingThreshold ?? DEFAULT_SHIPPING_CONFIG.freeShippingThreshold,
    allyFreeShippingEnabled: stored?.allyFreeShippingEnabled ?? DEFAULT_SHIPPING_CONFIG.allyFreeShippingEnabled,
    allyFreeShippingThreshold: stored?.allyFreeShippingThreshold ?? DEFAULT_SHIPPING_CONFIG.allyFreeShippingThreshold,
    zone: mergeZone(stored?.zoneName, stored?.zonePostalRanges),
  };
}

/**
 * Si lo guardado no se puede leer (rango roto, vacío) se vuelve a la zona de
 * lanzamiento en vez de dejar la tienda sin poder cobrar a nadie.
 */
function mergeZone(name: string | null | undefined, postalRanges: string | null | undefined): DeliveryZone {
  const cleanName = name?.trim() || DEFAULT_DELIVERY_ZONE.name;
  const cleanRanges = postalRanges?.trim();
  if (cleanRanges && !parsePostalRanges(cleanRanges).error) {
    return { name: cleanName, postalRanges: cleanRanges };
  }
  return { name: cleanName, postalRanges: DEFAULT_DELIVERY_ZONE.postalRanges };
}

export async function saveShippingConfig(config: ShippingConfig) {
  await connectDB();
  await ShippingSettingsModel.findOneAndUpdate(
    {},
    {
      $set: {
        isEnabled: config.isEnabled,
        pickup: config.methods.pickup,
        home: config.methods.home,
        freeShippingEnabled: config.freeShippingEnabled,
        freeShippingThreshold: config.freeShippingThreshold,
        allyFreeShippingEnabled: config.allyFreeShippingEnabled,
        allyFreeShippingThreshold: config.allyFreeShippingThreshold,
        zoneName: config.zone.name,
        zonePostalRanges: config.zone.postalRanges,
      },
    },
    { upsert: true },
  );
}

// --- Cotización -------------------------------------------------------------

export type ShippingOption = {
  id: ShippingMethodId;
  label: string;
  note: string;
  /** Costo de lista del método. */
  baseCost: number;
  /** Lo que se cobra de verdad (0 si la compra alcanza el envío gratis). */
  cost: number;
  isFree: boolean;
};

export type ShippingQuote = {
  /** false = el negocio apagó el cobro de envío; no hay métodos que elegir. */
  enabled: boolean;
  options: ShippingOption[];
  /** El método elegido (o el primero activo si el elegido ya no existe). null si no hay envío que cobrar. */
  selected: ShippingOption | null;
  freeThreshold: number | null;
  /** Cuánto falta para el envío gratis; null si no aplica o ya se alcanzó. */
  freeRemaining: number | null;
};

/**
 * Función pura: dado el subtotal de PRODUCTOS (ya con descuento, sin envío), el
 * método que eligió el cliente y si quien compra es un Punto de Recarga, devuelve
 * lo que se ofrece y se cobra. La usan el carrito (para mostrarlo) y el checkout
 * (para cobrarlo), así nunca pueden diferir.
 *
 * Meta de envío gratis: la de clientes (si está prendida) y, para un aliado, la
 * suya (si está prendida). Un aliado cuenta con las dos y gana la más baja,
 * para que una promoción abierta a todos nunca le salga peor que a un cliente.
 */
export function buildShippingQuote(
  config: ShippingConfig,
  subtotalMxn: number,
  selectedId?: string | null,
  viewer: { isAlly?: boolean } = {},
): ShippingQuote {
  if (!config.isEnabled) {
    return { enabled: false, options: [], selected: null, freeThreshold: null, freeRemaining: null };
  }

  const goals: number[] = [];
  if (config.freeShippingEnabled && config.freeShippingThreshold > 0) goals.push(config.freeShippingThreshold);
  if (viewer.isAlly && config.allyFreeShippingEnabled && config.allyFreeShippingThreshold > 0) goals.push(config.allyFreeShippingThreshold);
  const freeGoal = goals.length > 0 ? Math.min(...goals) : null;
  const qualifiesForFree = freeGoal !== null && subtotalMxn >= freeGoal;

  const options: ShippingOption[] = SHIPPING_METHOD_IDS.filter((id) => config.methods[id].isActive).map((id) => {
    const method = config.methods[id];
    return {
      id,
      label: method.label,
      note: method.note,
      baseCost: method.cost,
      cost: qualifiesForFree ? 0 : method.cost,
      isFree: qualifiesForFree,
    };
  });

  const selected = options.find((option) => option.id === selectedId) ?? options[0] ?? null;

  return {
    enabled: true,
    options,
    selected,
    freeThreshold: freeGoal,
    freeRemaining: freeGoal !== null && !qualifiesForFree && subtotalMxn > 0 ? Math.max(0, freeGoal - subtotalMxn) : null,
  };
}

export async function getShippingQuote(subtotalMxn: number, selectedId?: string | null, viewer: { isAlly?: boolean } = {}) {
  return buildShippingQuote(await getShippingConfig(), subtotalMxn, selectedId, viewer);
}
