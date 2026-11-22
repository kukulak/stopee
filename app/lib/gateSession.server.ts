import { createCookieSessionStorage } from "react-router";
import { cookieSecret } from "~/lib/secrets.server";

const GATE_SECRET = cookieSecret("gate");

/** Cookie de sesión HTTP-only aparte de la de cuenta/carrito — solo dice "esta clave de acceso privado ya se validó", nada de datos de usuario. */
export const gateStorage = createCookieSessionStorage({
  cookie: {
    name: "__stopee_gate",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [GATE_SECRET],
    secure: process.env.NODE_ENV === "production",
    // Respaldo genérico si la compuerta no tiene fecha de fin configurada
    // (activación solo manual) — una campaña real casi siempre define
    // endsAt, y ese valor manda sobre este default (ver grantGateAccess).
    maxAge: 60 * 60 * 24 * 7,
  },
});

export async function hasGateAccess(request: Request): Promise<boolean> {
  const session = await gateStorage.getSession(request.headers.get("Cookie"));
  return session.get("unlocked") === true;
}

/** Cookie con vigencia hasta `expiresAt` si se da (normalmente el endsAt de la campaña), o el default del storage si no. */
export async function grantGateAccess(request: Request, expiresAt?: Date | null): Promise<string> {
  const session = await gateStorage.getSession(request.headers.get("Cookie"));
  session.set("unlocked", true);
  if (expiresAt && expiresAt.getTime() > Date.now()) {
    return gateStorage.commitSession(session, { expires: expiresAt });
  }
  return gateStorage.commitSession(session);
}
