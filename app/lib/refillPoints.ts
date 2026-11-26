import { normalizePhone } from "~/lib/deliveryAddress";

/**
 * Puntos de Recarga STOPee, en su parte sin base de datos (la usan las pantallas y las pruebas).
 * Lo que va a Mongo y la validación de formularios están en ~/lib/refillPoints.server.
 */

/** Qué tipo de negocio o persona pide ser punto de recarga. */
export const BUSINESS_TYPES = ["Veterinaria", "Pet shop", "Estética canina", "Vecino o comunidad", "Otro"] as const;

export const REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
};

/** Zona donde se ubica un punto. */
export const STATION_CITIES = ["CDMX", "Edomex"] as const;

export type PublicRefillPoint = {
  id: string;
  businessName: string;
  neighborhood: string;
  city: string;
  address: string;
  schedule: string;
  /** 10 dígitos. */
  whatsapp: string;
};

/** Enlace directo a WhatsApp con un mensaje inicial; null si el número no es de 10 dígitos. */
export function whatsappUrl(phone: unknown, message?: string): string | null {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  return `https://wa.me/52${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

/** Colonias distintas, sin repetir por mayúsculas ni acentos ("Roma" y "roma"), en orden alfabético. */
export function neighborhoodOptions(points: Pick<PublicRefillPoint, "neighborhood">[]): string[] {
  const byKey = new Map<string, string>();
  for (const point of points) {
    const key = point.neighborhood.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    if (key && !byKey.has(key)) byKey.set(key, point.neighborhood);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "es"));
}

function sameNeighborhood(a: string, b: string) {
  const key = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return key(a) === key(b);
}

/** Puntos de una colonia (o todos si no se eligió). Compara texto: lo que escriba la persona nunca llega a una consulta. */
export function filterByNeighborhood<T extends Pick<PublicRefillPoint, "neighborhood">>(points: T[], neighborhood: string | null | undefined): T[] {
  const wanted = (neighborhood ?? "").trim();
  if (!wanted) return points;
  return points.filter((point) => sameNeighborhood(point.neighborhood, wanted));
}
