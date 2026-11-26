import type { AnchorHTMLAttributes, MouseEvent } from "react";

/**
 * Enlace a una sección de la misma página («#datos»). Un `<a href="#datos">` común
 * cambia la dirección pero el router le devuelve el scroll arriba, así que la página
 * no se mueve. Este lleva a la sección con un desplazamiento suave (instantáneo si
 * la persona pidió menos movimiento) y deja la dirección actualizada para poder compartirla.
 */
export function AnchorLink({ href, onClick, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || !href.startsWith("#")) return;
    const target = document.getElementById(decodeURIComponent(href.slice(1)));
    if (!target) return; // sin esa sección, que el navegador haga lo suyo
    event.preventDefault();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    // replaceState no dispara el router: solo actualiza la dirección, sin otra entrada en el historial.
    window.history.replaceState(window.history.state, "", href);
  }

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
