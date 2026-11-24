/**
 * Consentimiento de cookies. Lógica pura (sin acceso a la petición) para usarla igual en el
 * servidor, en el navegador y en las pruebas.
 *
 * Qué se guarda: la elección del visitante en dos categorías que SÍ requieren permiso:
 *  - analytics: estadísticas (Google Analytics y la medición propia del sitio).
 *  - marketing: publicidad (píxel de Meta).
 * Las cookies necesarias (sesión, carrito, seguridad, esta misma elección) no piden permiso.
 *
 * Sin elección guardada (o con una versión vieja del aviso) se trata como «todo rechazado» y se
 * vuelve a preguntar. Subir CONSENT_VERSION obliga a preguntar de nuevo a todos: hay que hacerlo
 * cada vez que se agrega una herramienta nueva de medición o publicidad (por ejemplo, un píxel
 * más) una vez que ya hay visitantes con una elección guardada.
 */
export const CONSENT_COOKIE_NAME = "__stopee_consent";
export const CONSENT_VERSION = 1;
/** La elección se vuelve a preguntar cada 12 meses. */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Evento del navegador con el que cualquier botón («Configurar cookies») abre el panel. */
export const OPEN_COOKIE_SETTINGS_EVENT = "stopee:cookie-settings";

export type ConsentChoices = { analytics: boolean; marketing: boolean };
export type ConsentState = ConsentChoices & { id: string; decidedAt: string };
export type ConsentChoice = "all" | "none" | "custom";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que se guarda dentro de la cookie (nombres cortos: viaja en cada petición). */
export type StoredConsent = { v: number; id: string; a: boolean; m: boolean; t: number };

/** Revisa lo que trae la cookie; cualquier cosa rara, de otra versión o alterada cuenta como «sin elección». */
export function parseStoredConsent(value: unknown): ConsentState | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Partial<StoredConsent>;
  if (stored.v !== CONSENT_VERSION) return null;
  if (typeof stored.id !== "string" || !UUID.test(stored.id)) return null;
  if (typeof stored.a !== "boolean" || typeof stored.m !== "boolean") return null;
  if (typeof stored.t !== "number" || !Number.isFinite(stored.t) || stored.t <= 0) return null;
  const decidedAt = new Date(stored.t);
  if (Number.isNaN(decidedAt.getTime())) return null;
  return { id: stored.id, analytics: stored.a, marketing: stored.m, decidedAt: decidedAt.toISOString() };
}

export function toStoredConsent(state: { id: string; analytics: boolean; marketing: boolean; decidedAt: Date }): StoredConsent {
  return { v: CONSENT_VERSION, id: state.id, a: state.analytics, m: state.marketing, t: state.decidedAt.getTime() };
}

/** Traduce el botón que se pulsó a las dos categorías. «custom» usa lo que marcó la persona. */
export function choicesFromForm(choice: unknown, analytics: unknown, marketing: unknown): ConsentChoices | null {
  if (choice === "all") return { analytics: true, marketing: true };
  if (choice === "none") return { analytics: false, marketing: false };
  if (choice === "custom") return { analytics: analytics === "true", marketing: marketing === "true" };
  return null;
}

/** ¿Pasar de lo anterior a lo nuevo retira algún permiso? Entonces hay que limpiar y recargar. */
export function revokesConsent(previous: ConsentChoices | null, next: ConsentChoices): boolean {
  if (!previous) return false;
  return (previous.analytics && !next.analytics) || (previous.marketing && !next.marketing);
}
