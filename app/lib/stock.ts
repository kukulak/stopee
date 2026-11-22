/**
 * Reglas de existencia compartidas por servidor y navegador: el servidor es
 * quien manda (nadie puede saltarse el límite editando el HTML), la interfaz
 * solo usa lo mismo para no ofrecer lo que luego se va a rechazar.
 */

/** Cuántas unidades más puede agregar el cliente dado lo que ya tiene en el carrito. */
export function remainingToAdd(stock: number, inCart: number): number {
  return Math.max(0, Math.floor(stock) - Math.max(0, inCart));
}

export function soldOutMessage(name: string): string {
  return `${name} está agotado por ahora.`;
}

export function stockLimitMessage(stock: number, name: string): string {
  return stock === 1 ? `Solo queda 1 unidad de ${name}.` : `Solo hay ${stock} unidades de ${name}.`;
}
