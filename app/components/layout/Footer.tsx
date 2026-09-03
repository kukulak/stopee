import { Link } from "@remix-run/react";
import { Logo } from "~/components/ui/Logo";

export function Footer() {
  return (
    <footer className="border-t border-hueso/10 bg-carbon text-hueso">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo className="h-12 w-auto" withTagline />
          <p className="mt-4 max-w-sm text-sm text-hueso/70">
            Concentrado biotecnológico de higiene urbana canina. 1 litro rinde 30 litros de
            solución activa. Ciudades limpias, paseos impecables.
          </p>
        </div>

        <div>
          <p className="font-body text-sm font-bold uppercase tracking-wide text-lima">
            Tienda
          </p>
          <ul className="mt-3 space-y-2 text-sm text-hueso/70">
            <li>
              <Link to="/tienda" className="hover:text-hueso">
                Productos y paquetes
              </Link>
            </li>
            <li>
              <Link to="/tienda#suscripcion" className="hover:text-hueso">
                Suscripción periódica
              </Link>
            </li>
            <li>
              <Link to="/cuenta" className="hover:text-hueso">
                Mi cuenta
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="font-body text-sm font-bold uppercase tracking-wide text-lima">
            Comunidad
          </p>
          <ul className="mt-3 space-y-2 text-sm text-hueso/70">
            <li>
              <Link to="/blog" className="hover:text-hueso">
                Blog cívico
              </Link>
            </li>
            <li>
              <a href="mailto:hola@stopee.com.mx" className="hover:text-hueso">
                hola@stopee.com.mx
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-hueso/10 px-4 py-5 text-center text-xs text-hueso/50 sm:px-6">
        © {new Date().getFullYear()} STOPee.com.mx — Todos los derechos reservados.
      </div>
    </footer>
  );
}
