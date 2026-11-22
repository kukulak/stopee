import { weeksFromKey } from "~/lib/subscriptionConfig";

const AVG_WEEKS_PER_MONTH = 4.345;

/** Normaliza el monto de una entrega a su equivalente mensual, según cada cuántas semanas se cobra. */
export function monthlyEquivalent(amountMxn: number, frequency: string): number {
  const weeks = weeksFromKey(frequency);
  if (!weeks) return amountMxn;
  return (amountMxn * AVG_WEEKS_PER_MONTH) / weeks;
}
