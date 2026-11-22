import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { randomBytes } from "node:crypto";
import { useState } from "react";
import { z } from "zod";
import { connectDB } from "~/lib/db.server";
import { hashPassword, UserModel } from "~/models/user.server";
import { requireAdmin } from "~/lib/session.server";
import { isSuperAdmin, ROLE_LABELS } from "~/lib/roles";
import { passwordProblem } from "~/lib/password";
import { sendInvitationEmail, sendVerificationEmail } from "~/lib/accountEmails.server";
import { checkRateLimit, rateLimitMessage } from "~/lib/rateLimit.server";
import { logAudit } from "~/lib/logger.server";
import { ArrowLink } from "~/components/ui/ArrowLink";
import { PasswordField } from "~/components/ui/PasswordField";
import { CheckIcon } from "~/components/ui/Icons";

export const meta: MetaFunction = () => [{ title: "Nuevo usuario — Admin STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireAdmin(request);
  return data({ canCreateAdmin: isSuperAdmin(viewer.role) });
}

const createSchema = z.object({
  name: z.string().trim().max(120),
  email: z.string().trim().toLowerCase().email("Escribe un correo válido.").max(254),
  role: z.enum(["customer", "admin"]),
  mode: z.enum(["invite", "password"]),
  password: z.string().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  const viewer = await requireAdmin(request);

  const limit = checkRateLimit(`admin-create-user:${String(viewer._id)}`, { max: 30, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return data({ error: rateLimitMessage(limit.retryAfterSeconds), created: null }, { status: 429 });

  const formData = await request.formData();
  const parsed = createSchema.safeParse({
    name: formData.get("name") ?? "",
    email: formData.get("email"),
    role: formData.get("role") ?? "customer",
    mode: formData.get("mode") ?? "invite",
    password: formData.get("password") ?? undefined,
  });
  if (!parsed.success) {
    return data({ error: parsed.error.issues[0]?.message ?? "Revisa los datos.", created: null }, { status: 400 });
  }
  const { name, email, role, mode } = parsed.data;

  // Dar rol de administrador es cosa del super administrador: un administrador común
  // podría, si no, crear cuentas con tanto poder como la suya sin control.
  if (role === "admin" && !isSuperAdmin(viewer.role)) {
    return data({ error: "Solo un super administrador puede crear administradores.", created: null }, { status: 403 });
  }

  let passwordHash: string;
  if (mode === "password") {
    const problem = passwordProblem(parsed.data.password ?? "", email);
    if (problem) return data({ error: problem, created: null }, { status: 400 });
    passwordHash = await hashPassword(parsed.data.password!);
  } else {
    // Contraseña al azar que nadie conoce: la cuenta queda inaccesible hasta que
    // la persona elija la suya con el enlace de invitación.
    passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  }

  await connectDB();
  if (await UserModel.exists({ email })) {
    return data({ error: "Ya existe una cuenta con ese correo. Búscala en Clientes para cambiarle el rol.", created: null }, { status: 409 });
  }

  const user = await UserModel.create({ email, name, passwordHash, role });
  logAudit("user.created", { by: String(viewer._id), userId: String(user._id), role, mode });

  let emailSent: boolean | null = null;
  let inviteUrl: string | null = null;
  if (mode === "invite") {
    const { url, result } = await sendInvitationEmail(user);
    emailSent = result.ok;
    // Si el correo no salió (Brevo sin configurar o caído), el administrador puede pasar el enlace a mano.
    if (!result.ok) inviteUrl = url;
  } else {
    const { url, result } = await sendVerificationEmail(user);
    emailSent = result.ok;
    if (!result.ok) inviteUrl = url;
  }

  return data({
    error: null,
    created: { id: String(user._id), email, role, mode, emailSent, inviteUrl },
  });
}

const inputClass = "mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none";

export default function AdminNewUser() {
  const { canCreateAdmin } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const [role, setRole] = useState<"customer" | "admin">("customer");
  const [mode, setMode] = useState<"invite" | "password">("invite");
  const created = actionData?.created ?? null;

  return (
    <div className="flex min-w-0 max-w-xl flex-col gap-6">
      <div>
        <ArrowLink to="/admin/customers" direction="left" className="text-sm">Volver a clientes</ArrowLink>
        <h1 className="mt-2 font-display text-2xl font-black text-carbon sm:text-3xl">Nuevo usuario</h1>
        <p className="mt-1 text-sm text-carbon/60">
          Crea una cuenta para un cliente o para alguien de tu equipo.
        </p>
      </div>

      {created ? (
        <div role="status" className="rounded-3xl border-2 border-lima bg-lima/10 p-5 sm:p-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-lima/40 text-bosque">
            <CheckIcon className="h-5 w-5" />
          </span>
          <p className="mt-3 font-display text-xl font-black text-carbon">Usuario creado</p>
          <p className="mt-1 break-all text-sm text-carbon/70">
            {created.email} · {ROLE_LABELS[created.role as "customer" | "admin"]}
          </p>

          {created.mode === "invite" && created.emailSent && (
            <p className="mt-3 text-sm text-carbon/70">
              Le enviamos un correo para que elija su contraseña. El enlace funciona durante 3 días.
            </p>
          )}
          {!created.emailSent && created.inviteUrl && (
            <div className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-semibold">No pudimos enviar el correo.</p>
              <p className="mt-1">
                {created.mode === "invite"
                  ? "Copia este enlace y mándaselo tú (funciona 3 días y solo una vez):"
                  : "Copia este enlace de confirmación y mándaselo tú (funciona 24 horas y solo una vez). Sin abrirlo no podrá entrar:"}
              </p>
              <input
                readOnly
                value={created.inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Enlace de invitación"
                className="mt-2 w-full min-h-11 rounded-xl border border-amber-300 bg-white px-3 text-xs text-carbon"
              />
            </div>
          )}
          {created.mode === "password" && (
            <p className="mt-3 text-sm text-carbon/70">
              {created.emailSent ? "Le enviamos un correo para confirmar su dirección. " : ""}
              Hasta que confirme su correo no podrá entrar, aunque tenga la contraseña. Avísale la contraseña por un medio seguro.
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={`/admin/customers/${created.id}`}
              className="inline-flex min-h-11 items-center rounded-full bg-carbon px-6 text-sm font-bold text-hueso"
            >
              Ver perfil
            </a>
            <a
              href="/admin/customers/new"
              className="inline-flex min-h-11 items-center rounded-full border border-carbon/15 px-6 text-sm font-semibold text-carbon hover:border-carbon/30"
            >
              Crear otro
            </a>
          </div>
        </div>
      ) : (
        <Form method="post" className="flex flex-col gap-5 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="text-sm font-semibold text-carbon">Nombre</label>
              <input id="name" name="name" autoComplete="off" className={inputClass} />
            </div>
            <div>
              <label htmlFor="email" className="text-sm font-semibold text-carbon">Correo</label>
              <input id="email" name="email" type="email" required autoComplete="off" className={inputClass} />
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-carbon">Rol</legend>
            <div className="mt-1 flex flex-col gap-2">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-carbon/15 p-3 text-sm has-[:checked]:border-oliva has-[:checked]:bg-oliva/5">
                <input
                  type="radio"
                  name="role"
                  value="customer"
                  checked={role === "customer"}
                  onChange={() => setRole("customer")}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-lima"
                />
                <span>
                  <span className="font-semibold text-carbon">Cliente</span>
                  <span className="block text-carbon/60">Compra en la tienda y ve su cuenta.</span>
                </span>
              </label>
              {canCreateAdmin ? (
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-carbon/15 p-3 text-sm has-[:checked]:border-oliva has-[:checked]:bg-oliva/5">
                  <input
                    type="radio"
                    name="role"
                    value="admin"
                    checked={role === "admin"}
                    onChange={() => setRole("admin")}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-lima"
                  />
                  <span>
                    <span className="font-semibold text-carbon">Administrador</span>
                    <span className="block text-carbon/60">
                      Entra al panel: catálogo, pedidos, promociones, clientes. No puede crear ni cambiar roles.
                    </span>
                  </span>
                </label>
              ) : (
                <p className="text-xs text-carbon/50">Crear administradores lo hace solo un super administrador.</p>
              )}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-carbon">Contraseña</legend>
            <div className="mt-1 flex flex-col gap-2">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-carbon/15 p-3 text-sm has-[:checked]:border-oliva has-[:checked]:bg-oliva/5">
                <input
                  type="radio"
                  name="mode"
                  value="invite"
                  checked={mode === "invite"}
                  onChange={() => setMode("invite")}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-lima"
                />
                <span>
                  <span className="font-semibold text-carbon">Que la persona elija la suya (recomendado)</span>
                  <span className="block text-carbon/60">Le llega un correo con un enlace. Tú nunca ves su contraseña.</span>
                </span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-carbon/15 p-3 text-sm has-[:checked]:border-oliva has-[:checked]:bg-oliva/5">
                <input
                  type="radio"
                  name="mode"
                  value="password"
                  checked={mode === "password"}
                  onChange={() => setMode("password")}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-lima"
                />
                <span>
                  <span className="font-semibold text-carbon">Ponerle una contraseña ahora</span>
                  <span className="block text-carbon/60">Mínimo 8 caracteres. Igual tendrá que confirmar su correo antes de entrar.</span>
                </span>
              </label>
            </div>
            {mode === "password" && (
              <div className="mt-3">
                <label htmlFor="password" className="text-sm font-semibold text-carbon">Contraseña inicial</label>
                <PasswordField
                  id="password"
                  name="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  inputClassName={inputClass}
                />
              </div>
            )}
          </fieldset>

          {actionData?.error && <p role="alert" className="text-sm font-semibold text-red-600">{actionData.error}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60"
          >
            {isSubmitting ? "Creando…" : "Crear usuario"}
          </button>
        </Form>
      )}
    </div>
  );
}
