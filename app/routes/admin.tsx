import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, NavLink, Outlet, useLoaderData } from "@remix-run/react";
import { requireAdmin } from "~/lib/session.server";
import { Logo } from "~/components/ui/Logo";

const NAV_ITEMS = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/settings", label: "Configuración" },
  { to: "/admin/catalog", label: "Catálogo" },
  { to: "/admin/discounts", label: "Descuentos" },
  { to: "/admin/leads", label: "Lista de espera" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const admin = await requireAdmin(request);
  return json({ adminEmail: admin.email as string });
}

export default function AdminLayout() {
  const { adminEmail } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen bg-hueso">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-carbon/10 bg-carbon text-hueso md:flex">
        <div className="p-6">
          <Logo className="h-9 w-auto" />
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-hueso/40">
            Backoffice
          </p>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-4">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `min-h-11 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                  isActive ? "bg-lima text-carbon" : "text-hueso/70 hover:bg-hueso/10"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-hueso/10 p-4">
          <p className="truncate px-2 text-xs text-hueso/50">{adminEmail}</p>
          <Form method="post" action="/cuenta/salir">
            <button
              type="submit"
              className="mt-2 min-h-11 w-full rounded-xl px-4 py-2.5 text-left text-sm font-semibold text-hueso/70 hover:bg-hueso/10"
            >
              Cerrar sesión
            </button>
          </Form>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        {/* Nav móvil simple: mismos destinos, sin drawer, para no complicar Fitts/Hick en pantallas chicas */}
        <nav className="flex gap-1 overflow-x-auto border-b border-carbon/10 bg-carbon px-3 py-2 md:hidden">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `min-h-11 shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
                  isActive ? "bg-lima text-carbon" : "text-hueso/70"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 p-4 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
