/**
 * Las fechas de una promoción se escriben como día completo («inicia el 26, termina el 27»). Se interpretan
 * en hora de México: inicia a las 00:00 del primer día y termina a las 23:59 del último, de modo que
 * «termina el 27» incluye todo el 27. México no usa horario de verano, así que el desfase es fijo (-06:00).
 */

const MX_ZONE = "America/Mexico_City";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDayString(value: string): boolean {
  return DAY.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

/** 00:00 (hora de México) del día «AAAA-MM-DD». */
export function startOfDayMx(day: string): Date {
  return new Date(`${day}T00:00:00.000-06:00`);
}

/** 23:59:59 (hora de México) del día «AAAA-MM-DD»: la promoción sirve todo ese día. */
export function endOfDayMx(day: string): Date {
  return new Date(`${day}T23:59:59.999-06:00`);
}

/**
 * El día «AAAA-MM-DD» para mostrar en el formulario. Las fechas guardadas antes de este cambio eran
 * medianoche UTC exacta de ese día: se leen como esa fecha, para que al editarlas no se recorran un día.
 */
export function toDayInputValue(value?: string | Date | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const legacy = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  if (legacy) return date.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: MX_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** «27/11/2026», para las listas. Mismo criterio de día que el formulario. */
export function formatDayMx(value?: string | Date | null): string {
  const day = toDayInputValue(value);
  if (!day) return "";
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}
