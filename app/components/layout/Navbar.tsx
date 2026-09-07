import { Link, NavLink } from "@remix-run/react";
import { useState } from "react";
import { Logo } from "~/components/ui/Logo";

const links = [
  { to: "/tienda", label: "Tienda" },
  { to: "/blog", label: "Blog Cívico" },
  { to: "/modo-de-uso", label: "Modo de uso" },
];

export function Navbar({ cartCount = 0 }: { cartCount?: number }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-carbon/5 bg-hueso/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="STOPee, inicio">
          <Logo className="h-10 w-auto" />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
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
          <Link
            to="/cuenta"
            className="hidden rounded-full px-4 py-2 text-sm font-semibold text-carbon/80 transition-colors hover:bg-carbon/5 sm:inline-block"
          >
            Mi cuenta
          </Link>
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
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-carbon md:hidden"
            aria-label="Abrir menú"
            aria-expanded={open}
          >
            <span className="text-2xl">{open ? "✕" : "☰"}</span>
          </button>
        </div>
      </div>

      {open && (
        <nav className="flex flex-col gap-1 border-t border-carbon/5 bg-hueso px-4 pb-4 pt-2 md:hidden">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-3 text-base font-semibold text-carbon hover:bg-carbon/5"
            >
              {link.label}
            </Link>
          ))}
          <Link
            to="/cuenta"
            onClick={() => setOpen(false)}
            className="rounded-lg px-3 py-3 text-base font-semibold text-carbon hover:bg-carbon/5"
          >
            Mi cuenta
          </Link>
        </nav>
      )}
    </header>
  );
}
