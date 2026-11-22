import { createCookieSessionStorage, redirect } from "@remix-run/node";
import { connectDB } from "~/lib/db.server";
import { cookieSecret } from "~/lib/secrets.server";
import { UserModel } from "~/models/user.server";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  verifyTotp,
} from "~/lib/totp.server";

/**
 * Verificación en dos pasos del panel: además de la contraseña, un código de la app del celular.
 * Todo administrador debe tenerla (requireAdmin lo exige); si pierde el celular entra con un
 * código de recuperación, y si pierde también esos, un super administrador con acceso a la
 * terminal la reinicia con `npm run reset-2fa`.
 */

export async function isTwoFactorEnabled(userId: unknown): Promise<boolean> {
  await connectDB();
  const user = await UserModel.findById(userId).select("twoFactor.enabledAt").lean();
  return Boolean(user?.twoFactor?.enabledAt);
}

/** Secreto de la pantalla de activación: se conserva entre recargas para no invalidar el QR ya escaneado. */
export async function getOrCreatePendingSecret(userId: unknown): Promise<string> {
  await connectDB();
  const user = await UserModel.findById(userId).select("twoFactor").lean();
  const existing = decryptSecret(user?.twoFactor?.pendingSecretEnc);
  if (existing) return existing;
  const secret = generateTotpSecret();
  await UserModel.updateOne({ _id: userId, "twoFactor.enabledAt": { $exists: false } }, { $set: { "twoFactor.pendingSecretEnc": encryptSecret(secret) } });
  return secret;
}

/**
 * Confirma la activación: el código debe salir del secreto pendiente (prueba de que la app quedó
 * bien configurada). Devuelve los códigos de recuperación en claro, esta única vez; o null si el código es incorrecto.
 */
export async function confirmEnrollment(userId: unknown, code: string): Promise<string[] | null> {
  await connectDB();
  const user = await UserModel.findById(userId).select("twoFactor").lean();
  if (user?.twoFactor?.enabledAt) return null; // ya activa: no se reemplaza el secreto desde aquí
  const secret = decryptSecret(user?.twoFactor?.pendingSecretEnc);
  if (!secret) return null;
  const step = verifyTotp(secret, code);
  if (step === null) return null;

  const recoveryCodes = generateRecoveryCodes();
  const result = await UserModel.updateOne(
    { _id: userId, "twoFactor.enabledAt": { $exists: false } },
    {
      $set: {
        "twoFactor.secretEnc": encryptSecret(secret),
        "twoFactor.enabledAt": new Date(),
        "twoFactor.lastUsedStep": step,
        "twoFactor.recoveryCodes": recoveryCodes.map((c) => ({ hash: hashRecoveryCode(c) })),
      },
      $unset: { "twoFactor.pendingSecretEnc": "" },
    },
  );
  return result.modifiedCount === 1 ? recoveryCodes : null;
}

export type SecondFactorResult = { ok: true; method: "totp" | "recovery" } | { ok: false };

/** Revisa el código del celular o uno de recuperación. Cada uno se acepta una sola vez, incluso con intentos simultáneos. */
export async function verifySecondFactor(userId: unknown, input: string): Promise<SecondFactorResult> {
  await connectDB();
  const user = await UserModel.findById(userId).select("twoFactor").lean();
  const tf = user?.twoFactor;
  if (!tf?.enabledAt) return { ok: false };

  if (looksLikeRecoveryCode(input)) {
    const hash = hashRecoveryCode(input);
    const used = await UserModel.updateOne(
      { _id: userId, "twoFactor.recoveryCodes": { $elemMatch: { hash, usedAt: { $exists: false } } } },
      { $set: { "twoFactor.recoveryCodes.$.usedAt": new Date() } },
    );
    return used.modifiedCount === 1 ? { ok: true, method: "recovery" } : { ok: false };
  }

  const secret = decryptSecret(tf.secretEnc);
  if (!secret) return { ok: false };
  const step = verifyTotp(secret, input, { afterStep: tf.lastUsedStep ?? null });
  if (step === null) return { ok: false };

  // Atómico: dos peticiones con el mismo código a la vez, solo una gana.
  const claimed = await UserModel.updateOne(
    {
      _id: userId,
      $or: [{ "twoFactor.lastUsedStep": { $exists: false } }, { "twoFactor.lastUsedStep": { $lt: step } }],
    },
    { $set: { "twoFactor.lastUsedStep": step } },
  );
  return claimed.modifiedCount === 1 ? { ok: true, method: "totp" } : { ok: false };
}

/** Códigos nuevos (invalidan todos los anteriores). Pide un código vigente del celular: no basta una sesión abierta. */
export async function regenerateRecoveryCodes(userId: unknown, totpInput: string): Promise<string[] | null> {
  await connectDB();
  const user = await UserModel.findById(userId).select("twoFactor").lean();
  const secret = decryptSecret(user?.twoFactor?.secretEnc);
  if (!user?.twoFactor?.enabledAt || !secret) return null;
  const step = verifyTotp(secret, totpInput, { afterStep: user.twoFactor.lastUsedStep ?? null });
  if (step === null) return null;

  const codes = generateRecoveryCodes();
  const result = await UserModel.updateOne(
    {
      _id: userId,
      $or: [{ "twoFactor.lastUsedStep": { $exists: false } }, { "twoFactor.lastUsedStep": { $lt: step } }],
    },
    { $set: { "twoFactor.lastUsedStep": step, "twoFactor.recoveryCodes": codes.map((c) => ({ hash: hashRecoveryCode(c) })) } },
  );
  return result.modifiedCount === 1 ? codes : null;
}

export function unusedRecoveryCodeCount(user: { twoFactor?: { recoveryCodes?: { usedAt?: Date | null }[] } | null }): number {
  return (user.twoFactor?.recoveryCodes ?? []).filter((c) => !c.usedAt).length;
}

// --- Paso intermedio entre la contraseña y la sesión ---------------------------------------------

/**
 * Entre "contraseña correcta" y "código correcto" la persona todavía NO tiene sesión: solo esta
 * cookie corta (5 minutos), firmada, que dice a quién hay que pedirle el código.
 */
const challengeStorage = createCookieSessionStorage({
  cookie: {
    name: "__stopee_2fa",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [cookieSecret("2fa-challenge")],
    secure: process.env.NODE_ENV === "production",
    maxAge: 5 * 60,
  },
});

export const CHALLENGE_PATH = "/admin/verificar";

export async function beginTwoFactorChallenge(userId: string, redirectTo: string) {
  const session = await challengeStorage.getSession();
  session.set("userId", userId);
  session.set("redirectTo", redirectTo);
  session.set("at", Date.now());
  return redirect(CHALLENGE_PATH, { headers: { "Set-Cookie": await challengeStorage.commitSession(session) } });
}

export async function getPendingChallenge(request: Request): Promise<{ userId: string; redirectTo: string } | null> {
  const session = await challengeStorage.getSession(request.headers.get("Cookie"));
  const userId = session.get("userId");
  const redirectTo = session.get("redirectTo");
  if (typeof userId !== "string") return null;
  return { userId, redirectTo: typeof redirectTo === "string" ? redirectTo : "/admin" };
}

/** Valor de Set-Cookie que borra el paso intermedio. */
export async function clearChallengeCookie(request: Request): Promise<string> {
  const session = await challengeStorage.getSession(request.headers.get("Cookie"));
  return challengeStorage.destroySession(session);
}
