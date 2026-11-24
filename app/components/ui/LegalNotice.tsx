import { Link } from "react-router";

const LINK = "font-semibold underline underline-offset-2 hover:text-carbon";

/**
 * Aviso legal corto para donde se piden datos (registro, contacto, pago, suscripción): la ley pide
 * que el aviso de privacidad esté a la vista ANTES de recabar los datos. Dos formas:
 *  - `action`: «Al {action} aceptas los términos y el aviso de privacidad» (cuando hay un contrato:
 *    crear una cuenta, pagar, activar una suscripción).
 *  - `lead`: una frase propia + enlace al aviso (cuando solo se recibe un mensaje o un correo).
 *
 * `newTab` abre los textos en otra pestaña, para no sacar a nadie del carrito o del pago.
 */
export function LegalNotice({
  action,
  lead,
  newTab = false,
  className = "",
}: {
  action?: string;
  lead?: string;
  newTab?: boolean;
  className?: string;
}) {
  const external = newTab ? { target: "_blank", rel: "noreferrer" } : {};
  const privacy = (
    <Link to="/aviso-de-privacidad" className={LINK} {...external}>
      aviso de privacidad
    </Link>
  );

  return (
    <p className={`text-xs leading-relaxed text-carbon/60 ${className}`}>
      {action ? (
        <>
          Al {action} aceptas los{" "}
          <Link to="/terminos-y-condiciones" className={LINK} {...external}>
            términos y condiciones
          </Link>{" "}
          y el {privacy}.
        </>
      ) : (
        <>
          {lead ? `${lead} ` : ""}Más información en nuestro {privacy}.
        </>
      )}
    </p>
  );
}
