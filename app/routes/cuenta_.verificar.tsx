import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Link, useLoaderData } from "react-router";
import { Logo } from "~/components/ui/Logo";
import { CheckIcon } from "~/components/ui/Icons";
import { connectDB } from "~/lib/db.server";
import { UserModel } from "~/models/user.server";
import { consumeToken } from "~/lib/authTokens.server";
import { checkRateLimit, getClientIp } from "~/lib/rateLimit.server";

export const meta: MetaFunction = () => [{ title: "Confirmar correo — STOPee" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const headers = { "Referrer-Policy": "no-referrer" };
  const limit = await checkRateLimit(`verificar:${getClientIp(request)}`, { max: 30, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) return data({ status: "invalid" as const }, { status: 429, headers });

  const token = new URL(request.url).searchParams.get("token");
  await connectDB();
  const consumed = await consumeToken(token, "verify");
  if (!consumed) return data({ status: "invalid" as const }, { headers });

  await UserModel.updateOne(
    { _id: consumed.userId, emailVerifiedAt: { $exists: false } },
    { $set: { emailVerifiedAt: new Date() } },
  );
  return data({ status: "verified" as const }, { headers });
}

export default function Verificar() {
  const { status } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen items-center justify-center bg-hueso px-4">
      <div className="w-full max-w-sm">
        <Link to="/" aria-label="STOPee, inicio">
          <Logo variant="compact" className="h-16 w-auto" />
        </Link>

        {status === "verified" ? (
          <div role="status" className="mt-6">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-lima/30 text-bosque">
              <CheckIcon className="h-6 w-6" />
            </span>
            <h1 className="mt-4 font-display text-2xl font-black text-carbon">Tu correo quedó confirmado</h1>
            <p className="mt-2 text-carbon/70">
              Ya puedes usar cupones personales y recibirás los avisos de tus pedidos en este correo.
            </p>
            <Link
              to="/cuenta"
              className="mt-6 inline-flex min-h-11 items-center rounded-full bg-carbon px-6 text-sm font-bold text-hueso"
            >
              Ir a mi cuenta
            </Link>
          </div>
        ) : (
          <div className="mt-6">
            <h1 className="font-display text-2xl font-black text-carbon">Este enlace ya no sirve</h1>
            <p className="mt-2 text-carbon/70">
              Venció (dura 24 horas) o ya se usó. Entra a tu cuenta y pide uno nuevo desde el aviso de confirmar correo.
            </p>
            <Link
              to="/cuenta"
              className="mt-6 inline-flex min-h-11 items-center rounded-full bg-carbon px-6 text-sm font-bold text-hueso"
            >
              Ir a mi cuenta
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
