import { Link, NavLink, useRouteLoaderData } from "@remix-run/react";
import { useState } from "react";
import type { loader as RootLoader } from "~/root";
import { Logo } from "~/components/ui/Logo";
import { CloseIcon, MenuIcon } from "~/components/ui/Icons";

const links = [
  { to: "/tienda", label: "Tienda", isStore: true },
  { to: "/como-funciona", label: "Cómo funciona" },
  { to: "/blog", label: "Blog Cívico" },
  { to: "/nosotros", label: "Nosotros" },
];

export function Navbar({ cartCount = 0, onOpenCart }: { cartCount?: number; onOpenCart?: () => void }) {
  const [open, setOpen] = useState(false);
  // Mientras la tienda no es pública (y quien navega no es admin) se oculta
  // todo lo que lleva a ella: Tienda, carrito y cuenta de cliente.
  const storeVisible = useRouteLoaderData<typeof RootLoader>("root")?.storeVisible ?? false;
  const visibleLinks = links.filter((link) => storeVisible || !link.isStore);

  return (
    <header className="sticky top-0 z-50 border-b border-carbon/5 bg-hueso/90 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="STOPee, inicio">
          <Logo variant="compact" className="h-14 w-auto sm:h-16" />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {visibleLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `font-body text-sm font-semibold transition-colors hover:text-oliva ${
                  isActive ? "text-oliva" : "text-carbon/80"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {storeVisible && (
            <>
            <Link
              to="/cuenta"
              className="hidden rounded-full px-4 py-2 text-sm font-semibold text-carbon/80 transition-colors hover:bg-carbon/5 sm:inline-block"
            >
              Mi cuenta
            </Link>
            {onOpenCart ? (
              <button
                type="button"
                onClick={onOpenCart}
                className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-lima px-5 py-2.5 text-sm font-bold text-carbon transition-transform hover:scale-105 active:scale-95"
                aria-label={`Carrito, ${cartCount} artículos`}
              >
                Carrito
                {cartCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-bosque text-[11px] font-bold text-hueso">
                    {cartCount}
                  </span>
                )}
              </button>
            ) : (
              <Link
                to="/tienda#carrito"
                className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-lima px-5 py-2.5 text-sm font-bold text-carbon transition-transform hover:scale-105 active:scale-95"
                aria-label={`Carrito, ${cartCount} artículos`}
              >
                Carrito
                {cartCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-bosque text-[11px] font-bold text-hueso">
                    {cartCount}
                  </span>
                )}
              </Link>
            )}
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon md:hidden"
            aria-label="Abrir menú"
            aria-expanded={open}
          >
            {open ? <CloseIcon className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="flex flex-col gap-1 border-t border-carbon/5 bg-hueso px-4 pb-4 pt-2 md:hidden">
          {visibleLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-3 text-base font-semibold text-carbon hover:bg-carbon/5"
            >
              {link.label}
            </Link>
          ))}
          {storeVisible && (
            <Link
              to="/cuenta"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-3 text-base font-semibold text-carbon hover:bg-carbon/5"
            >
              Mi cuenta
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}
