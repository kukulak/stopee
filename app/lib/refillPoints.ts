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
  /** Enlace de Google Maps puesto por el administrador; vacío = se busca la dirección en Maps. */
  mapsUrl: string;
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

const GOOGLE_MAPS_HOSTS = /^(www\.|maps\.)?google\.(com|com\.mx)$/i;

/**
 * Un enlace de Google Maps válido, o "" si se dejó vacío, o null si no lo es. Solo se aceptan direcciones
 * https de Google Maps (google.com/maps…, maps.app.goo.gl/… o goo.gl/maps…): este enlace lo publicamos para
 * cualquier visitante, así que no se admite cualquier destino.
 */
export function normalizeMapsUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return "";
  if (value.length > 500 || /[\u0000-\u001f\u007f\s]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const isGoogleMaps = GOOGLE_MAPS_HOSTS.test(host) && url.pathname.startsWith("/maps");
  const isShortLink = host === "maps.app.goo.gl" || (host === "goo.gl" && url.pathname.startsWith("/maps"));
  return isGoogleMaps || isShortLink ? url.toString() : null;
}

/** Búsqueda en Google Maps de la dirección del punto, para cuando no hay un enlace exacto. */
export function mapsSearchUrl(point: Pick<PublicRefillPoint, "businessName" | "address" | "neighborhood" | "city">): string {
  const query = [point.businessName, point.address, point.neighborhood, point.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** A dónde lleva «Cómo llegar»: el enlace exacto si lo hay y, si no, la búsqueda de su dirección. */
export function directionsUrl(point: Pick<PublicRefillPoint, "businessName" | "address" | "neighborhood" | "city" | "mapsUrl">): string {
  return normalizeMapsUrl(point.mapsUrl) || mapsSearchUrl(point);
}
