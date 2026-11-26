import { Link, useRouteLoaderData } from "react-router";
import type { loader as RootLoader } from "~/root";
import { Logo } from "~/components/ui/Logo";
import { SocialIcon } from "~/components/ui/SocialIcon";
import { CookieSettingsButton } from "~/components/ui/CookieConsent";

export function Footer() {
  const rootData = useRouteLoaderData<typeof RootLoader>("root");
  const socialLinks = rootData?.socialLinks ?? [];
  const storeVisible = rootData?.storeVisible ?? false;
  const subscriptionLinkLabel = rootData?.subscriptionLinkLabel ?? "Auto-envío";
  const hasSocialLinks = socialLinks.length > 0;

  return (
    <footer className="border-t border-hueso/10 bg-carbon text-hueso">
      <div className={`mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 ${storeVisible ? "md:grid-cols-5" : "md:grid-cols-4"}`}>
        <div className="md:col-span-2">
          <Logo className="h-28 w-auto" />
          <p className="mt-4 max-w-sm text-sm text-hueso/70">
            Concentrado biotecnológico de higiene urbana canina.
            <br />
            {/* Espacios sin corte: «1 litro» nunca se parte entre dos renglones. */}
            1&nbsp;litro rinde 30&nbsp;litros de solución activa.
          </p>
          <p className="mt-4 max-w-sm text-base font-bold text-hueso">Ciudades limpias, paseos impecables.</p>
        </div>

        {storeVisible && (
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
                <Link to="/suscripcion" className="hover:text-hueso">
                  {subscriptionLinkLabel}
                </Link>
              </li>
              <li>
                <Link to="/cuenta" className="hover:text-hueso">
                  Mi cuenta
                </Link>
              </li>
            </ul>
          </div>
        )}

        <div>
          <p className="font-body text-sm font-bold uppercase tracking-wide text-lima">
            Comunidad
          </p>
          <ul className="mt-3 space-y-2 text-sm text-hueso/70">
            <li>
              <Link to="/como-funciona" className="hover:text-hueso">
                Cómo funciona
              </Link>
            </li>
            <li>
              <Link to="/nosotros" className="hover:text-hueso">
                Nosotros
              </Link>
            </li>
            <li>
              <Link to="/blog" className="hover:text-hueso">
                Blog cívico
              </Link>
            </li>
            <li>
              <Link to="/puntos-de-recarga" className="hover:text-hueso">
                Puntos de Recarga
              </Link>
            </li>
            <li>
              <Link to="/contacto" className="hover:text-hueso">
                Contacto
              </Link>
            </li>
            <li>
              <Link to="/preguntas-frecuentes" className="hover:text-hueso">
                Preguntas frecuentes
              </Link>
            </li>
            <li>
              <Link to="/envios" className="hover:text-hueso">
                Envíos
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="font-body text-sm font-bold uppercase tracking-wide text-lima">
            Legal
          </p>
          <ul className="mt-3 space-y-2 text-sm text-hueso/70">
            <li>
              <Link to="/aviso-de-privacidad" className="hover:text-hueso">
                Aviso de privacidad
              </Link>
            </li>
            <li>
              <Link to="/terminos-y-condiciones" className="hover:text-hueso">
                Términos y condiciones
              </Link>
            </li>
            <li>
              <Link to="/politica-de-cookies" className="hover:text-hueso">
                Política de cookies
              </Link>
            </li>
            <li>
              <CookieSettingsButton className="hover:text-hueso">Configurar cookies</CookieSettingsButton>
            </li>
          </ul>
        </div>
      </div>

      {hasSocialLinks && (
        <div className="flex items-center justify-center gap-4 border-t border-hueso/10 py-6">
          {socialLinks.map((social) => (
            <a
              key={social.url}
              href={social.url}
              target="_blank"
              rel="noreferrer"
              aria-label={social.name}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-hueso/15 text-hueso/70 transition-colors hover:border-lima/40 hover:text-lima"
            >
              <SocialIcon id={social.id} />
            </a>
          ))}
        </div>
      )}

      <div className="border-t border-hueso/10 px-4 py-5 text-center text-xs text-hueso/50 sm:px-6">
        © {new Date().getFullYear()} STOPee.com.mx — Todos los derechos reservados.
      </div>
    </footer>
  );
}
