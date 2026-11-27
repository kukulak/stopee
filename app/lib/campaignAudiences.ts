/** Las listas de personas para campañas (el criterio de cada una vive en campaignAudiences.server). Compartido por la pantalla y el servidor. */
export const AUDIENCES = [
  { key: "compraron", label: "Ya compraron", hint: "Con al menos un pedido pagado." },
  { key: "sin-compra", label: "Se registraron y no han comprado", hint: "Cuenta o lista de espera, sin pedidos." },
  { key: "carrito", label: "Dejaron el carrito", hint: "Iniciaron el pago con sesión abierta en los últimos 14 días y no compraron." },
  { key: "auto-envio", label: "Tienen auto-envío activo", hint: "Con una suscripción vigente." },
] as const;
export type AudienceKey = (typeof AUDIENCES)[number]["key"];
export const isAudience = (value: unknown): value is AudienceKey => AUDIENCES.some((a) => a.key === value);
