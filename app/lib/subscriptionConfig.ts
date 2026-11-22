/**
 * Auto-envío periódico: tipos, valores por defecto y utilidades puras. Todo lo
 * que el negocio puede querer cambiar (nombre del programa, descuento,
 * frecuencias, textos) se guarda en la base de datos y se edita en
 * /admin/subscription; los valores de aquí son solo el punto de partida cuando
 * todavía no se ha guardado nada.
 *
 * Sin sufijo ".server": no importa Stripe ni Mongo, así que también lo usan los
 * componentes del navegador (SubscriptionConfigurator, vista previa del admin).
 */

export type SubscriptionFrequencyConfig = {
  /** Cada cuántas semanas llega la caja (1 a 52). Es la identidad de la frecuencia. */
  weeks: number;
  /** Frase corta bajo el nombre: para quién es esta frecuencia. */
  hint: string;
  recommended: boolean;
  /** Apagada = ya no se ofrece a clientes nuevos, pero quien ya la tiene la conserva. */
  isActive: boolean;
};

export type SubscriptionConfig = {
  /** Cómo se llama el programa de cara al cliente. Vacío = solo "Auto-envío". */
  programName: string;
  /** Porcentaje de descuento en cada entrega (0 = sin descuento). */
  discountPercent: number;
  /** Título del bloque. Puede incluir {descuento}, que se sustituye por el porcentaje. */
  headline: string;
  description: string;
  /** Una ventaja por renglón, con palomita. */
  benefits: string[];
  /** Texto del botón final. */
  ctaLabel: string;
  /** Aviso bajo el precio sobre fechas de entrega y cambios. */
  disclaimer: string;
  frequencies: SubscriptionFrequencyConfig[];
};

export const MAX_SUBSCRIPTION_DISCOUNT_PERCENT = 90;
export const MAX_FREQUENCY_WEEKS = 52;

export const DEFAULT_SUBSCRIPTION_CONFIG: SubscriptionConfig = {
  programName: "Club STOPee",
  discountPercent: 10,
  headline: "Arma tu caja y recíbela sin pensarlo, con {descuento}% de descuento",
  description:
    "Elige qué productos y cuántos de cada uno quieres recibir — desde un litro para tu casa hasta varios para un negocio pet-friendly — y con qué frecuencia.",
  benefits: [
    "Nunca te quedas sin STOPee a medio paseo",
    "Precio congelado aunque suba el de lista",
    "Pausa, cambia la frecuencia o cancela cuando quieras desde tu cuenta",
  ],
  ctaLabel: "Unirme al Club STOPee",
  disclaimer:
    "La periodicidad es aproximada: los envíos salen en días de despacho específicos, así que la fecha real de tu entrega puede moverse unos días. Puedes pausar, cambiar la frecuencia o cancelar cuando quieras desde tu cuenta.",
  frequencies: [
    { weeks: 4, hint: "La opción más elegida", recommended: true, isActive: true },
    { weeks: 6, hint: "Consumo moderado", recommended: false, isActive: true },
    { weeks: 8, hint: "Perros pequeños o paseos cortos", recommended: false, isActive: true },
  ],
};

// --- Frecuencias ------------------------------------------------------------

/** Identificador guardado en las suscripciones y enviado a Stripe, p. ej. "4-semanas". */
export type SubscriptionFrequency = string;

export function frequencyKey(weeks: number): SubscriptionFrequency {
  return `${weeks}-semanas`;
}

/** Semanas de un identificador guardado, o null si no tiene el formato esperado. */
export function weeksFromKey(key: string): number | null {
  const match = /^(\d{1,2})-semanas$/.exec(key);
  if (!match) return null;
  const weeks = Number(match[1]);
  return weeks >= 1 && weeks <= MAX_FREQUENCY_WEEKS ? weeks : null;
}

export function frequencyLabelForWeeks(weeks: number): string {
  return weeks === 1 ? "Cada semana" : `Cada ${weeks} semanas`;
}

/** Nombre legible de un identificador guardado, aunque esa frecuencia ya no se ofrezca. */
export function frequencyLabel(key: string): string {
  const weeks = weeksFromKey(key);
  return weeks === null ? key : frequencyLabelForWeeks(weeks);
}

/**
 * Intervalo de cobro para Stripe. Siempre en semanas exactas: "cada 4 semanas"
 * es cada 28 días, no "una vez al mes".
 */
export function stripeIntervalFor(key: string): { interval: "week"; intervalCount: number } | null {
  const weeks = weeksFromKey(key);
  return weeks === null ? null : { interval: "week", intervalCount: weeks };
}

export function activeFrequencies(config: SubscriptionConfig): SubscriptionFrequencyConfig[] {
  return config.frequencies.filter((f) => f.isActive).sort((a, b) => a.weeks - b.weeks);
}

/** ¿Se puede contratar hoy esta frecuencia? */
export function isOfferedFrequency(config: SubscriptionConfig, key: string): boolean {
  const weeks = weeksFromKey(key);
  return weeks !== null && activeFrequencies(config).some((f) => f.weeks === weeks);
}

/** Frecuencia preseleccionada: la recomendada, si no la primera activa. */
export function defaultFrequencyKey(config: SubscriptionConfig): SubscriptionFrequency {
  const active = activeFrequencies(config);
  const pick = active.find((f) => f.recommended) ?? active[0];
  return frequencyKey(pick?.weeks ?? 4);
}

/** "3, 4 y 6 semanas" — para frases corridas. */
export function describeFrequencies(config: SubscriptionConfig): string {
  const weeks = activeFrequencies(config).map((f) => f.weeks);
  if (weeks.length === 0) return "";
  if (weeks.length === 1) return `cada ${weeks[0]} ${weeks[0] === 1 ? "semana" : "semanas"}`;
  const head = weeks.slice(0, -1).join(", ");
  return `cada ${head} o ${weeks[weeks.length - 1]} semanas`;
}

// --- Textos -----------------------------------------------------------------

/**
 * Valores para las variables {{frecuenciasAutoenvio}} y {{descuentoAutoenvio}} de los
 * términos y condiciones, para que el texto legal siga a lo configurado en /admin/subscription.
 */
export function subscriptionLegalVariables(config: SubscriptionConfig): {
  frecuenciasAutoenvio: string;
  descuentoAutoenvio: string;
} {
  return {
    frecuenciasAutoenvio: describeFrequencies(config),
    descuentoAutoenvio:
      config.discountPercent > 0 ? `, con ${config.discountPercent}% de descuento aplicado automáticamente en cada entrega` : "",
  };
}

export function fillDiscount(text: string, config: Pick<SubscriptionConfig, "discountPercent">): string {
  return text.replace(/\{descuento\}/g, String(config.discountPercent));
}

/** "Club STOPee — Auto-envío periódico", o solo "Auto-envío periódico" si no hay nombre. */
export function programEyebrow(config: Pick<SubscriptionConfig, "programName">): string {
  return config.programName ? `${config.programName} — Auto-envío periódico` : "Auto-envío periódico";
}

/** Cómo llamar al programa en frases sueltas (enlaces, títulos). */
export function programDisplayName(config: Pick<SubscriptionConfig, "programName">): string {
  return config.programName || "Auto-envío";
}
