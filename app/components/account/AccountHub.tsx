import { ArrowIcon, ChevronIcon } from "~/components/ui/Icons";

/**
 * Mi cuenta es UNA sola página: arriba el tablero (fidelidad y cuadros) y debajo todas las secciones. Tocar un
 * cuadro baja hasta su sección (`/cuenta#pedidos`) y cada sección trae «Volver al menú» para subir de nuevo.
 * Nada abre otra pantalla.
 */
export const ACCOUNT_SECTION_IDS = ["punto", "pedidos", "suscripcion", "perritos", "perfil", "direcciones", "facturacion", "eliminar"] as const;
export type AccountSectionId = (typeof ACCOUNT_SECTION_IDS)[number];

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Baja (o sube) a una sección con desplazamiento suave, sin tocar la dirección ni el historial: así «Atrás» sigue
 * saliendo de Mi cuenta y no recorriendo cada salto. Con teclado, el foco queda en la sección a la que llegó.
 */
export function jumpTo(event: React.MouseEvent, id: string) {
  const el = document.getElementById(id);
  if (!el) return; // sin ella, el enlace normal (#id) hace su trabajo
  event.preventDefault();
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

function jumpToTop(event: React.MouseEvent) {
  event.preventDefault();
  window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
}

/** Una sección de la página: el contenido y, debajo, el enlace para subir al menú. `scroll-mt` la deja debajo de la barra fija. */
export function AccountSection({ id, children }: { id: AccountSectionId; children: React.ReactNode }) {
  return (
    <section id={id} tabIndex={-1} className="mt-12 scroll-mt-32 focus:outline-none">
      {children}
      <a
        href="#menu"
        onClick={jumpToTop}
        className="group mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-bosque hover:underline"
      >
        <ArrowIcon direction="up" />
        Volver al menú
      </a>
    </section>
  );
}

/**
 * Un cuadro del tablero: ícono, nombre y una línea que dice cómo está eso hoy, sin tener que abrirlo. Si todavía no hay
 * nada que ver (aún sin pedidos, sin suscripción) se muestra quieto y sin enlace: la persona sabe que existe, pero no la
 * mandamos a una sección vacía.
 */
export function AccountTile({
  section,
  icon,
  title,
  summary,
  badge,
  badgeTone = "info",
}: {
  /** Sección a la que baja. Sin ella, el cuadro es informativo y no se puede tocar. */
  section?: AccountSectionId;
  icon: React.ReactNode;
  title: string;
  summary: string;
  /** Aviso corto cuando algo pide atención (un pedido en camino, un pago pendiente). */
  badge?: string | null;
  badgeTone?: "info" | "warning";
}) {
  if (!section) {
    return (
      <div className="flex min-h-28 flex-col gap-3 rounded-2xl border border-dashed border-carbon/15 bg-carbon/[0.03] p-4">
        <span className="text-carbon/40">{icon}</span>
        <div className="min-w-0">
          <p className="font-display font-bold text-carbon/70">{title}</p>
          <p className="mt-0.5 text-sm text-carbon/60">{summary}</p>
        </div>
      </div>
    );
  }

  return (
    <a
      href={`#${section}`}
      onClick={(event) => jumpTo(event, section)}
      className="group flex min-h-28 flex-col gap-3 rounded-2xl border border-carbon/10 bg-white p-4 transition-colors hover:border-carbon/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oliva"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-carbon">{icon}</span>
        {badge ? (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              badgeTone === "warning" ? "bg-amber-100 text-amber-900" : "bg-lima/40 text-bosque"
            }`}
          >
            {badge}
          </span>
        ) : (
          <ChevronIcon className="h-4 w-4 text-carbon/30 transition-transform group-hover:translate-x-0.5" />
        )}
      </div>
      <div className="min-w-0">
        <p className="font-display font-bold text-carbon">{title}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-carbon/60">{summary}</p>
      </div>
    </a>
  );
}

export function TileGroup({ title, children, columns = "sm:grid-cols-2" }: { title: string; children: React.ReactNode; columns?: string }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-bold text-carbon/60">{title}</h2>
      <div className={`mt-3 grid grid-cols-1 gap-3 ${columns}`}>{children}</div>
    </section>
  );
}

type LoyaltyInfo = {
  count: number;
  required: number;
  nextReward: string;
  pendingReward: unknown | null;
};

/**
 * El programa de fidelidad, siempre a la vista bajo el saludo: es lo que hace volver. Con premio ganado lo anuncia;
 * si no, muestra cuánto falta y qué gana al completarlo.
 */
export function LoyaltyStrip({ loyalty, pendingRewardText }: { loyalty: LoyaltyInfo; pendingRewardText: string | null }) {
  if (pendingRewardText) {
    return (
      <div className="mt-6 rounded-3xl border border-lima/40 bg-lima/25 p-5">
        <p className="text-sm font-bold text-bosque">Programa de fidelidad</p>
        <p className="mt-1 font-display text-lg font-black text-carbon">¡Ya ganaste {pendingRewardText}!</p>
        <p className="mt-1 text-sm text-carbon/70">Se aplica solo en tu próxima compra, al pagar.</p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-3xl border border-lima/30 bg-bosque/5 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-bold text-bosque">Programa de fidelidad</p>
        <p className="text-sm text-carbon/70">
          Llevas <strong className="text-bosque">{loyalty.count} de {loyalty.required}</strong> compras
        </p>
      </div>
      <div className="mt-3 flex gap-1.5" role="img" aria-label={`${loyalty.count} de ${loyalty.required} compras`}>
        {Array.from({ length: loyalty.required }).map((_, i) => (
          <span key={i} className={`h-2 flex-1 rounded-full ${i < loyalty.count ? "bg-lima" : "bg-carbon/10"}`} />
        ))}
      </div>
      <p className="mt-3 text-sm text-carbon/70">
        Con tu compra {loyalty.required} ganas <strong className="text-carbon">{loyalty.nextReward}</strong>.
      </p>
    </div>
  );
}
