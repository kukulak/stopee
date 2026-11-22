import { isStaff } from "~/lib/roles";
import { data, redirect } from "react-router";
import { getSiteSettings } from "~/models/siteSettings.server";
import { getUser } from "~/lib/session.server";

/**
 * Mientras la tienda no esté activa (isStoreActive = false) solo un
 * administrador con sesión iniciada puede ver o usar cualquier parte de la
 * venta (catálogo, fichas, club, carrito, checkout). El resto del sitio
 * (blog, cómo funciona, nosotros, FAQs…) sigue público.
 */
export async function canAccessStore(request: Request): Promise<boolean> {
  const settings = await getSiteSettings();
  if (settings.isStoreActive) return true;
  const user = await getUser(request);
  return isStaff(user?.role);
}

/** Para páginas: a quien no tenga acceso lo manda al inicio (landing de pre-lanzamiento). */
export async function requireStoreAccess(request: Request) {
  if (!(await canAccessStore(request))) throw redirect("/");
}

/** Para endpoints (checkout, suscripción…): responde 403 en JSON en vez de redirigir. */
export async function requireStoreAccessApi(request: Request) {
  if (!(await canAccessStore(request))) {
    throw data({ error: "La tienda todavía no está disponible." }, { status: 403 });
  }
}
