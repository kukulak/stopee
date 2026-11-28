/**
 * Solo el primer nombre, para saludar sin usar el nombre completo con apellidos
 * («Christian Valderrama» → «Christian»). El nombre completo sigue guardado tal
 * cual; esto solo cambia lo que se muestra en pantalla.
 */
export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

/** «Christian» + «Valderrama Gómez» → «Christian Valderrama Gómez». Lo que falte simplemente no se escribe. */
export function fullNameOf(firstName: string | null | undefined, lastName: string | null | undefined): string {
  return [firstName, lastName]
    .map((part) => (part ?? "").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join(" ");
}

/**
 * Para las cuentas que guardaron un solo nombre: la primera palabra como nombre y el resto como apellidos. Es solo
 * una sugerencia para llenar el formulario (en «María José Pérez» se equivoca), y la persona la corrige una vez.
 */
export function splitFullName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: words[0] ?? "", lastName: words.slice(1).join(" ") };
}

/** «Y» se vuelve «e» delante de un nombre que empieza con «i» o «hi» (no «hie»): «Sama e Isis». */
function conjunctionBefore(name: string): "y" | "e" {
  const plain = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /^(i|hi(?!e))/.test(plain) ? "e" : "y";
}

/** «Rocket», «Rocket y Sama», «Christian, Rocket y Sama». */
export function joinNames(names: Array<string | null | undefined>): string {
  const list = names.map((n) => (n ?? "").trim()).filter(Boolean);
  if (list.length <= 1) return list[0] ?? "";
  const last = list[list.length - 1];
  return `${list.slice(0, -1).join(", ")} ${conjunctionBefore(last)} ${last}`;
}

/**
 * El saludo de Mi cuenta: la persona y todos sus perritos. «Hola, Christian, Rocket y Sama»; sin perritos, «Hola,
 * Christian»; sin nada que decir, «Hola».
 */
export function greetingFor(firstName: string | null | undefined, dogNames: Array<string | null | undefined>): string {
  const who = joinNames([firstName, ...dogNames]);
  return who ? `Hola, ${who}` : "Hola";
}
