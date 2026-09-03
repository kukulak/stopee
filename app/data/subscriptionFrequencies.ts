/**
 * Frecuencias soportadas por el Auto-Envío Periódico. Stripe Billing solo
 * admite intervalos "week"/"month" con un `interval_count`, así que
 * mapeamos cada frecuencia de negocio a semanas/meses nativos de Stripe.
 * Este módulo es client-safe: no importa `stripe.server`.
 */
export const SUBSCRIPTION_FREQUENCIES = {
  "3-semanas": { interval: "week", intervalCount: 3, label: "Cada 3 semanas" },
  "4-semanas": { interval: "month", intervalCount: 1, label: "Cada 4 semanas (mensual)" },
  "6-semanas": { interval: "week", intervalCount: 6, label: "Cada 6 semanas" },
  "8-semanas": { interval: "month", intervalCount: 2, label: "Cada 8 semanas (bimestral)" },
} as const satisfies Record<
  string,
  { interval: "week" | "month"; intervalCount: number; label: string }
>;

export type SubscriptionFrequency = keyof typeof SUBSCRIPTION_FREQUENCIES;
