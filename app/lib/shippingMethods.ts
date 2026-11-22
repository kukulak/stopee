/**
 * Los dos métodos de envío fijos. Vive fuera de `shipping.server.ts` a propósito:
 * la pantalla de /admin/shipping también necesita esta lista en el navegador, y
 * Remix no deja que el código del navegador importe módulos `.server`.
 */
export const SHIPPING_METHOD_IDS = ["pickup", "home"] as const;
export type ShippingMethodId = (typeof SHIPPING_METHOD_IDS)[number];

export function isShippingMethodId(value: unknown): value is ShippingMethodId {
  return typeof value === "string" && (SHIPPING_METHOD_IDS as readonly string[]).includes(value);
}
