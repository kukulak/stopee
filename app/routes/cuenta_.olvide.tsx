import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import { Form, Link, useActionData, useNavigation } from "react-router";
import { z } from "zod";
import { Logo } from "~/components/ui/Logo";
import { connectDB } from "~/lib/db.server";
import { UserModel } from "~/models/user.server";
import { getUserId } from "~/lib/session.server";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { sendPasswordResetEmail } from "~/lib/accountEmails.server";
import { maskEmail } from "~/lib/maskEmail";

export const meta: MetaFunction = () => [{ title: "Recuperar contraseña — STOPee" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  if (await getUserId(request)) return redirect("/cuenta");
  return data({});
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** Tiempo mínimo de respuesta: existir o no la cuenta no debe notarse por lo que tarda la página. */
const MIN_RESPONSE_MS = 700;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function action({ request }: ActionFunctionArgs) {
  const ip = getClientIp(request);
  const ipLimit = await checkRateLimit(`olvide:${ip}`, { max: 5, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.allowed) {
    return data({ error: rateLimitMessage(ipLimit.retryAfterSeconds), sentTo: null, maskedEmail: null }, { status: 429 });
  }

  const formData = await request.formData();
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return data({ error: "Ingresa un correo válido.", sentTo: null, maskedEmail: null }, { status: 400 });
  }
  const email = parsed.data;

  // Tope por correo: sin él, alguien podría llenar de mensajes la bandeja de un tercero.
  const emailLimit = await checkRateLimit(`olvide-email:${email}`, { max: 3, windowMs: 60 * 60 * 1000 });
  if (emailLimit.allowed) {
    await Promise.all([
      (async () => {
        await connectDB();
        const user = await UserModel.findOne({ email }).select("email name").lean();
        if (user) await sendPasswordResetEmail(user);
      })(),
      sleep(MIN_RESPONSE_MS),
    ]);
  } else {
    await sleep(MIN_RESPONSE_MS);
  }

  // Misma respuesta exista o no la cuenta (o se haya llegado al tope): no se revela qué correos están registrados.
  return data({ error: null, sentTo: email, maskedEmail: maskEmail(email) });
}

export default function Olvide() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <div className="flex min-h-screen items-center justify-center bg-hueso px-4">
      <div className="w-full max-w-sm">
        <Link to="/" aria-label="STOPee, inicio">
          <Logo variant="compact" className="h-16 w-auto" />
        </Link>

        {actionData?.sentTo ? (
          <div role="status" className="mt-6">
            <h1 className="font-display text-2xl font-black text-carbon">Revisa tu correo</h1>
            <p className="mt-2 text-carbon/70">
              Si los datos coinciden con una cuenta, enviaremos un enlace para crear una contraseña nueva a{" "}
              <strong className="break-all text-carbon">{actionData.maskedEmail}</strong>. Funciona durante 1 hora.
            </p>
            <p className="mt-3 text-sm text-carbon/60">
              ¿No llega? Revisa la carpeta de spam o espera unos minutos antes de pedirlo otra vez.
            </p>
            <Link
              to="/cuenta/entrar"
              className="mt-6 inline-flex min-h-11 items-center rounded-full bg-carbon px-6 text-sm font-bold text-hueso"
            >
              Volver a iniciar sesión
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mt-6 font-display text-2xl font-black text-carbon">¿Olvidaste tu contraseña?</h1>
            <p className="mt-1 text-sm text-carbon/60">
              Escribe el correo de tu cuenta y te mandamos un enlace para crear una nueva.
            </p>

            <Form method="post" className="mt-6 flex flex-col gap-4">
              <div>
                <label htmlFor="email" className="text-sm font-semibold text-carbon">
                  Correo electrónico
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
                />
              </div>

              {actionData?.error && <p className="text-sm font-semibold text-red-600">{actionData.error}</p>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60"
              >
                {isSubmitting ? "Enviando…" : "Enviarme el enlace"}
              </button>
            </Form>

            <p className="mt-6 text-center text-sm text-carbon/60">
              <Link to="/cuenta/entrar" className="inline-flex min-h-11 items-center font-semibold text-bosque hover:underline">
                Volver a iniciar sesión
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
