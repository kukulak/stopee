import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, useActionData, useNavigation, useLoaderData } from "react-router";
import { z } from "zod";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { getCart } from "~/lib/cart.server";
import { createContactMessage } from "~/models/contactMessage.server";
import { getLegalSettings } from "~/models/legalSettings.server";
import { sendEmail } from "~/lib/mail.server";
import { contactNotificationEmail } from "~/lib/emailTemplates.server";
import { logError } from "~/lib/logger.server";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { cleanPlainText, hasControlChars, rejectForeignOrigin } from "~/lib/formGuard.server";
import { LegalNotice } from "~/components/ui/LegalNotice";

export const meta: MetaFunction = () => [
  { title: "Contacto — STOPee" },
  { name: "description", content: "¿Dudas sobre STOPee? Escríbenos y te respondemos en menos de 24 horas hábiles." },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const cart = await getCart(request);
  return data({ cartCount: cart.reduce((sum, item) => sum + item.quantity, 0) });
}

const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Cuéntanos tu nombre (mínimo 2 letras).")
    .max(80, "El nombre es demasiado largo (máximo 80 caracteres).")
    .refine((v) => !hasControlChars(v), "El nombre tiene caracteres no válidos."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(100, "El correo es demasiado largo.")
    .email("Ingresa un correo válido.")
    .refine((v) => !hasControlChars(v), "El correo tiene caracteres no válidos."),
  message: z
    .string()
    .trim()
    .min(10, "Cuéntanos un poco más (mínimo 10 caracteres).")
    .max(2000, "El mensaje es demasiado largo (máximo 2000 caracteres)."),
});

export async function action({ request }: ActionFunctionArgs) {
  const foreign = rejectForeignOrigin(request);
  if (foreign) return foreign;

  // El límite va antes de leer el cuerpo, para no procesar formularios de un flood.
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`contact:${ip}`, { max: 5, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) {
    return data({ ok: false, error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 });
  }

  const formData = await request.formData();

  const parsed = contactSchema.safeParse({
    name: cleanPlainText(formData.get("name")),
    email: cleanPlainText(formData.get("email")),
    message: cleanPlainText(formData.get("message"), { multiline: true }),
  });

  if (!parsed.success) {
    return data({ ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." }, { status: 400 });
  }

  // Primero se guarda (así nunca se pierde el mensaje); el aviso por correo al
  // negocio va después y, si falla, solo queda en el log.
  await createContactMessage(parsed.data);

  try {
    // Destinatario: el "correo de contacto" de Datos del negocio y, si está
    // vacío, ADMIN_EMAIL. Si la lectura de la configuración falla, también se
    // cae a ADMIN_EMAIL: el aviso no debe perderse por eso.
    let correoContacto = "";
    try {
      correoContacto = ((await getLegalSettings()).correoContacto ?? "").trim();
    } catch (error) {
      logError("contacto.settings", error);
    }
    const recipient = correoContacto || (process.env.ADMIN_EMAIL ?? "").trim();

    if (!recipient) {
      console.warn(
        JSON.stringify({
          level: "warn",
          context: "contacto.notify-skipped",
          message:
            "No se envió la notificación de contacto: falta el correo de contacto (Datos del negocio) y ADMIN_EMAIL. El mensaje sí quedó guardado.",
        }),
      );
    } else {
      const mail = contactNotificationEmail(parsed.data);
      await sendEmail({
        to: { email: recipient },
        replyTo: { email: parsed.data.email, name: parsed.data.name },
        ...mail,
        subject: mail.subject.replace(/[\r\n]+/g, " "),
      });
    }
  } catch (error) {
    logError("contacto.notify", error);
  }

  return data({ ok: true, error: undefined as string | undefined });
}

export default function Contacto() {
  const { cartCount } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />
      <main className="flex-1">
        <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
          <Breadcrumbs items={[{ label: "Inicio", href: "/" }, { label: "Contacto" }]} />

          <p className="mt-6 font-body text-sm font-bold uppercase tracking-widest text-oliva">Contacto</p>
          <h1 className="mt-2 font-display text-3xl font-black text-carbon sm:text-4xl">¿En qué te ayudamos?</h1>
          <p className="mt-3 text-carbon/70">
            Escríbenos y te respondemos en menos de 24 horas hábiles.
          </p>

          {actionData?.ok ? (
            <div className="mt-10 rounded-3xl border-2 border-lima bg-lima/10 p-8 text-center">
              <p className="font-display text-xl font-black text-carbon">¡Mensaje enviado!</p>
              <p className="mt-2 text-carbon/70">Gracias por escribirnos — te respondemos pronto.</p>
            </div>
          ) : (
            <Form method="post" className="mt-10 flex flex-col gap-4">
              <div>
                <label htmlFor="name" className="text-sm font-semibold text-carbon">
                  Nombre
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  autoComplete="name"
                  className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="email" className="text-sm font-semibold text-carbon">
                  Correo electrónico
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="message" className="text-sm font-semibold text-carbon">
                  Mensaje
                </label>
                <textarea
                  id="message"
                  name="message"
                  required
                  rows={5}
                  className="mt-1 w-full rounded-xl border border-carbon/15 px-4 py-2.5 focus:border-oliva focus:outline-none"
                />
              </div>

              {actionData?.error && (
                <p className="text-sm font-semibold text-red-600">{actionData.error}</p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-2 min-h-11 self-start rounded-full bg-lima px-8 text-sm font-bold text-carbon transition-transform hover:scale-105 disabled:opacity-60"
              >
                {isSubmitting ? "Enviando…" : "Enviar mensaje"}
              </button>
              <LegalNotice lead="Usaremos tus datos solo para responder tu mensaje." />
            </Form>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
