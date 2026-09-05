import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation, useSearchParams } from "@remix-run/react";
import { connectDB } from "~/lib/db.server";
import { UserModel, verifyPassword } from "~/models/user.server";
import { createUserSession, getUserId } from "~/lib/session.server";
import { Logo } from "~/components/ui/Logo";

export const meta: MetaFunction = () => [{ title: "Acceso administrador — STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  // No usa requireAdmin a propósito: esta página debe poder mostrarse a
  // alguien sin sesión, o con sesión pero sin rol admin (para explicarle
  // por qué no puede entrar), sin quedar atrapada en el redirect de admin.tsx.
  const userId = await getUserId(request);
  if (userId) return redirect("/admin");
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "/admin");

  if (!email || !password) {
    return json({ error: "Ingresa tu correo y contraseña." }, { status: 400 });
  }

  await connectDB();
  const user = await UserModel.findOne({ email });

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return json({ error: "Correo o contraseña incorrectos." }, { status: 401 });
  }

  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  if (user.role !== "admin" && adminEmail && user.email === adminEmail) {
    user.role = "admin";
    await user.save();
  }

  if (user.role !== "admin") {
    return json(
      { error: "Esta cuenta no tiene permisos de administrador." },
      { status: 403 },
    );
  }

  return createUserSession(String(user._id), redirectTo);
}

export default function AdminLogin() {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const redirectTo = searchParams.get("redirectTo") ?? "/admin";
  const isSubmitting = navigation.state !== "idle";

  return (
    <div className="flex min-h-screen items-center justify-center bg-carbon px-4">
      <div className="w-full max-w-sm">
        <Logo className="h-10 w-auto" />
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
              autoComplete="email"
              className="mt-1 w-full min-h-11 rounded-xl border border-hueso/15 bg-hueso/5 px-4 text-hueso focus:border-lima focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="password" className="text-sm font-semibold text-hueso">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full min-h-11 rounded-xl border border-hueso/15 bg-hueso/5 px-4 text-hueso focus:border-lima focus:outline-none"
            />
          </div>

          {actionData?.error && (
            <p className="text-sm font-semibold text-red-400">{actionData.error}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 min-h-11 rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60"
          >
            {isSubmitting ? "Entrando…" : "Entrar"}
          </button>
        </Form>
      </div>
    </div>
  );
}
