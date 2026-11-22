import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { useState } from "react";
import { Logo } from "~/components/ui/Logo";
import { PasswordField } from "~/components/ui/PasswordField";
import { connectDB } from "~/lib/db.server";
import { hashPassword, UserModel } from "~/models/user.server";
import { getUserId } from "~/lib/session.server";
import { passwordProblem } from "~/lib/password";
import { sendVerificationEmail, settleWithin } from "~/lib/accountEmails.server";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { ResendVerification } from "~/components/ui/ResendVerification";
import { CheckIcon } from "~/components/ui/Icons";

export const meta: MetaFunction = () => [{ title: "Crear cuenta — STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await getUserId(request);
  if (userId) return redirect("/cuenta");
  return json({});
}

const registroSchema = z.object({
  email: z.string().trim().toLowerCase().email("Ingresa un correo válido."),
  password: z.string(),
  confirmPassword: z.string(),
  // .nullish() (no solo .optional()) porque formData.get() devuelve `null`,
  // no `undefined`, cuando el campo no viene en la petición.
  name: z.string().trim().max(120).nullish(),
  dogName: z.string().trim().max(80).nullish(),
}).superRefine((data, ctx) => {
  const problem = passwordProblem(data.password, data.email);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ["password"] });
  else if (data.password !== data.confirmPassword) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Las contraseñas no coinciden.", path: ["confirmPassword"] });
  }
});

export async function action({ request }: ActionFunctionArgs) {
  // Límite antes de leer el cuerpo: evita que un script cree cuentas en serie
  // (y que gaste CPU de bcrypt) con correos ajenos.
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`cuenta-registro:${ip}`, { max: 5, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) {
    return json({ error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 });
  }

  const formData = await request.formData();
  const parsed = registroSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword") ?? "",
    name: formData.get("name"),
    // El campo se llama "mascota" (no "dogName") para que Chrome no lo
    // confunda con el nombre de la persona al guardar sus datos.
    dogName: formData.get("mascota"),
  });

  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Revisa los datos." }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const name = parsed.data.name ?? "";
  const dogName = parsed.data.dogName ?? "";

  await connectDB();
  const existing = await UserModel.findOne({ email });
  if (existing) {
    return json({ error: "Ya existe una cuenta con ese correo." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await UserModel.create({ email, passwordHash, name, dogName });

  // La cuenta no entra hasta confirmar el correo (ver emailVerification.server.ts), así
  // que no se abre sesión aquí. Si Brevo tarda no se hace esperar a la clienta (el envío
  // sigue en segundo plano) y siempre puede pedir otro enlace al intentar entrar.
  await settleWithin(sendVerificationEmail(user), 2500);

  return json({ error: null, sentTo: email });
}

export default function Registro() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const inputClass =
    "mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none";

  return (
    <div className="flex min-h-screen items-center justify-center bg-hueso px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" aria-label="STOPee, inicio">
          <Logo variant="compact" className="h-16 w-auto" />
        </Link>
        {actionData && "sentTo" in actionData && actionData.sentTo ? (
          <div role="status" className="mt-6">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-lima/30 text-bosque">
              <CheckIcon className="h-6 w-6" />
            </span>
            <h1 className="mt-4 font-display text-2xl font-black text-carbon">Revisa tu correo</h1>
            <p className="mt-2 text-carbon/70">
              Te enviamos un enlace a <span className="break-all font-semibold text-carbon">{actionData.sentTo}</span>.
              Ábrelo para confirmar que es tu correo; después ya puedes entrar.
            </p>
            <p className="mt-2 text-sm text-carbon/60">Si no lo ves en unos minutos, revisa la carpeta de spam.</p>
            <div className="mt-5">
              <ResendVerification email={actionData.sentTo} />
            </div>
            <Link
              to="/cuenta/entrar"
              className="mt-5 inline-flex min-h-11 items-center rounded-full bg-carbon px-6 text-sm font-bold text-hueso"
            >
              Ya lo confirmé, iniciar sesión
            </Link>
          </div>
        ) : (
        <>
        <h1 className="mt-6 font-display text-2xl font-black text-carbon">Crea tu cuenta</h1>
        <p className="mt-1 text-sm text-carbon/60">
          Guarda tus datos para pedidos más rápidos y administra tu suscripción.
        </p>

        <Form method="post" className="mt-6 flex flex-col gap-4">
          <div>
            <label htmlFor="name" className="text-sm font-semibold text-carbon">
              Tu nombre
            </label>
            <input id="name" name="name" type="text" autoComplete="name" className={inputClass} />
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
              autoComplete="username"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="password" className="text-sm font-semibold text-carbon">
              Contraseña
            </label>
            <PasswordField
              id="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              inputClassName={inputClass}
            />
            <p className="mt-1 text-xs text-carbon/50">Mínimo 8 caracteres.</p>
          </div>
          <div>
            <label htmlFor="confirmPassword" className="text-sm font-semibold text-carbon">
              Repite tu contraseña
            </label>
            <PasswordField
              id="confirmPassword"
              name="confirmPassword"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={mismatch}
              aria-describedby={mismatch ? "confirm-error" : undefined}
              inputClassName={inputClass}
            />
            {mismatch && (
              <p id="confirm-error" role="alert" className="mt-1 text-xs font-semibold text-red-600">
                Las contraseñas no coinciden.
              </p>
            )}
          </div>
          <div>
            {/* Va al final porque es opcional, y con id/name "mascota" y
                autocompletado apagado para que Chrome no lo guarde como el
                nombre de la persona. */}
            <label htmlFor="mascota" className="text-sm font-semibold text-carbon">
              Nombre de tu perro (opcional)
            </label>
            <input id="mascota" name="mascota" type="text" autoComplete="off" className={inputClass} />
          </div>

          {actionData?.error && (
            <p className="text-sm font-semibold text-red-600">{actionData.error}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting || mismatch}
            className="mt-2 min-h-11 rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60"
          >
            {isSubmitting ? "Creando cuenta…" : "Crear cuenta"}
          </button>
        </Form>

        <p className="mt-6 text-center text-sm text-carbon/60">
          ¿Ya tienes cuenta?{" "}
          <Link to="/cuenta/entrar" className="font-semibold text-bosque hover:underline">
            Inicia sesión
          </Link>
        </p>
        </>
        )}
      </div>
    </div>
  );
}
