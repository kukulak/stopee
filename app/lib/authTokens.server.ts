import { createHash, randomBytes } from "node:crypto";
import { AuthTokenModel } from "~/models/authToken.server";

export type TokenPurpose = "reset" | "verify";

/** Cuánto dura cada enlace. El de contraseña es corto a propósito: da acceso a la cuenta. */
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  reset: 60 * 60 * 1000,
  verify: 24 * 60 * 60 * 1000,
};

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Crea un enlace nuevo y devuelve el token en claro (solo existe aquí y en el
 * correo). Pedir otro invalida el anterior del mismo tipo.
 */
export async function issueToken(
  userId: unknown,
  purpose: TokenPurpose,
  ttlMs: number = TOKEN_TTL_MS[purpose],
): Promise<string> {
  await AuthTokenModel.deleteMany({ user: userId, purpose });
  const raw = randomBytes(32).toString("base64url");
  await AuthTokenModel.create({
    user: userId,
    purpose,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return raw;
}

function validFilter(raw: string, purpose: TokenPurpose) {
  return { tokenHash: hashToken(raw), purpose, usedAt: { $exists: false }, expiresAt: { $gt: new Date() } };
}

/** ¿El token es válido y sigue sin usarse? No lo gasta (para mostrar el formulario). */
export async function peekToken(raw: string | null | undefined, purpose: TokenPurpose): Promise<{ userId: string } | null> {
  if (!raw || !TOKEN_FORMAT.test(raw)) return null;
  const doc = await AuthTokenModel.findOne(validFilter(raw, purpose)).lean();
  return doc ? { userId: String(doc.user) } : null;
}

/** Gasta el token de forma atómica: dos peticiones a la vez solo dejan pasar una. */
export async function consumeToken(raw: string | null | undefined, purpose: TokenPurpose): Promise<{ userId: string } | null> {
  if (!raw || !TOKEN_FORMAT.test(raw)) return null;
  const doc = await AuthTokenModel.findOneAndUpdate(validFilter(raw, purpose), { $set: { usedAt: new Date() } }).lean();
  return doc ? { userId: String(doc.user) } : null;
}
