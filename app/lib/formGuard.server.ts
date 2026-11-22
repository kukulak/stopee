import { data } from "react-router";

/**
 * Defensas compartidas por los formularios públicos (contacto y lista de
 * espera): limpieza de texto y verificación de origen.
 */

// --- Limpieza de texto ------------------------------------------------------

// Caracteres de control (salvo salto de línea y tabulador, que se tratan aparte).
// eslint-disable-next-line no-control-regex
const INVISIBLE_RANGES: Array<[number, number]> = [[0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join("")}]`, "gu");
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;
const BLOCK_TAGS = /<\s*(script|style|iframe|object|embed|noscript|template)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi;
const ANY_TAG = /<\s*\/?\s*[a-z!?][^>]*>?/gi;
const DANGEROUS_SCHEMES = /\b(?:javascript|vbscript|data\s*:\s*text\/html)\s*:?/gi;

/**
 * Deja solo texto plano: quita etiquetas HTML (con el contenido de script,
 * style, iframe…), esquemas peligrosos (`javascript:`) y caracteres de
 * control. Se repite hasta que no cambie, para que `<scr<script>ipt>` no
 * sobreviva a una sola pasada. Se aplica ANTES de validar y guardar, así lo
 * que llega a MongoDB y a los correos ya viene limpio.
 *
 * `multiline` conserva los saltos de línea (mensajes); si es falso todo se
 * colapsa a una sola línea (nombre, correo).
 */
export function cleanPlainText(value: unknown, { multiline = false }: { multiline?: boolean } = {}): string {
  let text = typeof value === "string" ? value : "";
  text = text.normalize("NFKC").replace(/\r\n?/g, "\n");

  let previous: string;
  do {
    previous = text;
    text = text.replace(BLOCK_TAGS, "").replace(ANY_TAG, "").replace(DANGEROUS_SCHEMES, "");
  } while (text !== previous);

  if (multiline) {
    text = text.replace(CONTROL_CHARS, "").replace(INVISIBLE, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  } else {
    text = text.replace(/\s+/g, " ").replace(CONTROL_CHARS, "").replace(INVISIBLE, "");
  }
  return text.trim();
}

/** Verdadero si el texto trae caracteres de control (sirve en los esquemas zod). */
export function hasControlChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001F\u007F-\u009F]/.test(value);
}

// --- Verificación de origen (CSRF) -----------------------------------------

const PRODUCTION_HOSTS = ["stopee.com.mx", "www.stopee.com.mx"];

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function allowedHosts(request: Request): Set<string> {
  const hosts = new Set(PRODUCTION_HOSTS);
  const appHost = process.env.APP_URL ? hostOf(process.env.APP_URL) : null;
  if (appHost) hosts.add(appHost);
  // El propio host al que llegó la petición: cubre la URL `*.run.app` antes de
  // conectar el dominio. Un sitio externo no puede falsear este encabezado
  // desde el navegador de la víctima.
  const requestHost = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(",")[0]?.trim().toLowerCase();
  if (requestHost) hosts.add(requestHost);
  return hosts;
}

function isLocalDev(host: string) {
  if (process.env.NODE_ENV === "production") return false;
  const hostname = host.replace(/:\d+$/, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Rechaza (403) un envío cuyo `Origin` —o, si falta, `Referer`— no sea el
 * propio sitio. Los navegadores siempre mandan `Origin` en un POST, así que
 * una petición sin ninguno de los dos no viene de un formulario real.
 * Devuelve `null` si todo está bien o la respuesta que el `action` debe
 * regresar tal cual.
 */
export function rejectForeignOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const source = origin && origin !== "null" ? origin : request.headers.get("referer");
  const host = source ? hostOf(source) : null;

  if (host && (allowedHosts(request).has(host) || isLocalDev(host))) return null;

  console.warn(
    JSON.stringify({
      level: "warn",
      context: "form.origin-rejected",
      message: "Envío rechazado: el origen no coincide con el sitio.",
      origin: origin ?? null,
      referer: request.headers.get("referer") ?? null,
    }),
  );
  return data({ ok: false, error: "No pudimos verificar el origen de la solicitud." }, { status: 403 });
}
