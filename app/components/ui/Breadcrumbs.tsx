import { Link } from "@remix-run/react";

export type BreadcrumbItem = { label: string; href?: string };

/** Migas de pan visuales — el JSON-LD (schema.org/BreadcrumbList) va aparte, ver app/lib/seo.ts. */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Migas de pan" className="text-sm text-carbon/50">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => (
          <li key={index} className="flex items-center gap-1.5">
            {index > 0 && <span aria-hidden="true">/</span>}
            {item.href ? (
              <Link to={item.href} className="hover:text-carbon hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className="text-carbon" aria-current="page">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
