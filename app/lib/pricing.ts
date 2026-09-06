/** Suma (precio × cantidad × (1 - descuento%)) de cada componente del paquete. Client-safe. */
export function computeBundlePrice(
  items: { price: number; quantity: number; discountPercentage: number }[],
) {
  const total = items.reduce((sum, item) => {
    const lineTotal = item.price * item.quantity * (1 - item.discountPercentage / 100);
    return sum + lineTotal;
  }, 0);
  return Math.round(total * 100) / 100;
}
