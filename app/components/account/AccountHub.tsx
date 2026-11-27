import { Link } from "react-router";
import { ChevronIcon } from "~/components/ui/Icons";

/**
 * Las secciones de Mi cuenta. Cada cuadro del tablero abre una (`/cuenta?seccion=pedidos`), en la misma página:
 * el botón Atrás vuelve al tablero y los correos pueden enlazar directo a una sección.
 */
export const ACCOUNT_SECTIONS = ["pedidos", "auto-envio", "perfil", "direcciones", "facturacion", "correos", "punto", "eliminar"] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

/** Lee la sección de la dirección; lo desconocido (o «punto» sin ser aliado) vuelve al tablero. */
export function parseAccountSection(value: string | null, { hasPoint }: { hasPoint: boolean }): AccountSection | null {
  const section = ACCOUNT_SECTIONS.find((s) => s === value);
  if (!section) return null;
  if (section === "punto" && !hasPoint) return null;
  return section;
}

export const sectionHref = (section: AccountSection) => `/cuenta?seccion=${section}`;

/** Un cuadro del tablero: ícono, nombre y una línea que dice cómo está eso hoy, sin tener que abrirlo. */
export function AccountTile({
  section,
  icon,
  title,
  summary,
  badge,
  badgeTone = "info",
}: {
  section: AccountSection;
  icon: React.ReactNode;
  title: string;
  summary: string;
  /** Aviso corto cuando algo pide atención (un pedido en camino, un pago pendiente). */
  badge?: string | null;
  badgeTone?: "info" | "warning";
}) {
  return (
    <Link
      to={sectionHref(section)}
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
        <p className="mt-0.5 text-sm text-carbon/60">{summary}</p>
      </div>
    </Link>
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
