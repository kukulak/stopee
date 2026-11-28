export type LegalBusinessData = {
  razonSocial: string;
  direccionFiscal: string;
  correoContacto: string;
  tiemposEnvio: string;
  politicaDevoluciones: string;
  /** Opcionales: vienen de la configuración del auto-envío; si no se pasan, el marcador queda visible. */
  frecuenciasAutoenvio?: string;
  descuentoAutoenvio?: string;
};

/** Variables que pueden quedar vacías a propósito (p. ej. sin descuento) sin mostrar el marcador "completa". */
const MAY_BE_EMPTY = new Set(["descuentoAutoenvio"]);

const FIELD_LABELS: Record<keyof LegalBusinessData, string> = {
  razonSocial: "razón social",
  direccionFiscal: "dirección fiscal",
  correoContacto: "correo de contacto",
  tiemposEnvio: "tiempos de envío",
  politicaDevoluciones: "política de devoluciones",
  frecuenciasAutoenvio: "frecuencias de la suscripción",
  descuentoAutoenvio: "descuento de la suscripción",
};

/**
 * Sustituye variables tipo {{razonSocial}} dentro del markdown legal por el
 * dato real capturado en /admin/legal. Si el admin todavía no ha llenado ese
 * campo, deja un marcador legible entre corchetes en su lugar — así el aviso
 * y los términos siempre se pueden editar sin tocar código, y se nota a
 * simple vista qué falta por completar.
 *
 * Sin sufijo ".server": es lógica pura sin nada sensible, y la necesitamos
 * tanto en el servidor (al renderizar /aviso-de-privacidad y
 * /terminos-y-condiciones) como en el navegador (la vista previa en vivo
 * de /admin/legal). Remix no deja que un componente de cliente importe de
 * un archivo ".server.ts" — de ahí venía el error al abrir esa página.
 */
export function applyLegalVariables(markdown: string, data: LegalBusinessData): string {
  return markdown.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = (data as Record<string, string | undefined>)[key];
    if (MAY_BE_EMPTY.has(key) && typeof value === "string") return value;
    if (value && value.trim()) return value.trim();
    const label = FIELD_LABELS[key as keyof LegalBusinessData];
    return label ? `<mark>[completa: ${label}]</mark>` : match;
  });
}
