import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useEffect, useState } from "react";
import { Form, NavLink, Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { requireAdmin } from "~/lib/session.server";
import { getSiteSettings } from "~/models/siteSettings.server";
import { ContactMessageModel } from "~/models/contactMessage.server";
import { connectDB } from "~/lib/db.server";
import { Logo } from "~/components/ui/Logo";
import { ArrowIcon, ChevronIcon, CloseIcon, MenuIcon } from "~/components/ui/Icons";

const NAV_ITEMS: {
  to: string;
  label: string;
  end?: boolean;
  children?: { to: string; label: string }[];
}[] = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/negocio", label: "Datos del negocio" },
  { to: "/admin/orders", label: "Pedidos" },
  { to: "/admin/settings", label: "Configuración" },
  {
    to: "/admin/catalog",
    label: "Catálogo",
    children: [
      { to: "/admin/catalog/products", label: "Productos" },
      { to: "/admin/catalog/bundles", label: "Paquetes" },
    ],
  },
  { to: "/admin/discounts", label: "Promociones" },
  { to: "/admin/shipping", label: "Envíos" },
  { to: "/admin/subscription", label: "Auto-envío" },
  { to: "/admin/banners", label: "Banners" },
  { to: "/admin/blog", label: "Blog" },
  { to: "/admin/customers", label: "Clientes" },
  { to: "/admin/leads", label: "Lista de espera" },
  { to: "/admin/messages", label: "Mensajes" },
  { to: "/admin/exit-intent", label: "Popup de salida" },
  { to: "/admin/testimonials", label: "Testimonios" },
  { to: "/admin/legal", label: "Legal (ARCO)" },
  { to: "/admin/password-gate", label: "Acceso privado" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const admin = await requireAdmin(request);
  await connectDB();
  const [settings, unreadMessages] = await Promise.all([
    getSiteSettings(),
    ContactMessageModel.countDocuments({ isRead: false }),
  ]);
  return json({ adminEmail: admin.email as string, isStoreActive: settings.isStoreActive, unreadMessages });
}

export default function AdminLayout() {
  const { adminEmail, isStoreActive, unreadMessages } = useLoaderData<typeof loader>();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Al elegir una sección el menú se cierra solo.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  return (
    <div className="flex min-h-screen w-full max-w-full overflow-x-clip bg-hueso">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-carbon/10 bg-carbon text-hueso md:flex">
        <div className="p-6">
          <Logo variant="compact" className="h-9 w-auto" />
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-hueso/40">
            Backoffice
          </p>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-4">
          {NAV_ITEMS.map((item) =>
            item.children ? (
              <div key={item.to} className="group relative">
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex min-h-11 items-center justify-between rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                      isActive ? "bg-lima text-carbon" : "text-hueso/70 hover:bg-hueso/10"
                    }`
                  }
                >
                  <span>{item.label}</span>
                  <ChevronIcon className="h-4 w-4 opacity-60" />
                </NavLink>
                <div className="invisible absolute left-full top-0 z-10 ml-1 min-w-40 rounded-xl border border-carbon/10 bg-white p-1.5 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                  {item.children.map((child) => (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      className={({ isActive }) =>
                        `block min-h-11 rounded-lg px-3 py-2.5 text-sm font-semibold ${
                          isActive ? "bg-lima/20 text-bosque" : "text-carbon hover:bg-carbon/5"
                        }`
                      }
                    >
                      {child.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex min-h-11 items-center justify-between rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                    isActive ? "bg-lima text-carbon" : "text-hueso/70 hover:bg-hueso/10"
                  }`
                }
              >
                <span>{item.label}</span>
                {item.to === "/admin/messages" && unreadMessages > 0 && (
                  <span className="rounded-full bg-lima px-2 py-0.5 text-xs font-bold text-carbon">
                    {unreadMessages}
                  </span>
                )}
              </NavLink>
            ),
          )}
        </nav>

        <div className="border-t border-hueso/10 p-4">
          <p className="truncate px-2 text-xs text-hueso/50">{adminEmail}</p>
          <NavLink
            to="/cuenta"
            className="mt-2 flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm font-semibold text-hueso/70 transition-colors hover:bg-hueso/10"
          >
            Mi perfil
          </NavLink>
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

      <div className="flex min-w-0 max-w-full flex-1 flex-col">
        {/* Móvil: barra fija con el botón de menú. Todas las secciones están en el panel, sin scroll lateral. */}
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-hueso/10 bg-carbon px-4 py-2 md:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <Logo variant="compact" className="h-8 w-auto shrink-0" />
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-hueso/50">Backoffice</p>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
            aria-expanded={menuOpen}
            aria-controls="admin-mobile-menu"
            className="relative flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-hueso hover:bg-hueso/10"
          >
            <MenuIcon className="h-6 w-6" />
            {unreadMessages > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-lima" aria-hidden="true" />
            )}
          </button>
        </header>

        <div
          id="admin-mobile-menu"
          className={`fixed inset-0 z-50 md:hidden transition-[visibility] duration-200 ${menuOpen ? "visible" : "invisible"}`}
        >
          <div
            className={`absolute inset-0 bg-carbon/60 transition-opacity duration-200 ${menuOpen ? "opacity-100" : "opacity-0"}`}
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menú del backoffice"
            className={`absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col bg-carbon text-hueso shadow-2xl transition-transform duration-200 ${
              menuOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-hueso/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${isStoreActive ? "bg-lima" : "bg-hueso/30"}`}
                  aria-hidden="true"
                />
                <span className="text-xs font-semibold text-hueso/70">
                  {isStoreActive ? "Tienda activa" : "Tienda en pre-lanzamiento"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Cerrar menú"
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-hueso hover:bg-hueso/10"
              >
                <CloseIcon className="h-6 w-6" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-3" aria-label="Secciones del backoffice">
              <ul className="flex flex-col gap-1">
                {NAV_ITEMS.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end || Boolean(item.children)}
                      className={({ isActive }) =>
                        `flex min-h-11 items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold ${
                          isActive ? "bg-lima text-carbon" : "text-hueso/80 hover:bg-hueso/10"
                        }`
                      }
                    >
                      <span className="min-w-0 break-words">{item.label}</span>
                      {item.to === "/admin/messages" && unreadMessages > 0 && (
                        <span className="shrink-0 rounded-full bg-lima px-2 py-0.5 text-xs font-bold text-carbon">
                          {unreadMessages}
                        </span>
                      )}
                    </NavLink>
                    {item.children && (
                      <ul className="ml-4 mt-1 flex flex-col gap-1 border-l border-hueso/15 pl-2">
                        {item.children.map((child) => (
                          <li key={child.to}>
                            <NavLink
                              to={child.to}
                              className={({ isActive }) =>
                                `flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm font-semibold ${
                                  isActive ? "bg-lima text-carbon" : "text-hueso/70 hover:bg-hueso/10"
                                }`
                              }
                            >
                              {child.label}
                            </NavLink>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </nav>

            {/* Siempre visible al pie del panel, sin importar cuántas secciones haya arriba. */}
            <div className="border-t border-hueso/10 px-3 py-3">
              <p className="truncate px-4 pb-1 text-xs text-hueso/50">{adminEmail}</p>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={isStoreActive ? "/" : "/tienda"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-hueso/20 px-3 text-sm font-semibold text-hueso hover:bg-hueso/10"
                >
                  {isStoreActive ? "Ver sitio" : "Ver tienda"}
                  <ArrowIcon direction="external" />
                </a>
                <NavLink
                  to="/cuenta"
                  className="flex min-h-11 items-center justify-center rounded-xl border border-hueso/20 px-3 text-sm font-semibold text-hueso hover:bg-hueso/10"
                >
                  Mi perfil
                </NavLink>
              </div>
              <Form method="post" action="/cuenta/salir" className="mt-2">
                <button
                  type="submit"
                  className="min-h-11 w-full rounded-xl bg-hueso/10 px-4 text-sm font-semibold text-hueso hover:bg-hueso/20"
                >
                  Cerrar sesión
                </button>
              </Form>
            </div>
          </div>
        </div>

        <div className="hidden items-center justify-end gap-2 border-b border-carbon/10 bg-white px-4 py-2.5 sm:px-8 md:flex">
          <span
            className={`h-2 w-2 rounded-full ${isStoreActive ? "bg-lima" : "bg-carbon/30"}`}
            aria-hidden="true"
          />
          <span className="text-xs font-semibold text-carbon/60">
            {isStoreActive ? "Tienda activa" : "Tienda en pre-lanzamiento"}
          </span>
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="group ml-3 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-carbon/15 px-4 text-sm font-semibold text-carbon hover:border-carbon/30"
          >
            Ver sitio
            <ArrowIcon direction="external" />
          </a>
          {!isStoreActive && (
            <a
              href="/tienda"
              target="_blank"
              rel="noreferrer"
              className="group inline-flex min-h-11 items-center gap-1.5 rounded-full bg-lima px-4 text-sm font-semibold text-carbon hover:scale-105"
            >
              Vista previa: Tienda
              <ArrowIcon direction="external" />
            </a>
          )}
        </div>

        <main className="min-w-0 max-w-full flex-1 break-words p-4 sm:p-6 lg:p-8 [&_img]:max-w-full [&_input]:max-w-full [&_select]:max-w-full [&_textarea]:max-w-full">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
