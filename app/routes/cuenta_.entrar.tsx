import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import { Form, Link, useActionData, useNavigation, useSearchParams } from "react-router";
import { Logo } from "~/components/ui/Logo";
import { safeRedirectTarget } from "~/lib/safeRedirect";
import { PasswordField } from "~/components/ui/PasswordField";
import { connectDB } from "~/lib/db.server";
import { UserModel, verifyPassword } from "~/models/user.server";
import { createUserSession, getUserId } from "~/lib/session.server";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { unverifiedLoginResponse } from "~/lib/emailVerification.server";
import { ResendVerification } from "~/components/ui/ResendVerification";

export const meta: MetaFunction = () => [{ title: "Iniciar sesión — STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await getUserId(request);
  if (userId) return redirect("/cuenta");
  return data({});
}

export async function action({ request }: ActionFunctionArgs) {
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`cuenta-login:${ip}`, { max: 8, windowMs: 10 * 60 * 1000 });
  if (!rateLimit.allowed) {
    return data({ error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 });
  }

  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeRedirectTarget(String(formData.get("redirectTo") ?? ""), "/cuenta");

  if (!email || !password) {
    return data({ error: "Ingresa tu correo y contraseña." }, { status: 400 });
  }

  // Además del límite por IP: un atacante que rota de IP seguiría probando
  // contraseñas contra la misma cuenta sin este tope por correo.
  const emailLimit = checkRateLimit(`cuenta-login-email:${email}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (!emailLimit.allowed) {
    return data({ error: rateLimitMessage(emailLimit.retryAfterSeconds) }, { status: 429 });
  }

  await connectDB();
  const user = await UserModel.findOne({ email });

  if (!(await verifyPassword(password, user?.passwordHash)) || !user) {
    return data({ error: "Correo o contraseña incorrectos." }, { status: 401 });
  }

  // Sin correo confirmado no se entra (ver emailVerification.server.ts).
  if (!user.emailVerifiedAt) return unverifiedLoginResponse(email);

  return createUserSession(String(user._id), redirectTo);
}

export default function Entrar() {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const redirectTo = safeRedirectTarget(searchParams.get("redirectTo"), "/cuenta");
  const isSubmitting = navigation.state !== "idle";
  const unverifiedEmail = actionData && "unverifiedEmail" in actionData ? String(actionData.unverifiedEmail) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-hueso px-4">
      <div className="w-full max-w-sm">
        <Link to="/" aria-label="STOPee, inicio">
          <Logo variant="compact" className="h-16 w-auto" />
        </Link>
        <h1 className="mt-6 font-display text-2xl font-black text-carbon">
          Entra a tu cuenta
        </h1>
        <p className="mt-1 text-sm text-carbon/60">
          Consulta tus pedidos y administra tu suscripción.
        </p>

        {searchParams.get("restablecida") === "1" && (
          <p role="status" className="mt-4 rounded-xl bg-lima/20 px-4 py-3 text-sm font-semibold text-bosque">
            Listo, tu contraseña quedó actualizada. Entra con la nueva.
          </p>
        )}

        <Form method="post" className="mt-6 flex flex-col gap-4">
          <input type="hidden" name="redirectTo" value={redirectTo} />
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
              className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="password" className="text-sm font-semibold text-carbon">
                Contraseña
              </label>
              <Link
                to="/cuenta/olvide"
                className="-my-2 inline-flex min-h-11 items-center text-sm font-semibold text-bosque hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <PasswordField
              id="password"
              name="password"
              required
              autoComplete="current-password"
              inputClassName="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
            />
          </div>

          {actionData?.error && (
            <p role="alert" className="text-sm font-semibold text-red-600">{actionData.error}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60"
          >
            {isSubmitting ? "Entrando…" : "Entrar"}
          </button>
        </Form>

        {unverifiedEmail && (
          <div className="mt-4">
            <ResendVerification email={unverifiedEmail} />
          </div>
        )}

        <p className="mt-6 text-center text-sm text-carbon/60">
          ¿Aún no tienes cuenta?{" "}
          <Link to="/cuenta/registro" className="font-semibold text-bosque hover:underline">
            Regístrate
          </Link>
        </p>
      </div>
    </div>
  );
}
