import { data } from "react-router";
import { UserModel } from "~/models/user.server";
import { connectDB } from "~/lib/db.server";
import { sendVerificationEmail } from "~/lib/accountEmails.server";

/**
 * Nadie entra (a la tienda ni al panel) con un correo sin confirmar: si no, bastaría
 * registrarse con el correo de otra persona para tener una cuenta "suya". Este
 * mensaje es lo que ve quien tiene la contraseña correcta pero aún no confirma.
 *
 * Solo se muestra después de acertar la contraseña, así que no revela qué
 * correos están registrados.
 */
export const UNVERIFIED_LOGIN_MESSAGE =
  "Falta confirmar tu correo. Abre el enlace que te enviamos al crear la cuenta y vuelve a entrar.";

export function unverifiedLoginResponse(email: string) {
  return data({ error: UNVERIFIED_LOGIN_MESSAGE, unverifiedEmail: email }, { status: 403 });
}

/** Tiempo mínimo de respuesta: que exista o no la cuenta no se note por lo que tarda. */
const MIN_RESPONSE_MS = 700;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Manda otro enlace de confirmación si la cuenta existe y sigue sin confirmar.
 * Pedir uno nuevo invalida el anterior (ver issueToken). No devuelve nada que
 * distinga los casos.
 */
export async function resendVerificationTo(email: string) {
  await Promise.all([
    (async () => {
      await connectDB();
      const user = await UserModel.findOne({ email }).select("email name emailVerifiedAt").lean();
      if (user && !user.emailVerifiedAt) await sendVerificationEmail(user);
    })(),
    sleep(MIN_RESPONSE_MS),
  ]);
}
