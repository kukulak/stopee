import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import { Form, Link, useActionData, useNavigation, useSearchParams } from "react-router";
import { connectDB } from "~/lib/db.server";
import { Logo } from "~/components/ui/Logo";
import { isStaff } from "~/lib/roles";
import { logAudit } from "~/lib/logger.server";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { createUserSession } from "~/lib/session.server";
import { clearChallengeCookie, getPendingChallenge, verifySecondFactor } from "~/lib/twoFactor.server";
import { UserModel } from "~/models/user.server";

export const meta: MetaFunction = () => [{ title: "Verificación en dos pasos — STOPee" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  // Sin el paso previo (contraseña correcta) no hay nada que verificar.
  const pending = await getPendingChallenge(request);
  if (!pending) return redirect("/admin/login");
  return data({}, { headers: { "Cache-Control": "private, no-store" } });
}

export async function action({ request }: ActionFunctionArgs) {
  const pending = await getPendingChallenge(request);
  if (!pending) return redirect("/admin/login");

  // Un código de 6 dígitos tiene un millón de combinaciones: sin tope, se adivinaría a fuerza bruta.
  const byAccount = await checkRateLimit(`admin-2fa:${pending.userId}`, { max: 5, windowMs: 10 * 60 * 1000 });
  const byIp = await checkRateLimit(`admin-2fa-ip:${getClientIp(request)}`, { max: 20, windowMs: 10 * 60 * 1000 });
  if (!byAccount.allowed || !byIp.allowed) {
    const wait = Math.max(byAccount.retryAfterSeconds, byIp.retryAfterSeconds);
    return data({ error: rateLimitMessage(wait) }, { status: 429 });
  }

  const formData = await request.formData();
  const code = String(formData.get("code") ?? "");
  if (!code.trim()) return data({ error: "Escribe el código." }, { status: 400 });

  await connectDB();
  // La cuenta pudo cambiar en los minutos que pasaron desde la contraseña (rol quitado, etc.).
  const user = await UserModel.findById(pending.userId).select("role emailVerifiedAt").lean();
  if (!user || !isStaff(user.role) || !user.emailVerifiedAt) {
    return redirect("/admin/login", { headers: { "Set-Cookie": await clearChallengeCookie(request) } });
  }

  const result = await verifySecondFactor(pending.userId, code);
  if (!result.ok) {
    logAudit("2fa.failed", { userId: pending.userId });
    return data({ error: "Ese código no es correcto. Escribe el que muestra tu app ahora mismo." }, { status: 401 });
  }

  logAudit(result.method === "recovery" ? "2fa.recovery_code_used" : "2fa.login", { userId: pending.userId });
  return createUserSession(pending.userId, pending.redirectTo, {
    secondFactor: true,
    alsoSetCookies: [await clearChallengeCookie(request)],
  });
}

export default function VerificarAdmin() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isSubmitting = navigation.state !== "idle";
  const usingRecovery = searchParams.get("recuperacion") === "1";
  const error = actionData && "error" in actionData ? actionData.error : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-carbon px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo variant="compact" className="h-16 w-auto" />
        <h1 className="mt-6 font-display text-2xl font-black text-hueso">
          {usingRecovery ? "Usa un código de recuperación" : "Escribe tu código"}
        </h1>
        <p className="mt-1 text-sm text-hueso/60">
          {usingRecovery
            ? "Escribe uno de los códigos que guardaste al activar la verificación. Cada uno sirve una sola vez."
            : "Abre tu app de códigos (Google Authenticator, 1Password, Authy…) y escribe los 6 dígitos de STOPee."}
        </p>

        <Form method="post" className="mt-6 flex flex-col gap-4">
          <div>
            <label htmlFor="code" className="text-sm font-semibold text-hueso">
              {usingRecovery ? "Código de recuperación" : "Código de 6 dígitos"}
            </label>
            <input
              id="code"
              name="code"
              type="text"
              required
              autoFocus
              autoComplete="one-time-code"
              inputMode={usingRecovery ? "text" : "numeric"}
              autoCapitalize={usingRecovery ? "characters" : "off"}
              spellCheck={false}
              maxLength={usingRecovery ? 14 : 7}
              placeholder={usingRecovery ? "ABCDE-FGHJK" : "123456"}
              className="mt-1 w-full min-h-12 rounded-xl border border-hueso/15 bg-hueso/5 px-4 text-center font-mono text-xl tracking-[0.3em] text-hueso placeholder:tracking-normal placeholder:text-hueso/30 focus:border-lima focus:outline-none"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm font-semibold text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-11 w-full rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60"
          >
            {isSubmitting ? "Verificando…" : "Entrar"}
          </button>
        </Form>

        <div className="mt-5 flex flex-col gap-1 text-sm">
          <Link
            to={usingRecovery ? "/admin/verificar" : "/admin/verificar?recuperacion=1"}
            className="inline-flex min-h-11 items-center font-semibold text-lima hover:underline"
          >
            {usingRecovery ? "Prefiero usar mi app de códigos" : "No tengo mi celular: usar un código de recuperación"}
          </Link>
          <Link to="/admin/login" className="inline-flex min-h-11 items-center text-hueso/60 hover:underline">
            Volver a empezar
          </Link>
        </div>
      </div>
    </div>
  );
}
