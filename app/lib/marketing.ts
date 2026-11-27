/**
 * Permiso para mandar promociones y novedades por correo. Siempre es opcional, empieza sin marcar y se puede
 * retirar cuando la persona quiera. Lo que se guarda es la FECHA en que lo aceptó (`marketingOptInAt`), para
 * poder demostrarlo; sin fecha, no hay permiso. Sin base de datos: lo usan igual las pantallas y el servidor.
 */
export const MARKETING_FIELD = "marketing";

export const MARKETING_LABEL = "Quiero recibir promociones y novedades de STOPee por correo";
export const MARKETING_HINT = "Es opcional y no cambia tu compra. Puedes dejar de recibirlas cuando quieras.";

/** ¿Marcó la casilla? Sin marcar (o sin el campo) es que no. */
export function readMarketingOptIn(formData: FormData): boolean {
  return formData.get(MARKETING_FIELD) === "on";
}
