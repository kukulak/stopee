/**
 * Roles de una cuenta. Sin sufijo ".server": también lo usan las pantallas.
 *
 *   customer    cliente de la tienda.
 *   admin       administrador: entra al panel y gestiona catálogo, pedidos, promociones, etc.
 *   superadmin  además crea cuentas, cambia roles y gestiona administradores. Solo se
 *               otorga desde la terminal (`npm run make-admin`), nunca desde el panel.
 */
export type UserRole = "customer" | "admin" | "superadmin";

export const ROLE_LABELS: Record<UserRole, string> = {
  customer: "Cliente",
  admin: "Administrador",
  superadmin: "Super administrador",
};

/** ¿Entra al panel de administración? */
export function isStaff(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}

export function isSuperAdmin(role: string | null | undefined): boolean {
  return role === "superadmin";
}
