/**
 * Las opciones del exportador de ventas, compartidas por la pantalla (que arma la dirección) y el servidor
 * (que la lee). Sin base de datos ni nada del servidor.
 */
export type SalesExportOptions = {
  /** Día de inicio (AAAA-MM-DD, hora de México). Vacío = desde el principio. */
  from: string;
  /** Día final, incluido. Vacío = hasta hoy. */
  to: string;
  /** «validas» deja fuera canceladas y reembolsadas (lo que va a contabilidad); «todas» las incluye (para análisis). */
  estado: "validas" | "todas";
  /** Si pidieron factura: todas, «sin» (para la factura global) o «con». */
  facturacion: "todas" | "sin" | "con";
  /** Las ventas que el equipo registró a mano (efectivo, vecinos…). */
  manuales: boolean;
};

export const DEFAULT_SALES_EXPORT: Omit<SalesExportOptions, "from" | "to"> = {
  estado: "validas",
  facturacion: "todas",
  manuales: true,
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const isDay = (value: string) => DAY.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());

export function salesExportQuery(o: SalesExportOptions): string {
  const params = new URLSearchParams();
  if (o.from) params.set("from", o.from);
  if (o.to) params.set("to", o.to);
  params.set("estado", o.estado);
  params.set("facturacion", o.facturacion);
  params.set("manuales", o.manuales ? "1" : "0");
  return params.toString();
}

/** El día de hoy en México como AAAA-MM-DD. */
export const mexicoToday = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Del día 1 de este mes a hoy. */
export function thisMonthRange(today: string): { from: string; to: string } {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** Del día 1 al último día del mes anterior. */
export function lastMonthRange(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return { from: `${prevYear}-${pad(prevMonth)}-01`, to: `${prevYear}-${pad(prevMonth)}-${pad(lastDayOf(prevYear, prevMonth))}` };
}
