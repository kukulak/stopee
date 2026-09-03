import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { Logo } from "~/components/ui/Logo";
import { connectDB } from "~/lib/db.server";
import { hashPassword, UserModel } from "~/models/user.server";
import { createUserSession, getUserId } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Crear cuenta — STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await getUserId(request);
  if (userId) return redirect("/cuenta");
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const dogName = String(formData.get("dogName") ?? "").trim();

  if (!email || !password || password.length < 8) {
    return json(
      { error: "Ingresa un correo válido y una contraseña de al menos 8 caracteres." },
      { status: 400 },
    );
  }

  await connectDB();
  const existing = await UserModel.findOne({ email });
  if (existing) {
    return json({ error: "Ya existe una cuenta con ese correo." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await UserModel.create({ email, passwordHash, name, dogName });

  return createUserSession(String(user._id), "/cuenta");
}

export default function Registro() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <div className="flex min-h-screen items-center justify-center bg-hueso px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" aria-label="STOPee, inicio">
          <Logo className="h-10 w-auto" />
        </Link>
        <h1 className="mt-6 font-display text-2xl font-black text-carbon">Crea tu cuenta</h1>
        <p className="mt-1 text-sm text-carbon/60">
          Guarda tus datos para pedidos más rápidos y administra tu suscripción.
        </p>

        <Form method="post" className="mt-6 flex flex-col gap-4">
          <div>
            <label htmlFor="name" className="text-sm font-semibold text-carbon">
              Tu nombre
            </label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="dogName" className="text-sm font-semibold text-carbon">
              Nombre de tu perro (opcional)
            </label>
            <input
              id="dogName"
              name="dogName"
              type="text"
              className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
            />
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
              minLength={8}
              autoComplete="new-password"
              className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
            />
            <p className="mt-1 text-xs text-carbon/50">Mínimo 8 caracteres.</p>
          </div>

          {actionData?.error && (
            <p className="text-sm font-semibold text-red-600">{actionData.error}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 min-h-11 rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60"
          >
            {isSubmitting ? "Creando cuenta…" : "Crear cuenta"}
          </button>
        </Form>

        <p className="mt-6 text-center text-sm text-carbon/60">
          ¿Ya tienes cuenta?{" "}
          <Link to="/cuenta/entrar" className="font-semibold text-bosque hover:underline">
            Inicia sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
