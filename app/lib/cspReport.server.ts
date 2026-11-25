/**
 * Avisos de la política de seguridad: cuando el navegador bloquea algo (un píxel con un dominio que
 * falta en la lista, un script que no debía estar ahí), manda un reporte a /api/csp-report. Aquí se
 * leen de forma segura y se decide cuáles vale la pena registrar.
 */
export type CspViolation = {
  directive: string;
  blocked: string;
  page: string;
  source: string;
};

const MAX_REPORT_BYTES = 8 * 1024;
const NOISE_SCHEMES = /^(chrome-extension|moz-extension|safari-extension|safari-web-extension|ms-browser-extension):/i;

/** Quita parámetros y fragmentos: pueden traer datos de la persona (ids, correos) y no hacen falta para diagnosticar. */
function plainUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim().slice(0, 400);
  try {
    const url = new URL(text);
    return `${url.origin}${url.pathname}`.slice(0, 200);
  } catch {
    // «inline», «eval», «data», «self»…: no son direcciones, se dejan tal cual.
    return text.replace(/[^\w:./*-]/g, "").slice(0, 60);
  }
}

/** Lee el cuerpo de un reporte (`application/csp-report`). Devuelve null si no es válido o es ruido de extensiones. */
export function parseCspReport(rawBody: string): CspViolation | null {
  if (rawBody.length === 0 || rawBody.length > MAX_REPORT_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const report = (parsed as { "csp-report"?: Record<string, unknown> } | null)?.["csp-report"];
  if (!report || typeof report !== "object") return null;

  const blockedRaw = String(report["blocked-uri"] ?? "");
  const sourceRaw = String(report["source-file"] ?? "");
  if (NOISE_SCHEMES.test(blockedRaw) || NOISE_SCHEMES.test(sourceRaw)) return null;

  const directive = String(report["effective-directive"] ?? report["violated-directive"] ?? "")
    .split(" ")[0]
    .replace(/[^\w-]/g, "")
    .slice(0, 40);
  if (!directive) return null;

  return {
    directive,
    blocked: plainUrl(blockedRaw),
    page: plainUrl(report["document-uri"]),
    source: plainUrl(sourceRaw),
  };
}

const recentlyLogged = new Map<string, number>();
const REPEAT_AFTER_MS = 60 * 60 * 1000;
const MAX_REMEMBERED = 500;

/** Un mismo bloqueo se registra una vez por hora (por proceso): un píxel roto genera miles de avisos iguales. */
export function shouldLogViolation(violation: CspViolation, now = Date.now()): boolean {
  const key = `${violation.directive}|${violation.blocked}`;
  const last = recentlyLogged.get(key);
  if (last !== undefined && now - last < REPEAT_AFTER_MS) return false;
  if (recentlyLogged.size >= MAX_REMEMBERED) recentlyLogged.clear();
  recentlyLogged.set(key, now);
  return true;
}

/** Solo para las pruebas. */
export function resetViolationMemory() {
  recentlyLogged.clear();
}
