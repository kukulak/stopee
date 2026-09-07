/**
 * Unidad de medida de un producto: cantidad numérica + unidad, como hacen los
 * catálogos de retail reales (Amazon, Mercado Libre, Walmart muestran
 * "Presentación: 1 L" o "Contenido neto: 500 g" como dato estructurado, no
 * como texto libre en la descripción). Esto evita crear un producto nuevo
 * solo para expresar "es de 5 litros" o mezclar unidades que no aplican a
 * todos los productos (litros no sirve para bolsas de popo, que se venden
 * por pieza).
 */
export const UNIT_OPTIONS = [
  { value: "ml", label: "Mililitros (ml)", group: "Volumen" },
  { value: "L", label: "Litros (L)", group: "Volumen" },
  { value: "g", label: "Gramos (g)", group: "Peso" },
  { value: "kg", label: "Kilogramos (kg)", group: "Peso" },
  { value: "pieza", label: "Piezas", group: "Cantidad" },
  { value: "paquete", label: "Paquete/Set", group: "Cantidad" },
] as const;

export type ProductUnit = (typeof UNIT_OPTIONS)[number]["value"];

export const UNIT_VALUES = UNIT_OPTIONS.map((o) => o.value) as ProductUnit[];

const PLURAL_UNITS: Partial<Record<ProductUnit, string>> = {
  pieza: "piezas",
  paquete: "paquetes",
};

/** "1 L", "500 g", "30 piezas" — la unidad se pluraliza solo cuando aplica (litros/gramos no cambian). */
export function formatPresentation(value: number | null | undefined, unit: string | null | undefined): string {
  if (!value || !unit) return "";
  const plural = PLURAL_UNITS[unit as ProductUnit];
  const label = value !== 1 && plural ? plural : unit;
  return `${value} ${label}`;
}
