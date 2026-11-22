/**
 * Destino de redirección seguro tras iniciar sesión. Solo se aceptan rutas
 * internas del propio sitio: nunca "https://otro-sitio", "//otro-sitio" ni
 * "/\otro-sitio" (algunos navegadores tratan la diagonal invertida como
 * diagonal normal), para que un enlace con ?redirectTo= no pueda mandar al
 * cliente a una página falsa después de entrar.
 *
 * Sin sufijo ".server": también lo usan los componentes del navegador para
 * mostrar el valor ya saneado en el campo oculto del formulario.
 */
export function safeRedirectTarget(raw: string | null | undefined, fallback = "/cuenta"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // Caracteres de control (saltos de línea, tabuladores): permiten esconder
  // un destino externo o partir la cabecera Location.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}
