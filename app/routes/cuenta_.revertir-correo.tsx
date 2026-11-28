import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { Logo } from "~/components/ui/Logo";
import { CheckIcon } from "~/components/ui/Icons";
import { connectDB } from "~/lib/db.server";
import { consumeToken, peekToken } from "~/lib/authTokens.server";
import { revertEmailChange } from "~/lib/emailChange.server";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { maskEmail } from "~/lib/maskEmail";

export const meta: MetaFunction = () => [{ title: "Recuperar mi cuenta — STOPee" }, { name: "robots", content: "noindex" }];

const HEADERS = { "Referrer-Policy": "no-referrer" };

/** El «no fui yo» del correo ANTERIOR. Igual que el de confirmar: abrir el enlace no hace nada, tocar el botón sí. */
export async function loader({ request }: LoaderFunctionArgs) {
  const token = new URL(request.url).searchParams.get("token");
  await connectDB();
  const peeked = await peekToken(token, "email-revert");
  return data({ valid: Boolean(peeked?.email), token: peeked ? token : null, maskedEmail: peeked?.email ? maskEmail(peeked.email) : "" }, { headers: HEADERS });
}

export async function action({ request }: ActionFunctionArgs) {
  const limit = await checkRateLimit(`revertir-correo:${getClientIp(request)}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) return data({ status: "error" as const, message: rateLimitMessage(limit.retryAfterSeconds) }, { status: 429, headers: HEADERS });

  const formData = await request.formData();
  await connectDB();
  const consumed = await consumeToken(String(formData.get("token") ?? ""), "email-revert");
  if (!consumed?.email) return data({ status: "expired" as const }, { status: 400, headers: HEADERS });

  const result = await revertEmailChange(consumed.userId, consumed.email);
  if (!result.ok) return data({ status: "error" as const, message: result.error }, { status: 400, headers: HEADERS });
  return data({ status: "done" as const, email: result.to }, { headers: HEADERS });
}

export default function RevertirCorreo() {
  const { valid, token, maskedEmail } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";

  return (
    <div className="flex min-h-screen items-center justify-center bg-hueso px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" aria-label="STOPee, inicio">
          <Logo variant="compact" className="h-16 w-auto" />
        </Link>

        {result?.status === "done" ? (
          <div role="status" className="mt-6">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-lima/30 text-bosque">
              <CheckIcon className="h-6 w-6" />
            </span>
            <h1 className="mt-4 font-display text-2xl font-black text-carbon">Recuperamos tu cuenta</h1>
            <p className="mt-2 text-carbon/70">
              Tu correo volvió a ser <span className="break-all font-semibold text-carbon">{result.email}</span> y cerramos todas las sesiones. Te mandamos
              a ese correo un enlace para elegir una contraseña nueva: ábrelo para volver a entrar.
            </p>
          </div>
        ) : !valid || result?.status === "expired" ? (
          <div className="mt-6">
            <h1 className="font-display text-2xl font-black text-carbon">Este enlace ya no sirve</h1>
            <p className="mt-2 text-carbon/70">
              Ya se usó o pasó una semana desde el cambio. Si crees que alguien se adueñó de tu cuenta, escríbenos y la protegemos contigo.
            </p>
            <Link to="/contacto" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-carbon px-6 text-sm font-bold text-hueso">
              Escribirnos
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mt-6 font-display text-2xl font-black text-carbon">¿No cambiaste tú tu correo?</h1>
            <p className="mt-2 text-carbon/70">
              Regresaremos el correo de la cuenta a <span className="break-all font-semibold text-carbon">{maskedEmail}</span>, cerraremos todas las sesiones y
              dejaremos sin efecto la contraseña actual. Después elegirás una nueva con un enlace que te mandamos.
            </p>
            {result?.status === "error" && (
              <p role="alert" className="mt-3 text-sm font-semibold text-red-600">
                {result.message}
              </p>
            )}
            <Form method="post" className="mt-6">
              <input type="hidden" name="token" value={token ?? ""} />
              <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60">
                {busy ? "Recuperando…" : "No fui yo: recuperar mi cuenta"}
              </button>
            </Form>
            <p className="mt-4 text-sm text-carbon/60">Si sí fuiste tú, cierra esta página: no hace falta nada más.</p>
          </>
        )}
      </div>
    </div>
  );
}
