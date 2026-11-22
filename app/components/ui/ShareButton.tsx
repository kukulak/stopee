import { useState } from "react";

/** Botón "Compartir" — usa la Web Share API nativa si el navegador la soporta (móvil, la mayoría de casos reales); si no, copia el link al portapapeles. */
export function ShareButton({ title, url, className = "" }: { title: string; url: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // El usuario canceló el diálogo nativo — no es un error real.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles: no hay mucho más que hacer sin backend propio.
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border border-carbon/15 px-5 text-sm font-semibold text-carbon hover:border-carbon/30 ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8.6 10.6l6.8-3.9M8.6 13.4l6.8 3.9" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      {copied ? "¡Link copiado!" : "Compartir"}
    </button>
  );
}
