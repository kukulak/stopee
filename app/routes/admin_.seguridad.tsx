import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import QRCode from "qrcode";
import { useState } from "react";
import { Logo } from "~/components/ui/Logo";
import { CheckIcon } from "~/components/ui/Icons";
import { logAudit } from "~/lib/logger.server";
import { checkRateLimit, rateLimitMessage } from "~/lib/rateLimit.server";
import { requireAdmin, sessionCookieWithSecondFactor } from "~/lib/session.server";
import { formatSecretForHumans, otpauthUri } from "~/lib/totp.server";
import { confirmEnrollment, getOrCreatePendingSecret, regenerateRecoveryCodes } from "~/lib/twoFactor.server";

export const meta: MetaFunction = () => [{ title: "Seguridad de la cuenta — STOPee" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  // Esta pantalla es la única del panel que se abre sin verificación en dos pasos: es donde se activa.
  const admin = await requireAdmin(request, { allowWithoutTwoFactor: true });
  const headers = { "Cache-Control": "private, no-store" };

  if (admin.twoFactorEnabled) {
    return data({ enabled: true as const, recoveryCodesLeft: admin.recoveryCodesLeft }, { headers });
  }

  const secret = await getOrCreatePendingSecret(admin._id);
  const qr = await QRCode.toDataURL(otpauthUri(secret, admin.email as string), { margin: 1, width: 224 });
  return data({ enabled: false as const, qr, secret: formatSecretForHumans(secret) }, { headers });
}

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireAdmin(request, { allowWithoutTwoFactor: true });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const code = String(formData.get("code") ?? "");

  const limit = checkRateLimit(`admin-2fa-setup:${String(admin._id)}`, { max: 8, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) return data({ error: rateLimitMessage(limit.retryAfterSeconds) }, { status: 429 });
  if (!code.trim()) return data({ error: "Escribe el código de 6 dígitos." }, { status: 400 });

  if (intent === "enable") {
    const recoveryCodes = await confirmEnrollment(admin._id, code);
    if (!recoveryCodes) {
      return data({ error: "Ese código no coincide. Revisa que sea el más reciente de tu app y vuelve a intentar." }, { status: 400 });
    }
    logAudit("2fa.enabled", { userId: String(admin._id) });
    // Quien acaba de demostrar que tiene la app sigue dentro: su sesión pasa a contar como verificada.
    return data({ recoveryCodes }, { headers: { "Set-Cookie": await sessionCookieWithSecondFactor(request) } });
  }

  if (intent === "regenerate") {
    const recoveryCodes = await regenerateRecoveryCodes(admin._id, code);
    if (!recoveryCodes) {
      return data({ error: "Ese código no coincide. Escribe el que muestra tu app ahora mismo." }, { status: 400 });
    }
    logAudit("2fa.recovery_regenerated", { userId: String(admin._id) });
    return data({ recoveryCodes });
  }

  return data({ error: "Acción no válida." }, { status: 400 });
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `Códigos de recuperación de STOPee\nCada uno sirve una sola vez.\n\n${codes.join("\n")}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      // Sin permiso de portapapeles: la persona puede seleccionarlos a mano.
    }
  }

  return (
    <div>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-lima/20 text-lima">
        <CheckIcon className="h-6 w-6" />
      </span>
      <h1 className="mt-4 font-display text-2xl font-black text-hueso">Guarda tus códigos de recuperación</h1>
      <p className="mt-2 text-sm text-hueso/70">
        Si pierdes tu celular, cada uno de estos códigos te deja entrar una vez. <strong className="text-hueso">No volverás a verlos</strong>:
        guárdalos ahora en tu gestor de contraseñas o imprímelos.
      </p>

      <ul className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-hueso/15 bg-hueso/5 p-4 font-mono text-base text-hueso" aria-label="Códigos de recuperación">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="min-h-11 rounded-full border border-hueso/25 px-5 text-sm font-semibold text-hueso">
          {copied ? "Copiados" : "Copiar"}
        </button>
        <a
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          download="stopee-codigos-de-recuperacion.txt"
          className="inline-flex min-h-11 items-center rounded-full border border-hueso/25 px-5 text-sm font-semibold text-hueso"
        >
          Descargar
        </a>
      </div>

      <label className="mt-6 flex min-h-11 items-start gap-3 text-sm text-hueso">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-lima" />
        Ya guardé mis códigos en un lugar seguro.
      </label>

      <Link
        to="/admin"
        aria-disabled={!saved}
        tabIndex={saved ? 0 : -1}
        onClick={(e) => {
          if (!saved) e.preventDefault();
        }}
        className={`mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full px-6 text-sm font-bold ${
          saved ? "bg-lima text-carbon" : "cursor-not-allowed bg-hueso/10 text-hueso/40"
        }`}
      >
        Ir al panel
      </Link>
    </div>
  );
}

export default function Seguridad() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const error = actionData && "error" in actionData ? actionData.error : null;
  const recoveryCodes = actionData && "recoveryCodes" in actionData ? actionData.recoveryCodes : null;

  const input = (
    <input
      id="code"
      name="code"
      type="text"
      required
      autoComplete="one-time-code"
      inputMode="numeric"
      spellCheck={false}
      maxLength={7}
      placeholder="123456"
      className="mt-1 w-full min-h-12 rounded-xl border border-hueso/15 bg-hueso/5 px-4 text-center font-mono text-xl tracking-[0.3em] text-hueso placeholder:tracking-normal placeholder:text-hueso/30 focus:border-lima focus:outline-none"
    />
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-carbon px-4 py-10">
      <div className="w-full max-w-md">
        <Logo variant="compact" className="h-16 w-auto" />

        {recoveryCodes ? (
          <div className="mt-6">
            <RecoveryCodes codes={recoveryCodes} />
          </div>
        ) : data.enabled ? (
          <div className="mt-6">
            <h1 className="font-display text-2xl font-black text-hueso">Verificación en dos pasos</h1>
            <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-lima/15 px-3 py-1 text-sm font-semibold text-lima">
              <CheckIcon className="h-4 w-4" /> Activa
            </p>
            <p className="mt-4 text-sm text-hueso/70">
              Al entrar al panel te pedimos, además de la contraseña, el código de tu app.
            </p>
            <p className={`mt-3 text-sm ${data.recoveryCodesLeft <= 3 ? "font-semibold text-amber-300" : "text-hueso/70"}`}>
              Códigos de recuperación sin usar: {data.recoveryCodesLeft}
              {data.recoveryCodesLeft <= 3 ? ". Genera unos nuevos pronto." : "."}
            </p>

            <Form method="post" className="mt-6 rounded-2xl border border-hueso/15 p-4">
              <input type="hidden" name="intent" value="regenerate" />
              <h2 className="text-sm font-bold text-hueso">Generar códigos de recuperación nuevos</h2>
              <p className="mt-1 text-sm text-hueso/60">Los anteriores dejan de servir. Confirma con el código de tu app.</p>
              <label htmlFor="code" className="mt-3 block text-sm font-semibold text-hueso">
                Código de 6 dígitos
              </label>
              {input}
              {error && (
                <p role="alert" className="mt-2 text-sm font-semibold text-red-400">
                  {error}
                </p>
              )}
              <button type="submit" disabled={isSubmitting} className="mt-3 min-h-11 w-full rounded-full border border-hueso/25 px-6 text-sm font-bold text-hueso disabled:opacity-60">
                {isSubmitting ? "Generando…" : "Generar códigos nuevos"}
              </button>
            </Form>

            <Link to="/admin" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-lima hover:underline">
              Volver al panel
            </Link>
          </div>
        ) : (
          <div className="mt-6">
            <h1 className="font-display text-2xl font-black text-hueso">Activa la verificación en dos pasos</h1>
            <p className="mt-2 text-sm text-hueso/70">
              Para entrar al panel necesitas, además de tu contraseña, un código de tu celular. Toma unos 2 minutos y solo se hace una vez.
            </p>

            <ol className="mt-6 flex flex-col gap-6">
              <li>
                <p className="text-sm font-bold text-lima">Paso 1 de 2 · Escanea el código</p>
                <p className="mt-1 text-sm text-hueso/70">
                  Abre una app de códigos (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) y escanea este cuadro.
                </p>
                <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                  <img src={data.qr} alt="Código QR para la app de verificación" width={224} height={224} className="rounded-2xl bg-white p-2" />
                  <div className="text-sm text-hueso/70">
                    <p>¿No puedes escanearlo? Escribe esta clave en la app:</p>
                    <p className="mt-2 select-all break-all font-mono text-base text-hueso">{data.secret}</p>
                  </div>
                </div>
              </li>
              <li>
                <Form method="post">
                  <input type="hidden" name="intent" value="enable" />
                  <label htmlFor="code" className="text-sm font-bold text-lima">
                    Paso 2 de 2 · Escribe el código que muestra la app
                  </label>
                  {input}
                  {error && (
                    <p role="alert" className="mt-2 text-sm font-semibold text-red-400">
                      {error}
                    </p>
                  )}
                  <button type="submit" disabled={isSubmitting} className="mt-3 min-h-11 w-full rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60">
                    {isSubmitting ? "Verificando…" : "Activar"}
                  </button>
                </Form>
              </li>
            </ol>

            <Form method="post" action="/cuenta/salir" className="mt-6">
              <button type="submit" className="inline-flex min-h-11 items-center text-sm text-hueso/60 hover:underline">
                Cerrar sesión
              </button>
            </Form>
          </div>
        )}
      </div>
    </div>
  );
}
