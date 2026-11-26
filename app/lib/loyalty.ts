export type LoyaltyTier = {
  rewardType?: "discount" | "gift" | null;
  percentage?: number | null;
  giftDescription?: string | null;
};

/**
 * Qué recompensa toca al completar un ciclo, según cuántos ciclos ya
 * completó (0 = primera vez). Si completó más ciclos que recompensas
 * definidas, se repite la última — así un programa con solo 2 niveles
 * configurados no se queda sin premio en el 3er ciclo en adelante.
 */
export function resolveLoyaltyTier(cyclesCompleted: number, tiers: LoyaltyTier[]): LoyaltyTier {
  if (tiers.length === 0) return { rewardType: "discount", percentage: 10 };
  const index = Math.min(Math.max(cyclesCompleted, 0), tiers.length - 1);
  return tiers[index];
}

/** La recompensa en palabras para mostrarla al cliente: «10% de descuento» o el regalo que sea. */
export function describeLoyaltyReward(reward: {
  rewardType?: "discount" | "gift" | null;
  percentage?: number | null;
  giftDescription?: string | null;
}): string {
  if (reward.rewardType === "gift" && reward.giftDescription) return reward.giftDescription;
  if (reward.percentage) return `${reward.percentage}% de descuento en tu siguiente pedido`;
  return "una recompensa para tu siguiente pedido";
}
