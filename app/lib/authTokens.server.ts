import { createHash, randomBytes } from "node:crypto";
import { AuthTokenModel } from "~/models/authToken.server";

export type TokenPurpose = "reset" | "verify" | "email-change" | "email-revert";

/** Cuánto dura cada enlace. El de contraseña es corto a propósito: da acceso a la cuenta. */
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  reset: 60 * 60 * 1000,
  verify: 24 * 60 * 60 * 1000,
  // Cambia a dónde llegan todos los avisos de la cuenta: corto, como el de contraseña.
  "email-change": 60 * 60 * 1000,
  // El «no fui yo» del correo anterior: una semana para que el dueño real lo vea.
  "email-revert": 7 * 24 * 60 * 60 * 1000,
};

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Crea un enlace nuevo y devuelve el token en claro (solo existe aquí y en el
 * correo). Pedir otro invalida el anterior del mismo tipo, salvo con `keepPrevious`: los «no fui yo» de varios
 * cambios seguidos deben seguir valiendo todos (si no, quien cambia el correo dos veces borraría el aviso del dueño).
 * `email` es el dato que viaja con el enlace en los cambios de correo.
 */
export async function issueToken(
  userId: unknown,
  purpose: TokenPurpose,
  ttlMs: number = TOKEN_TTL_MS[purpose],
  options: { email?: string; keepPrevious?: boolean } = {},
): Promise<string> {
  if (!options.keepPrevious) await AuthTokenModel.deleteMany({ user: userId, purpose });
  const raw = randomBytes(32).toString("base64url");
  await AuthTokenModel.create({
    user: userId,
    purpose,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMs),
    ...(options.email ? { email: options.email } : {}),
  });
  return raw;
}

function validFilter(raw: string, purpose: TokenPurpose) {
  return { tokenHash: hashToken(raw), purpose, usedAt: { $exists: false }, expiresAt: { $gt: new Date() } };
}

/** ¿El token es válido y sigue sin usarse? No lo gasta (para mostrar el formulario). */
export async function peekToken(raw: string | null | undefined, purpose: TokenPurpose): Promise<{ userId: string; email?: string } | null> {
  if (!raw || !TOKEN_FORMAT.test(raw)) return null;
  const doc = await AuthTokenModel.findOne(validFilter(raw, purpose)).lean();
  return doc ? { userId: String(doc.user), email: doc.email ?? undefined } : null;
}

/** Gasta el token de forma atómica: dos peticiones a la vez solo dejan pasar una. */
export async function consumeToken(raw: string | null | undefined, purpose: TokenPurpose): Promise<{ userId: string; email?: string } | null> {
  if (!raw || !TOKEN_FORMAT.test(raw)) return null;
  const doc = await AuthTokenModel.findOneAndUpdate(validFilter(raw, purpose), { $set: { usedAt: new Date() } }).lean();
  return doc ? { userId: String(doc.user), email: doc.email ?? undefined } : null;
}
