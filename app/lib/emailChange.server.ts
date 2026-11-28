import { randomBytes } from "node:crypto";
import { z } from "zod";
import { connectDB } from "~/lib/db.server";
import { UserModel, hashPassword } from "~/models/user.server";
import { AllyRequestModel } from "~/models/allyRequest.server";
import { AuthTokenModel } from "~/models/authToken.server";
import { issueToken } from "~/lib/authTokens.server";
import { sendEmail } from "~/lib/mail.server";
import {
  appUrl,
  confirmEmailChangeEmail,
  emailChangeBlockedEmail,
  emailChangedNoticeEmail,
} from "~/lib/emailTemplates.server";
import { sendPasswordResetEmail, sendVerificationEmail, settleWithin } from "~/lib/accountEmails.server";
import { checkRateLimit } from "~/lib/rateLimit.server";
import { maskEmail } from "~/lib/maskEmail";
import { logAudit, logError } from "~/lib/logger.server";

/**
 * Cambiar el correo de una cuenta = cambiar a dónde llegan los avisos y quién puede recuperarla. Por eso nunca lo
 * decide una persona del equipo por lo que le escriban: lo hace el dueño con su contraseña y el correo nuevo confirmado,
 * y el correo anterior recibe un «no fui yo» con una semana de vida.
 */

const emailSchema = z.string().trim().toLowerCase().email().max(160);

export function parseNewEmail(raw: unknown): string | null {
  const parsed = emailSchema.safeParse(typeof raw === "string" ? raw : "");
  return parsed.success ? parsed.data : null;
}

/**
 * Paso 1 — el dueño (ya con su contraseña verificada por quien llama) pide el cambio. Manda un enlace al correo NUEVO.
 * La respuesta es la misma exista o no una cuenta con ese correo: decir «ya está en uso» le serviría a cualquiera para
 * averiguar qué correos tienen cuenta. Lo que cambia llega solo a la bandeja de ese correo.
 */
export async function requestEmailChange(
  user: { _id: unknown; email: string; name?: string | null },
  rawNewEmail: unknown,
): Promise<{ ok: true; maskedEmail: string } | { ok: false; error: string }> {
  const newEmail = parseNewEmail(rawNewEmail);
  if (!newEmail) return { ok: false, error: "Escribe un correo válido, por ejemplo nombre@correo.com." };
  if (newEmail === user.email) return { ok: false, error: "Ese ya es el correo de tu cuenta." };

  await connectDB();
  // Tope por destino: sin él, se podría usar este formulario para llenar de mensajes la bandeja de un tercero.
  const limit = await checkRateLimit(`email-change-to:${newEmail}`, { max: 3, windowMs: 60 * 60 * 1000 });
  if (limit.allowed) {
    const taken = await UserModel.exists({ email: newEmail });
    if (taken) {
      await settleWithin(sendEmail({ to: { email: newEmail }, ...emailChangeBlockedEmail() }), 2500);
    } else {
      const token = await issueToken(user._id, "email-change", undefined, { email: newEmail });
      await settleWithin(
        sendEmail({
          to: { email: newEmail, name: user.name || undefined },
          ...confirmEmailChangeEmail({ name: user.name, url: appUrl(`/cuenta/cambiar-correo?token=${token}`) }),
        }),
        2500,
      );
    }
  }
  return { ok: true, maskedEmail: maskEmail(newEmail) };
}

export type EmailChangeOutcome = { ok: true; from: string; to: string } | { ok: false; error: string };

/**
 * Paso 2 — el cambio en sí (lo dispara el enlace del correo nuevo, o un super administrador desde el panel). Mueve el
 * correo, deja constancia, y avisa al correo ANTERIOR con el enlace «no fui yo».
 */
