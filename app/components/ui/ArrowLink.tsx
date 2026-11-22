import { Link } from "react-router";
import { ArrowIcon, type ArrowDirection } from "~/components/ui/Icons";

/**
 * Enlace de texto que se nota clicable: color de marca, semibold, flecha
 * dibujada que se desplaza al pasar el cursor y subrayado lima que se
 * oscurece al hover. Con
 * `to` navega dentro del sitio; con `href` es un <a> normal (`external` lo
 * abre en pestaña nueva con la flecha diagonal).
 */
export function ArrowLink({
  to,
  href,
  external = false,
  direction,
  className = "",
  children,
}: {
  to?: string;
  href?: string;
  external?: boolean;
  direction?: ArrowDirection;
  className?: string;
  children: React.ReactNode;
}) {
  const dir = direction ?? (external ? "external" : "right");
  const classes = `group inline-flex items-center gap-1.5 font-semibold text-bosque underline decoration-lima decoration-2 underline-offset-4 transition-colors hover:decoration-bosque ${className}`;
  const content = (
    <>
      {dir === "left" && <ArrowIcon direction="left" />}
      {children}
      {dir !== "left" && <ArrowIcon direction={dir} />}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes}>
        {content}
      </Link>
    );
  }
  return (
    <a
      href={href}
      className={classes}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {content}
    </a>
  );
}
