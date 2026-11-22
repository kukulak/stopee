import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { Logo } from "~/components/ui/Logo";
import { PasswordField } from "~/components/ui/PasswordField";
import { connectDB } from "~/lib/db.server";
import { hashPassword, UserModel } from "~/models/user.server";
import { AuthTokenModel } from "~/models/authToken.server";
import { consumeToken, peekToken } from "~/lib/authTokens.server";
import { passwordProblem } from "~/lib/password";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { sendPasswordChangedNotice } from "~/lib/accountEmails.server";

export const meta: MetaFunction = () => [{ title: "Contraseña nueva — STOPee" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = new URL(request.url).searchParams.get("token");
  await connectDB();
  const valid = Boolean(await peekToken(token, "reset"));
  // La página lleva el token en la URL: que no viaje a terceros en el Referer.
  return json({ valid, token: valid ? token : null }, { headers: { "Referrer-Policy": "no-referrer" } });
}

export async function action({ request }: ActionFunctionArgs) {
  const limit = checkRateLimit(`restablecer:${getClientIp(request)}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) {
    return json({ error: rateLimitMessage(limit.retryAfterSeconds), expired: false }, { status: 429 });
  }

  const formData = await request.formData();
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  await connectDB();
  const peeked = await peekToken(token, "reset");
  if (!peeked) return json({ error: null, expired: true }, { status: 400 });

  const user = await UserModel.findById(peeked.userId);
  if (!user) return json({ error: null, expired: true }, { status: 400 });

  // Primero se valida la contraseña y luego se gasta el enlace: así un error de
  // captura no obliga a pedir otro correo.
  const problem = passwordProblem(password, user.email);
  if (problem) return json({ error: problem, expired: false }, { status: 400 });
  if (password !== confirmPassword) {
    return json({ error: "Las contraseñas no coinciden.", expired: false }, { status: 400 });
  }

  const consumed = await consumeToken(token, "reset");
  if (!consumed || consumed.userId !== String(user._id)) {
    return json({ error: null, expired: true }, { status: 400 });
  }

  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  // Quien recibió el enlace en su correo demostró que el correo es suyo.
  user.emailVerifiedAt ??= new Date();
  await user.save();
  await AuthTokenModel.deleteMany({ user: user._id, purpose: "reset" });

  await sendPasswordChangedNotice(user);

  // Las sesiones abiertas (incluida la de quien tuviera acceso) dejan de valer por passwordChangedAt.
  return redirect("/cuenta/entrar?restablecida=1");
}

export default function Restablecer() {
  const { valid, token } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const inputClass = "mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none";

  const linkIsDead = !valid || actionData?.expired;

  return (
    <div className="flex min-h-screen items-center justify-center bg-hueso px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" aria-label="STOPee, inicio">
          <Logo variant="compact" className="h-16 w-auto" />
        </Link>

        {linkIsDead ? (
          <div className="mt-6">
            <h1 className="font-display text-2xl font-black text-carbon">Este enlace ya no sirve</h1>
            <p className="mt-2 text-carbon/70">
              Ya venció o ya se usó. Pide uno nuevo y te lo mandamos de inmediato.
            </p>
            <Link
              to="/cuenta/olvide"
              className="mt-6 inline-flex min-h-11 items-center rounded-full bg-carbon px-6 text-sm font-bold text-hueso"
            >
              Pedir un enlace nuevo
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mt-6 font-display text-2xl font-black text-carbon">Elige tu contraseña nueva</h1>
            <p className="mt-1 text-sm text-carbon/60">
              Mínimo 8 caracteres. Al guardarla, se cerrarán las sesiones que tengas abiertas.
            </p>

            <Form method="post" className="mt-6 flex flex-col gap-4">
              <input type="hidden" name="token" value={token ?? ""} />
              <div>
                <label htmlFor="password" className="text-sm font-semibold text-carbon">
                  Contraseña nueva
                </label>
                <PasswordField
                  id="password"
                  name="password"
                  required
                  minLength={8}
                  autoFocus
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  inputClassName={inputClass}
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="text-sm font-semibold text-carbon">
                  Repite la contraseña
                </label>
                <PasswordField
                  id="confirmPassword"
                  name="confirmPassword"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  inputClassName={inputClass}
                />
                {mismatch && <p className="mt-1 text-xs font-semibold text-red-600">Las contraseñas no coinciden.</p>}
              </div>

              {actionData?.error && <p className="text-sm font-semibold text-red-600">{actionData.error}</p>}

              <button
                type="submit"
                disabled={isSubmitting || mismatch}
                className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60"
              >
                {isSubmitting ? "Guardando…" : "Guardar contraseña"}
              </button>
            </Form>
          </>
        )}
      </div>
    </div>
  );
}
