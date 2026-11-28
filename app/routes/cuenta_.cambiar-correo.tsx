import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { Logo } from "~/components/ui/Logo";
import { CheckIcon } from "~/components/ui/Icons";
import { connectDB } from "~/lib/db.server";
import { consumeToken, peekToken } from "~/lib/authTokens.server";
import { applyEmailChange } from "~/lib/emailChange.server";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { maskEmail } from "~/lib/maskEmail";

export const meta: MetaFunction = () => [{ title: "Confirmar correo nuevo — STOPee" }, { name: "robots", content: "noindex" }];

const HEADERS = { "Referrer-Policy": "no-referrer" };

/**
 * El enlace del correo NUEVO. Abrirlo solo muestra qué se va a cambiar; el cambio ocurre al tocar el botón. Así un
 * antivirus o la vista previa del correo, que abren los enlaces solos, no cambian la cuenta de nadie.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const token = new URL(request.url).searchParams.get("token");
  await connectDB();
  const peeked = await peekToken(token, "email-change");
  return data({ valid: Boolean(peeked?.email), token: peeked ? token : null, maskedEmail: peeked?.email ? maskEmail(peeked.email) : "" }, { headers: HEADERS });
}

export async function action({ request }: ActionFunctionArgs) {
  const limit = await checkRateLimit(`cambiar-correo:${getClientIp(request)}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) return data({ status: "error" as const, message: rateLimitMessage(limit.retryAfterSeconds) }, { status: 429, headers: HEADERS });

  const formData = await request.formData();
  await connectDB();
  const consumed = await consumeToken(String(formData.get("token") ?? ""), "email-change");
  if (!consumed?.email) return data({ status: "expired" as const }, { status: 400, headers: HEADERS });

  const result = await applyEmailChange(consumed.userId, consumed.email);
  if (!result.ok) return data({ status: "error" as const, message: result.error }, { status: 400, headers: HEADERS });
  return data({ status: "done" as const, email: result.to }, { headers: HEADERS });
}

export default function CambiarCorreo() {
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
            <h1 className="mt-4 font-display text-2xl font-black text-carbon">Listo, cambiamos tu correo</h1>
            <p className="mt-2 text-carbon/70">
              Desde ahora tu correo es <span className="break-all font-semibold text-carbon">{result.email}</span>. Entra con él y con tu misma
              contraseña. Avisamos al correo anterior.
            </p>
            <Link
              to="/cuenta"
              className="mt-6 inline-flex min-h-11 items-center rounded-full bg-carbon px-6 text-sm font-bold text-hueso"
            >
              Ir a Mi cuenta
            </Link>
          </div>
        ) : !valid || result?.status === "expired" ? (
          <div className="mt-6">
            <h1 className="font-display text-2xl font-black text-carbon">Este enlace ya no sirve</h1>
            <p className="mt-2 text-carbon/70">
              Ya venció o ya se usó. Entra a Mi cuenta, en «Mi perfil», y pide el cambio de correo otra vez.
            </p>
            <Link to="/cuenta" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-carbon px-6 text-sm font-bold text-hueso">
              Ir a Mi cuenta
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mt-6 font-display text-2xl font-black text-carbon">Confirma tu correo nuevo</h1>
            <p className="mt-2 text-carbon/70">
              Tu cuenta de STOPee pasará a usar <span className="break-all font-semibold text-carbon">{maskedEmail}</span>. Los avisos de tus pedidos llegarán
              ahí.
            </p>
            {result?.status === "error" && (
              <p role="alert" className="mt-3 text-sm font-semibold text-red-600">
                {result.message}
              </p>
            )}
            <Form method="post" className="mt-6">
              <input type="hidden" name="token" value={token ?? ""} />
              <button
                type="submit"
                disabled={busy}
                className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60"
              >
                {busy ? "Cambiando…" : "Confirmar el cambio"}
              </button>
            </Form>
            <p className="mt-4 text-sm text-carbon/60">Si tú no lo pediste, cierra esta página: no cambia nada.</p>
          </>
        )}
      </div>
    </div>
  );
}
