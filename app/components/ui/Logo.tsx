import type { CSSProperties } from "react";
import { useRouteLoaderData } from "react-router";
import type { loader as RootLoader } from "~/root";

const DEFAULT_LOGO = "/elementos-design/logo-STOPee.webp";

/**
 * Wordmark de STOPee. Usa los logos que se suben en el backoffice (Datos del
 * negocio) y, si no hay ninguno, el arte original en public/elementos-design.
 *
 * `variant="compact"` es para lugares chicos (menú, pantallas de acceso),
 * donde el eslogan no se lee: usa el logo compacto (sin eslogan) si se subió
 * y, si no, el logo principal.
 */
export function Logo({
  className = "",
  style,
  variant = "full",
}: {
  className?: string;
  style?: CSSProperties;
  variant?: "full" | "compact";
}) {
  const root = useRouteLoaderData<typeof RootLoader>("root");
  const src = (variant === "compact" ? root?.logoCompactUrl || root?.logoUrl : root?.logoUrl) || DEFAULT_LOGO;
  return (
    <img
      src={src}
      alt="STOPee — Concentrado biotecnológico de higiene urbana"
      className={className}
      style={style}
    />
  );
}
