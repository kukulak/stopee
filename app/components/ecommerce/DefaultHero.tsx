import { Link } from "react-router";
import { ArrowIcon } from "~/components/ui/Icons";

/**
 * Hero de la portada cuando no hay ningún banner activo en /admin/banners.
 * Si hay uno, HeroBannerSection ocupa su lugar (ver app/routes/_index.tsx).
 * Va sobre el fondo oscuro con remolinos que pone el contenedor de la portada.
 */
export function DefaultHero({ exploreHref = "#tienda-teaser" }: { exploreHref?: string }) {
  return (
    <section className="relative flex min-h-[420px] items-center sm:min-h-[520px]">
      <div className="max-w-md px-6 py-16 sm:px-12">
        <p className="font-body text-sm font-bold uppercase tracking-widest text-lima">Concentrado biotecnológico</p>
        <h1 className="mt-3 font-display text-4xl font-black leading-[1.05] text-hueso sm:text-5xl">
          Ciudades limpias, paseos impecables.
        </h1>
        <p className="mt-4 max-w-sm text-hueso/75">
          El concentrado biotecnológico que neutraliza al instante y degrada los residuos del paseo canino. Un litro
          rinde 30 litros.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            to="/tienda"
            className="min-h-11 rounded-full bg-lima px-7 py-3 text-sm font-bold text-carbon transition-transform hover:scale-105 active:scale-95"
          >
            Comprar
          </Link>
          <a
            href={exploreHref}
            className="group inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-hueso/25 px-7 py-3 text-sm font-bold text-hueso transition-colors hover:border-hueso/50"
          >
            Explorar el modo de uso
            <ArrowIcon direction="down" />
          </a>
        </div>
      </div>
    </section>
  );
}
