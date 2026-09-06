import { Link } from "@remix-run/react";

export function PromoBanner({
  text,
  ctaText,
  ctaHref,
}: {
  text: string;
  ctaText?: string;
  ctaHref?: string;
}) {
  if (!text) return null;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-bosque via-carbon to-carbon px-6 py-5 text-hueso sm:px-8 sm:py-6">
      <div className="relative flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <p className="font-display text-lg font-bold leading-snug sm:text-xl">{text}</p>
        {ctaText && ctaHref && (
          <Link
            to={ctaHref}
            className="min-h-11 shrink-0 rounded-full bg-lima px-6 py-2.5 text-sm font-bold text-carbon transition-transform hover:scale-105"
          >
            {ctaText}
          </Link>
        )}
      </div>
    </div>
  );
}
