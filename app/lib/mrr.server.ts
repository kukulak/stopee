import { SUBSCRIPTION_FREQUENCIES, type SubscriptionFrequency } from "~/data/subscriptionFrequencies";

const AVG_WEEKS_PER_MONTH = 4.345;

/** Normaliza el monto de una entrega a su equivalente mensual, según el intervalo real de Stripe. */
export function monthlyEquivalent(amountMxn: number, frequency: string): number {
  const freq = SUBSCRIPTION_FREQUENCIES[frequency as SubscriptionFrequency];
  if (!freq) return amountMxn;
  if (freq.interval === "month") return amountMxn / freq.intervalCount;
  return (amountMxn * AVG_WEEKS_PER_MONTH) / freq.intervalCount;
}
