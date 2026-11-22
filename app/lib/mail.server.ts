import { logError } from "~/lib/logger.server";

/**
 * Envío de correos transaccionales con Brevo (API v3, sin dependencias: solo
 * `fetch`). Variables de entorno:
 *   BREVO_API_KEY    llave de API de Brevo ("v3")
 *   MAIL_FROM_EMAIL  remitente, ya verificado en Brevo
 *   MAIL_FROM_NAME   nombre del remitente (opcional, por defecto "STOPee")
 *
 * `sendEmail` NUNCA lanza: un correo que falla no debe tumbar el formulario
 * ni el cambio de estado que lo disparó (el mensaje ya quedó guardado en la
 * base de datos). Devuelve el resultado y registra el error en el log.
 */
const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const REQUEST_TIMEOUT_MS = 8000;

export type MailAddress = { email: string; name?: string };

export type SendEmailInput = {
  to: MailAddress;
  subject: string;
  html: string;
  text: string;
  replyTo?: MailAddress;
};

export type SendEmailResult =
  | { ok: true; messageId?: string }
  | { ok: false; skipped: boolean; reason: string };

export function isMailConfigured() {
  return Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM_EMAIL);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.MAIL_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    // En desarrollo (sin llaves) no se manda nada; se deja constancia en el log.
    console.warn(
      JSON.stringify({
        level: "warn",
        context: "mail.skipped",
        message: "Brevo no está configurado (BREVO_API_KEY / MAIL_FROM_EMAIL); no se envió el correo.",
        subject: input.subject,
      }),
    );
    return { ok: false, skipped: true, reason: "not-configured" };
  }

  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: fromEmail, name: process.env.MAIL_FROM_NAME || "STOPee" },
        to: [input.to],
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        subject: input.subject,
        htmlContent: input.html,
        textContent: input.text,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      logError("mail.send", new Error(`Brevo respondió ${response.status}`), {
        status: response.status,
        detail: detail.slice(0, 500),
        subject: input.subject,
      });
      return { ok: false, skipped: false, reason: `brevo-${response.status}` };
    }

    const body = (await response.json().catch(() => ({}))) as { messageId?: string };
    return { ok: true, messageId: body.messageId };
  } catch (error) {
    logError("mail.send", error, { subject: input.subject });
    return { ok: false, skipped: false, reason: "network" };
  }
}
