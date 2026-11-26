/**
 * Solo el primer nombre, para saludar sin usar el nombre completo con apellidos
 * («Christian Valderrama» → «Christian»). El nombre completo sigue guardado tal
 * cual; esto solo cambia lo que se muestra en pantalla.
 */
export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}
