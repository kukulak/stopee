/**
 * "valderrama.christian@gmail.com" -> "v***n@gmail.com".
 *
 * Confirma a qué bandeja va un mensaje sin escribir el correo completo en la
 * pantalla (alguien mirando por encima del hombro, una captura compartida).
 * No sirve para saber si una cuenta existe: se muestra igual en los dos casos.
 */
export function maskEmail(email: string): string {
  const [name, domain] = email.trim().split("@");
  if (!name || !domain) return "";
  const last = name.length >= 4 ? name[name.length - 1] : "";
  return `${name[0]}***${last}@${domain}`;
}
