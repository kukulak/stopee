import { createHmac } from "node:crypto";

/**
 * Secreto de firma propio para cada cookie ("cart", "gate", ...), derivado de
 * SESSION_SECRET. Así, aunque alguien obtuviera la firma de una cookie de bajo
 * valor (el carrito), no le sirve para falsificar otra distinta (la sesión).
 * La sesión de cuenta sigue usando SESSION_SECRET tal cual.
 */
export function cookieSecret(purpose: string): string {
  const base = process.env.SESSION_SECRET;
  if (!base) {
    // Sin respaldo "de desarrollo": un secreto público en el código permitiría
    // falsificar cookies si alguna vez se despliega sin la variable.
    throw new Error("Falta la variable de entorno SESSION_SECRET");
  }
  return createHmac("sha256", base).update(`stopee-cookie:${purpose}`).digest("hex");
}
