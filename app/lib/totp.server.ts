import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookieSecret } from "~/lib/secrets.server";

/**
 * Códigos de un solo uso por tiempo (TOTP, RFC 6238): los 6 dígitos que cambian cada 30
 * segundos en apps como Google Authenticator, Microsoft Authenticator, 1Password o Authy.
 * Sin dependencias: HMAC-SHA1 de `node:crypto`, igual que el estándar.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("Secreto base32 inválido.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo: 20 bytes aleatorios (160 bits), el tamaño que recomienda el estándar. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Paso de tiempo (ventana de 30 s) al que pertenece un instante. */
export function timeStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** El código de 6 dígitos de un paso concreto. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** Quita espacios y guiones: la gente escribe "123 456" o "123-456". */
export function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, "");
}

/**
 * ¿El código es válido ahora? Acepta el paso actual y uno antes y después (relojes del celular
 * ligeramente desfasados). Devuelve el paso que coincidió, o null.
 *
 * `afterStep` es el último paso ya usado: un código solo sirve una vez, así que quien alcance a
 * ver o copiar uno recién usado no puede reutilizarlo dentro de su ventana de 30–90 segundos.
 */
export function verifyTotp(secret: string, input: string, opts: { now?: number; afterStep?: number | null } = {}): number | null {
  const code = normalizeCode(input);
  if (!/^\d{6}$/.test(code)) return null;
  const current = timeStep(opts.now);
  let matched: number | null = null;
  // Se revisan los tres pasos siempre (sin salir al primer acierto) para no filtrar cuál coincidió por el tiempo.
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(totpCode(secret, step));
    const given = Buffer.from(code);
    if (timingSafeEqual(expected, given) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (typeof opts.afterStep === "number" && matched <= opts.afterStep) return null;
  return matched;
}

/** Dirección que codifica el QR: la app de códigos la lee y agrega la cuenta sola. */
export function otpauthUri(secret: string, accountEmail: string, issuer = "STOPee"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountEmail)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

/** "ABCD EFGH IJKL…" para poder escribirlo a mano si no se puede escanear el QR. */
export function formatSecretForHumans(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

// --- Cifrado del secreto en la base de datos -----------------------------------------------

/**
 * El secreto TOTP equivale a una llave de acceso: no se guarda en claro. Se cifra con AES-256-GCM
 * (cifra y detecta alteraciones) usando una llave derivada de SESSION_SECRET.
 *
 * Consecuencia a tener presente: si SESSION_SECRET cambia, los secretos guardados dejan de poder
 * leerse y hay que reiniciar la verificación de cada administrador (`npm run reset-2fa`).
 */
function encryptionKey(): Buffer {
  return Buffer.from(cookieSecret("2fa-secret"), "hex");
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

/** null si el valor está alterado o se cifró con otra llave (nunca lanza: se trata como "sin secreto"). */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// --- Códigos de recuperación ---------------------------------------------------------------------

// Sin 0/O/1/I/L: se copian a mano desde una hoja impresa.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const RECOVERY_CODE_COUNT = 10;

function randomRecoveryCode(): string {
  const chars = Array.from(randomBytes(10), (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]);
  return `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, randomRecoveryCode);
}

/** Mayúsculas y sin guion ni espacios: "abcde-fghjk" y "ABCDE FGHJK" son el mismo código. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

/** En la base solo se guarda la huella: un código usado o robado de la base no se puede reconstruir. */
export function hashRecoveryCode(input: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(input)).digest("hex");
}

/** ¿Tiene forma de código de recuperación (10 caracteres del alfabeto)? */
export function looksLikeRecoveryCode(input: string): boolean {
  return new RegExp(`^[${RECOVERY_ALPHABET}]{10}$`).test(normalizeRecoveryCode(input));
}
