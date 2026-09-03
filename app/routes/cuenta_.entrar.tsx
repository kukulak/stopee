import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation, useSearchParams } from "@remix-run/react";
import { Logo } from "~/components/ui/Logo";
import { connectDB } from "~/lib/db.server";
import { UserModel, verifyPassword } from "~/models/user.server";
import { createUserSession, getUserId } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Iniciar sesión — STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await getUserId(request);
  if (userId) return redirect("/cuenta");
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "/cuenta");

  if (!email || !password) {
    return json({ error: "Ingresa tu correo y contraseña." }, { status: 400 });
  }

  await connectDB();
  const user = await UserModel.findOne({ email });

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return json({ error: "Correo o contraseña incorrectos." }, { status: 401 });
  }

  return createUserSession(String(user._id), redirectTo);
}

export default function Entrar() {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const redirectTo = searchParams.get("redirectTo") ?? "/cuenta";
  const isSubmitting = navigation.state !== "idle";

  return (
    <div className="flex min-h-screen items-center justify-center bg-hueso px-4">
      <div className="w-full max-w-sm">
        <Link to="/" aria-label="STOPee, inicio">
          <Logo className="h-10 w-auto" />
        </Link>
        <h1 className="mt-6 font-display text-2xl font-black text-carbon">
          Entra a tu cuenta
        </h1>
        <p className="mt-1 text-sm text-carbon/60">
          Consulta tus pedidos y administra tu suscripción.
        </p>

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
              autoComplete="email"
              className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="password" className="text-sm font-semibold text-carbon">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
            />
          </div>

          {actionData?.error && (
            <p className="text-sm font-semibold text-red-600">{actionData.error}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60"
          >
            {isSubmitting ? "Entrando…" : "Entrar"}
          </button>
        </Form>

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
