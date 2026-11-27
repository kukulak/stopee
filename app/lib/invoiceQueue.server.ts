/**
 * La «fila de facturas»: pedidos que pidieron factura, que todavía no se marcan como emitidas y que
 * siguen vigentes (un pedido cancelado o reembolsado ya no se factura).
 *
 * El contador de Pedidos, el CSV de descarga y el botón «Marcar como facturadas» usan este mismo
 * filtro, así que siempre hablan de los mismos pedidos. `until` fija el corte: lo que llegue después
 * de abrir la página no se descarga ni se marca sin haberlo visto.
 */
export function pendingInvoiceFilter(until?: Date) {
  return {
    requiresInvoice: true,
    invoiceIssuedAt: { $exists: false },
    status: { $nin: ["cancelled", "refunded"] },
    ...(until ? { createdAt: { $lte: until } } : {}),
  };
}

/** Lee el corte `hasta` (una fecha ISO) de la dirección o del formulario; si no es válido, no hay corte. */
export function parseCutoff(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
