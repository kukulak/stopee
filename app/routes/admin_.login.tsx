import { isStaff } from "~/lib/roles";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import { Form, useActionData, useNavigation, useSearchParams } from "react-router";
import { connectDB } from "~/lib/db.server";
import { PasswordField } from "~/components/ui/PasswordField";
import { UserModel, verifyPassword } from "~/models/user.server";
import { createUserSession, getSession, isFreshAdminSession, sessionStorage } from "~/lib/session.server";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { Logo } from "~/components/ui/Logo";
import { safeRedirectTarget } from "~/lib/safeRedirect";
import { unverifiedLoginResponse } from "~/lib/emailVerification.server";
import { beginTwoFactorChallenge } from "~/lib/twoFactor.server";
import { ResendVerification } from "~/components/ui/ResendVerification";

export const meta: MetaFunction = () => [{ title: "Acceso administrador — STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  // No usa requireAdmin a propósito: esta página debe poder mostrarse a
  // alguien sin sesión, con sesión vencida (el acceso al panel caduca a las
  // 8 horas) o con sesión pero sin rol admin, sin quedar atrapada en el
  // redirect de admin.tsx.
  const session = await getSession(request);
  const userId = session.get("userId");
  if (typeof userId !== "string") return data({});

  await connectDB();
  const user = await UserModel.findById(userId);
  if (user) {
    // Solo se salta el formulario si el acceso es de verdad válido; si no,
    // /admin lo rebotaría de vuelta aquí en un ciclo de redirecciones.
    // Con la verificación en dos pasos activa, una sesión de solo contraseña no abre el panel: se
    // queda aquí para pasar por el código (si no, rebotaría entre /admin y esta página).
    const secondFactorOk = !user.twoFactor?.enabledAt || session.get("mfa") === true;
    if (isStaff(user.role) && user.emailVerifiedAt && isFreshAdminSession(session) && secondFactorOk) return redirect("/admin");
    return data({});
  }

  // La cookie apunta a un usuario que ya no existe (p. ej. la base de datos
  // se reseteó o reseedeó) — admin.tsx redirige aquí al no encontrarlo, y
  // sin esto se generaría un ciclo infinito (ERR_TOO_MANY_REDIRECTS). Se
  // limpia la sesión inválida en vez de seguir rebotando.
  return data(
    {},
    { headers: { "Set-Cookie": await sessionStorage.destroySession(session) } },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  // Máximo 8 intentos cada 10 minutos por IP — suficiente para que alguien
  // se equivoque de contraseña un par de veces, no para probar miles de
  // combinaciones por fuerza bruta contra el panel de administrador.
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit(`admin-login:${ip}`, { max: 8, windowMs: 10 * 60 * 1000 });
  if (!rateLimit.allowed) {
    return data({ error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 });
  }

  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeRedirectTarget(String(formData.get("redirectTo") ?? ""), "/admin");

  if (!email || !password) {
    return data({ error: "Ingresa tu correo y contraseña." }, { status: 400 });
  }

  // Además del límite por IP: un atacante que rota de IP seguiría probando
  // contraseñas contra la misma cuenta sin este tope por correo.
  const emailLimit = await checkRateLimit(`admin-login-email:${email}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (!emailLimit.allowed) {
    return data({ error: rateLimitMessage(emailLimit.retryAfterSeconds) }, { status: 429 });
  }

  await connectDB();
  const user = await UserModel.findOne({ email });

  if (!(await verifyPassword(password, user?.passwordHash)) || !user) {
    return data({ error: "Correo o contraseña incorrectos." }, { status: 401 });
  }

  if (!isStaff(user.role)) {
    return data(
      { error: "Esta cuenta no tiene permisos de administrador." },
      { status: 403 },
    );
  }

  // Ni el panel se abre con un correo sin confirmar (ver emailVerification.server.ts).
  if (!user.emailVerifiedAt) return unverifiedLoginResponse(email);

  // Contraseña correcta, pero todavía sin sesión: falta el código de la app. Sin verificación activa
  // se abre la sesión, y el panel mismo la lleva a activarla (ver requireAdmin).
  if (user.twoFactor?.enabledAt) return beginTwoFactorChallenge(String(user._id), redirectTo);

  return createUserSession(String(user._id), redirectTo);
}

export default function AdminLogin() {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const redirectTo = safeRedirectTarget(searchParams.get("redirectTo"), "/admin");
  const isSubmitting = navigation.state !== "idle";
  const unverifiedEmail = actionData && "unverifiedEmail" in actionData ? String(actionData.unverifiedEmail) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-carbon px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo variant="compact" className="h-16 w-auto" />
        <h1 className="mt-6 font-display text-2xl font-black text-hueso">
          Acceso de administrador
        </h1>
        <p className="mt-1 text-sm text-hueso/60">
          Panel interno de STOPee. Usa tu cuenta con permisos de admin.
        </p>

        <Form method="post" className="mt-6 flex flex-col gap-4">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <div>
            <label htmlFor="email" className="text-sm font-semibold text-hueso">
              Correo electrónico
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="username"
              className="mt-1 w-full min-h-11 rounded-xl border border-hueso/15 bg-hueso/5 px-4 text-hueso focus:border-lima focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="password" className="text-sm font-semibold text-hueso">
              Contraseña
            </label>
            <PasswordField
              id="password"
              name="password"
              required
              autoComplete="current-password"
              inputClassName="mt-1 w-full min-h-11 rounded-xl border border-hueso/15 bg-hueso/5 px-4 text-hueso focus:border-lima focus:outline-none"
            />
          </div>

          {actionData?.error && (
            <p className="text-sm font-semibold text-red-400">{actionData.error}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 min-h-11 w-full rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60"
          >
            {isSubmitting ? "Entrando…" : "Entrar"}
          </button>
        </Form>

        {unverifiedEmail && (
          <div className="mt-4">
            <ResendVerification email={unverifiedEmail} tone="dark" />
          </div>
        )}
      </div>
    </div>
  );
}
