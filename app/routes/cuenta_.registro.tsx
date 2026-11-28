import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import { Form, Link, useActionData, useNavigation } from "react-router";
import { z } from "zod";
import { useState } from "react";
import { Logo } from "~/components/ui/Logo";
import { PasswordField } from "~/components/ui/PasswordField";
import { connectDB } from "~/lib/db.server";
import { hashPassword, UserModel } from "~/models/user.server";
import { getUserId } from "~/lib/session.server";
import { passwordProblem } from "~/lib/password";
import { sendAccountAlreadyExistsNotice, sendVerificationEmail, settleWithin } from "~/lib/accountEmails.server";
import { maskEmail } from "~/lib/maskEmail";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { ResendVerification } from "~/components/ui/ResendVerification";
import { CheckIcon } from "~/components/ui/Icons";
import { LegalNotice } from "~/components/ui/LegalNotice";
import { MarketingOptIn } from "~/components/ui/MarketingOptIn";
import { readMarketingOptIn } from "~/lib/marketing";
import { fullNameOf } from "~/lib/names";

export const meta: MetaFunction = () => [{ title: "Crear cuenta — STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await getUserId(request);
  if (userId) return redirect("/cuenta");
  return data({});
}

const registroSchema = z.object({
  email: z.string().trim().toLowerCase().email("Ingresa un correo válido."),
  password: z.string(),
  confirmPassword: z.string(),
  // .nullish() (no solo .optional()) porque formData.get() devuelve `null`,
  // no `undefined`, cuando el campo no viene en la petición.
  firstName: z.string().trim().min(2, "Escribe tu nombre.").max(60, "Tu nombre es demasiado largo."),
  lastName: z.string().trim().min(2, "Escribe tus apellidos.").max(80, "Tus apellidos son demasiado largos."),
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
  const rateLimit = await checkRateLimit(`cuenta-registro:${ip}`, { max: 5, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) {
    return data({ error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 });
  }

  const formData = await request.formData();
  const parsed = registroSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword") ?? "",
    firstName: formData.get("firstName") ?? "",
    lastName: formData.get("lastName") ?? "",
    // El campo se llama "mascota" (no "dogName") para que Chrome no lo
    // confunda con el nombre de la persona al guardar sus datos.
    dogName: formData.get("mascota"),
  });

  if (!parsed.success) {
    return data({ error: parsed.error.issues[0]?.message ?? "Revisa los datos." }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const { firstName, lastName } = parsed.data;
  const name = fullNameOf(firstName, lastName);
  const dogName = parsed.data.dogName ?? "";
  // Solo cuenta cuando confirme su correo (el CSV de campañas pide correo confirmado): nadie queda apuntado por un tercero.
  const marketing = readMarketingOptIn(formData);

  // Tope por correo: sin él, alguien podría llenar de mensajes la bandeja de un tercero.
  const emailLimit = await checkRateLimit(`registro-email:${email}`, { max: 3, windowMs: 60 * 60 * 1000 });

  await connectDB();
  const existing = await UserModel.findOne({ email }).select("email name emailVerifiedAt").lean();

  // La pantalla responde IGUAL exista o no la cuenta: decir "ese correo ya está registrado" le
  // permitiría a cualquiera comprobar qué correos tienen cuenta. Lo que cambia llega solo a la
  // bandeja de ese correo. El cifrado de la contraseña se paga también para una cuenta existente,
  // así lo que tarda la respuesta tampoco delata el caso.
  const passwordHash = await hashPassword(password);

  if (existing) {
    if (emailLimit.allowed) {
      // Sin confirmar: lo útil es otro enlace de confirmación. Ya confirmada: un aviso de que ya tiene cuenta.
      await settleWithin(
        existing.emailVerifiedAt
          ? sendAccountAlreadyExistsNotice(existing)
          : sendVerificationEmail(existing).then(({ result }) => result),
        2500,
      );
    }
    return data({ error: null, sentTo: email, maskedEmail: maskEmail(email) });
  }

  let user;
  try {
    user = await UserModel.create({ email, passwordHash, name, firstName, lastName, dogName, ...(marketing ? { marketingOptInAt: new Date() } : {}) });
  } catch (error) {
    // Dos registros del mismo correo a la vez: el segundo choca con el índice único y se trata como "ya existe".
    if ((error as { code?: number }).code === 11000) return data({ error: null, sentTo: email, maskedEmail: maskEmail(email) });
    throw error;
  }

  // La cuenta no entra hasta confirmar el correo (ver emailVerification.server.ts), así
  // que no se abre sesión aquí. Si Brevo tarda no se hace esperar a la clienta (el envío
  // sigue en segundo plano) y siempre puede pedir otro enlace al intentar entrar.
  if (emailLimit.allowed) await settleWithin(sendVerificationEmail(user), 2500);

  return data({ error: null, sentTo: email, maskedEmail: maskEmail(email) });
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
              Enviamos un mensaje a <span className="break-all font-semibold text-carbon">{actionData.maskedEmail}</span>.
              Ábrelo para continuar; después ya puedes entrar.
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
            <label htmlFor="firstName" className="text-sm font-semibold text-carbon">
              Nombre(s)
            </label>
            <input id="firstName" name="firstName" type="text" required minLength={2} maxLength={60} autoComplete="given-name" className={inputClass} />
          </div>
          <div>
            <label htmlFor="lastName" className="text-sm font-semibold text-carbon">
              Apellidos
            </label>
            <input id="lastName" name="lastName" type="text" required minLength={2} maxLength={80} autoComplete="family-name" className={inputClass} />
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
              Nombre de tu perrito (opcional)
            </label>
            <input id="mascota" name="mascota" type="text" autoComplete="off" className={inputClass} />
          </div>

          <MarketingOptIn />

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
          <LegalNotice action="crear tu cuenta" className="text-center" />
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