export async function applyEmailChange(
  userId: string,
  rawNewEmail: string,
  options: { byStaffId?: string } = {},
): Promise<EmailChangeOutcome> {
  const newEmail = parseNewEmail(rawNewEmail);
  if (!newEmail) return { ok: false, error: "Ese correo no es válido." };

  await connectDB();
  const user = await UserModel.findById(userId).select("email name stripeCustomerId");
  if (!user) return { ok: false, error: "No encontramos la cuenta." };
  const oldEmail = user.email;
  if (oldEmail === newEmail) return { ok: false, error: "Ese ya es el correo de la cuenta." };

  try {
    // El filtro por el correo de antes evita pisar un cambio que llegó primero; el índice único, quedarse con uno ocupado.
    // Quien abrió el enlace en la bandeja nueva demostró que es suyo y queda confirmado. Si lo hace el equipo, el dueño
    // todavía tiene que confirmarlo con el enlace que le llega al correo nuevo.
    const done = await UserModel.updateOne(
      { _id: user._id, email: oldEmail },
      options.byStaffId ? { $set: { email: newEmail }, $unset: { emailVerifiedAt: 1 } } : { $set: { email: newEmail, emailVerifiedAt: new Date() } },
    );
    if (done.modifiedCount === 0) return { ok: false, error: "La cuenta cambió mientras tanto. Vuelve a intentarlo." };
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return { ok: false, error: "Ese correo ya pertenece a otra cuenta." };
    throw error;
  }

  await afterEmailMoved(user, oldEmail, newEmail);

  const revert = await issueToken(user._id, "email-revert", undefined, { email: oldEmail, keepPrevious: true });
  await settleWithin(
    sendEmail({
      to: { email: oldEmail, name: user.name || undefined },
      ...emailChangedNoticeEmail({
        newEmailMasked: maskEmail(newEmail),
        revertUrl: appUrl(`/cuenta/revertir-correo?token=${revert}`),
        byTeam: Boolean(options.byStaffId),
      }),
    }),
    2500,
  );
  if (options.byStaffId) await settleWithin(sendVerificationEmail({ _id: user._id, email: newEmail, name: user.name }), 2500);
  // Los cambios pendientes de confirmar ya no tienen sentido.
  await AuthTokenModel.deleteMany({ user: user._id, purpose: "email-change" });

  logAudit("user.email_changed", { userId: String(user._id), by: options.byStaffId ?? "owner" });
  return { ok: true, from: oldEmail, to: newEmail };
}

/**
 * Paso 3 (solo si el dueño real no fue quien lo cambió) — «no fui yo»: regresa el correo, cierra todas las sesiones,
 * deja inservible la contraseña que tuviera quien se adueñó de la cuenta y manda al correo recuperado un enlace para
 * elegir una nueva.
 */
export async function revertEmailChange(userId: string, oldEmail: string): Promise<EmailChangeOutcome> {
  const restored = parseNewEmail(oldEmail);
  if (!restored) return { ok: false, error: "El enlace no es válido." };

  await connectDB();
  const user = await UserModel.findById(userId).select("email name stripeCustomerId");
  if (!user) return { ok: false, error: "No encontramos la cuenta." };
  const current = user.email;

  if (current !== restored) {
    try {
      await UserModel.updateOne({ _id: user._id }, { $set: { email: restored } });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        return { ok: false, error: "Ese correo ya lo usa otra cuenta. Escríbenos y lo resolvemos contigo." };
      }
      throw error;
    }
    await afterEmailMoved(user, current, restored);
  }

  // Quien pueda haber tomado la cuenta conoce la contraseña: se invalida, y la persona elige otra con el enlace.
  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash: await hashPassword(randomBytes(32).toString("hex")),
        passwordChangedAt: new Date(),
        // Tocó un enlace en esta bandeja: el correo queda confirmado.
        emailVerifiedAt: new Date(),
      },
    },
  );
  await AuthTokenModel.deleteMany({ user: user._id, purpose: { $in: ["email-change", "reset"] } });
  const fresh = await UserModel.findById(user._id).select("email name");
  if (fresh) await settleWithin(sendPasswordResetEmail(fresh), 2500);

  logAudit("user.email_reverted", { userId: String(user._id) });
  return { ok: true, from: current, to: restored };
}

/** Lo que va ligado al correo y debe seguirlo: las solicitudes de Punto de Recarga y el correo de los recibos de Stripe. */
async function afterEmailMoved(user: { _id: unknown; stripeCustomerId?: string | null }, from: string, to: string) {
  await AllyRequestModel.updateMany({ email: from }, { $set: { email: to } });
  if (user.stripeCustomerId) {
    try {
      // Import perezoso: sin llave de Stripe (pruebas, desarrollo) el módulo ni se carga.
      const { stripe } = await import("~/lib/stripe.server");
      await stripe.customers.update(user.stripeCustomerId, { email: to });
    } catch (error) {
      // Un recibo que sigue yendo al correo anterior no debe impedir el cambio.
      logError("email-change.stripe", error);
    }
  }
}
