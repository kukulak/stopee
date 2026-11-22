import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { z } from "zod";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { resendVerificationTo } from "~/lib/emailVerification.server";

// Ruta solo de acción: la usa el botón "Reenviar enlace" de las pantallas de inicio de sesión.
export async function loader() {
  return redirect("/cuenta/entrar");
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);

export async function action({ request }: ActionFunctionArgs) {
  const ipLimit = checkRateLimit(`reenviar:${getClientIp(request)}`, { max: 10, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.allowed) {
    return data({ ok: false, message: rateLimitMessage(ipLimit.retryAfterSeconds) }, { status: 429 });
  }

  const parsed = emailSchema.safeParse((await request.formData()).get("email"));
  if (!parsed.success) return data({ ok: false, message: "Ingresa un correo válido." }, { status: 400 });
  const email = parsed.data;

  // Tope por correo: sin él, alguien podría llenar de mensajes la bandeja de un tercero.
  const emailLimit = checkRateLimit(`reenviar-email:${email}`, { max: 3, windowMs: 60 * 60 * 1000 });
  if (emailLimit.allowed) await resendVerificationTo(email);

  // Misma respuesta exista o no la cuenta, o se haya llegado al tope.
  return data({ ok: true, message: `Si ese correo está pendiente de confirmar, le enviamos un enlace nuevo. Revisa también la carpeta de spam.` });
}
