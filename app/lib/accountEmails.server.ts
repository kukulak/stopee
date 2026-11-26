import { sendEmail, isMailConfigured } from "~/lib/mail.server";
import { issueToken } from "~/lib/authTokens.server";
import {
  accountAlreadyExistsEmail,
  accountInvitationEmail,
  appUrl,
  passwordChangedEmail,
  resetPasswordEmail,
  verifyEmailEmail,
} from "~/lib/emailTemplates.server";

type Recipient = { _id: unknown; email: string; name?: string | null };

/**
 * En desarrollo, sin Brevo configurado, el correo no sale: se imprime el enlace
 * en la terminal para poder probar el flujo completo. Un enlace es una llave de
 * acceso, así que esto falla hacia el lado seguro: solo se imprime si el servidor
 * dice EXPLÍCITAMENTE que es de desarrollo (`npm run dev`) y no corre en Cloud Run.
 * Una variable olvidada en el servidor real deja de imprimir, no empieza a hacerlo.
 */
function devLog(kind: string, url: string) {
  if (process.env.NODE_ENV !== "development" || process.env.K_SERVICE || isMailConfigured()) return;
  console.info(`[dev] ${kind}: ${url}`);
}

export async function sendVerificationEmail(user: Recipient) {
  const token = await issueToken(user._id, "verify");
  const url = appUrl(`/cuenta/verificar?token=${token}`);
  devLog("enlace de verificación", url);
  const result = await sendEmail({ to: { email: user.email, name: user.name || undefined }, ...verifyEmailEmail({ name: user.name, url }) });
  // El enlace también se devuelve para que un administrador pueda pasarlo a mano si el correo no sale.
  return { url, result };
}

/** Para quien intentó registrarse con un correo que ya tiene cuenta (ver accountAlreadyExistsEmail). */
export async function sendAccountAlreadyExistsNotice(user: Recipient) {
  return sendEmail({ to: { email: user.email, name: user.name || undefined }, ...accountAlreadyExistsEmail() });
}

export async function sendPasswordResetEmail(user: Recipient) {
  const token = await issueToken(user._id, "reset");
  const url = appUrl(`/cuenta/restablecer?token=${token}`);
  devLog("enlace para restablecer contraseña", url);
  return sendEmail({ to: { email: user.email, name: user.name || undefined }, ...resetPasswordEmail({ url }) });
}

const INVITATION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Invitación para quien recibe una cuenta creada por un administrador: es el
 * mismo enlace de "restablecer contraseña", pero con 3 días de vida. Devuelve el
 * enlace para que, si el correo no sale, el administrador pueda pasarlo a mano.
 */
export async function sendInvitationEmail(user: Recipient) {
  const token = await issueToken(user._id, "reset", INVITATION_TTL_MS);
  const url = appUrl(`/cuenta/restablecer?token=${token}`);
  devLog("enlace de invitación", url);
  const result = await sendEmail({
    to: { email: user.email, name: user.name || undefined },
    ...accountInvitationEmail({ name: user.name, url }),
  });
  return { url, result };
}

export async function sendPasswordChangedNotice(user: Recipient) {
  return sendEmail({ to: { email: user.email, name: user.name || undefined }, ...passwordChangedEmail() });
}

/** Espera como máximo `ms` a que termine algo lento (un correo) sin cancelarlo: el registro no debe depender de Brevo. */
export async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<void> {
  await Promise.race([promise.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, ms))]);
}
