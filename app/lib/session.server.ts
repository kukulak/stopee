import { createCookieSessionStorage, redirect } from "@remix-run/node";
import { UserModel } from "~/models/user.server";
import { connectDB } from "~/lib/db.server";

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

export async function createUserSession(userId: string, redirectTo: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return redirect(redirectTo, {
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

export async function requireUserId(request: Request, redirectTo = "/cuenta/entrar") {
  const userId = await getUserId(request);
  if (!userId) {
    const url = new URL(request.url);
    const searchParams = new URLSearchParams([["redirectTo", url.pathname]]);
    throw redirect(`${redirectTo}?${searchParams}`);
  }
  return userId;
}

export async function getUser(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return null;
  await connectDB();
  return UserModel.findById(userId).lean();
}

/**
 * Protege las rutas de /admin. Reutiliza la misma sesión de cliente: un
 * usuario se vuelve administrador teniendo `role: "admin"`, o iniciando
 * sesión con el correo declarado en ADMIN_EMAIL (bootstrap del primer
 * administrador sin necesitar un script aparte).
 */
export async function requireAdmin(request: Request) {
  const userId = await getUserId(request);
  if (!userId) {
    const url = new URL(request.url);
    const searchParams = new URLSearchParams([["redirectTo", url.pathname]]);
    throw redirect(`/admin/login?${searchParams}`);
  }

  await connectDB();
  const user = await UserModel.findById(userId);
  if (!user) {
    const url = new URL(request.url);
    const searchParams = new URLSearchParams([["redirectTo", url.pathname]]);
    throw redirect(`/admin/login?${searchParams}`);
  }

  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  if (user.role !== "admin" && adminEmail && user.email === adminEmail) {
    user.role = "admin";
    await user.save();
  }

  if (user.role !== "admin") {
    throw new Response("No tienes permisos de administrador para ver esta página.", {
      status: 403,
    });
  }

  return user.toObject();
}

export async function logout(request: Request) {
  const session = await getSession(request);
  return redirect("/", {
    headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
  });
}
