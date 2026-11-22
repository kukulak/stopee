import { createCookieSessionStorage, redirect } from "@remix-run/node";
import { UserModel } from "~/models/user.server";
import { connectDB } from "~/lib/db.server";
import { safeRedirectTarget } from "~/lib/safeRedirect";
import { isStaff } from "~/lib/roles";

const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  throw new Error("Falta la variable de entorno SESSION_SECRET");
}

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__stopee_session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [SESSION_SECRET],
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  },
});

/** Un administrador debe haber iniciado sesión hace menos de esto; la cookie de cliente dura 30 días. */
const ADMIN_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

/** ¿La sesión se inició hace poco como para entrar al panel de administración? */
export function isFreshAdminSession(session: { get(key: string): unknown }) {
  const issuedAt = session.get("iat");
  return typeof issuedAt === "number" && Date.now() - issuedAt <= ADMIN_SESSION_MAX_AGE_MS;
}

export async function createUserSession(userId: string, redirectTo: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  // Momento del inicio de sesión: requireAdmin lo usa para exigir que el acceso
  // al panel sea reciente aunque la cookie de cliente siga vigente.
  session.set("iat", Date.now());
  // Defensa en profundidad: aunque una ruta olvide validar, nunca se redirige fuera del sitio.
  return redirect(safeRedirectTarget(redirectTo), {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

export async function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

export async function getUserId(request: Request) {
  const session = await getSession(request);
  const userId = session.get("userId");
  return typeof userId === "string" ? userId : null;
}

/**
 * Una sesión deja de valer si la contraseña cambió después de iniciarla (por
 * ejemplo, al restablecerla porque alguien más tenía acceso). Las cookies de
 * antes de que existiera `iat` cuentan como iniciadas en el momento cero.
 */
function sessionPredatesPasswordChange(session: { get(key: string): unknown }, passwordChangedAt?: Date | null) {
  if (!passwordChangedAt) return false;
  const issuedAt = session.get("iat");
  return typeof issuedAt !== "number" || issuedAt < passwordChangedAt.getTime();
}

export async function requireUserId(request: Request, redirectTo = "/cuenta/entrar") {
  const session = await getSession(request);
  const userId = session.get("userId");
  const toLogin = async () => {
    const url = new URL(request.url);
    const searchParams = new URLSearchParams([["redirectTo", url.pathname]]);
    return redirect(`${redirectTo}?${searchParams}`, {
      headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
    });
  };
  if (typeof userId !== "string") throw await toLogin();

  await connectDB();
  const account = await UserModel.findById(userId).select("passwordChangedAt emailVerifiedAt").lean();
  // Sin correo confirmado no hay sesión válida, ni siquiera una abierta antes de exigirlo.
  if (!account || !account.emailVerifiedAt || sessionPredatesPasswordChange(session, account.passwordChangedAt)) throw await toLogin();
  return userId;
}

export async function getUser(request: Request) {
  const session = await getSession(request);
  const userId = session.get("userId");
  if (typeof userId !== "string") return null;
  await connectDB();
  const user = await UserModel.findById(userId).lean();
  if (!user || !user.emailVerifiedAt || sessionPredatesPasswordChange(session, user.passwordChangedAt)) return null;
  return user;
}

/**
 * Protege las rutas de /admin. Reutiliza la misma sesión de cliente: un
 * usuario es administrador solo si su documento tiene `role: "admin"` o `"superadmin"`. El rol de superadmin
 * se asigna únicamente con `npm run make-admin -- correo` (nunca por el correo
 * con el que alguien se registra), y el acceso al panel exige haber iniciado
 * sesión hace menos de 8 horas.
 */
export async function requireAdmin(request: Request) {
  const loginRedirect = () => {
    const url = new URL(request.url);
    const searchParams = new URLSearchParams([["redirectTo", url.pathname]]);
    return redirect(`/admin/login?${searchParams}`);
  };

  const session = await getSession(request);
  const userId = session.get("userId");
  if (typeof userId !== "string") throw loginRedirect();

  if (!isFreshAdminSession(session)) throw loginRedirect();

  await connectDB();
  const user = await UserModel.findById(userId);
  if (!user || !user.emailVerifiedAt || sessionPredatesPasswordChange(session, user.passwordChangedAt)) throw loginRedirect();

  if (!isStaff(user.role)) {
    throw new Response("No tienes permisos de administrador para ver esta página.", {
      status: 403,
    });
  }

  return user.toObject();
}

/**
 * Para lo que solo debe hacer un super administrador (crear cuentas, cambiar
 * roles). Un administrador común recibe 403 aunque su sesión sea válida.
 */
export async function requireSuperAdmin(request: Request) {
  const user = await requireAdmin(request);
  if (user.role !== "superadmin") {
    throw new Response("Solo un super administrador puede hacer esto.", { status: 403 });
  }
  return user;
}

export async function logout(request: Request) {
  const session = await getSession(request);
  return redirect("/", {
    headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
  });
}
