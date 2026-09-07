import { Link } from "@remix-run/react";

export function PromoBanner({
  text,
  imageUrl,
  ctaText,
  ctaHref,
}: {
  text: string;
  imageUrl?: string | null;
  ctaText?: string;
  ctaHref?: string;
}) {
  if (!text && !imageUrl) return null;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-bosque via-carbon to-carbon text-hueso">
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-60"
        />
      )}
      <div className="relative flex flex-col items-start justify-between gap-4 px-6 py-5 sm:flex-row sm:items-center sm:px-8 sm:py-6">
        {text && <p className="font-display text-lg font-bold leading-snug drop-shadow sm:text-xl">{text}</p>}
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
