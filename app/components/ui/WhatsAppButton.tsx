import { useLocation } from "react-router";

const HIDDEN_PREFIXES = ["/admin", "/cuenta"];

/** Botón flotante de WhatsApp — visible en todo el sitio público, oculto en admin/cuenta (nadie necesita "chatear con soporte" mientras administra la tienda). */
export function WhatsAppButton({
  whatsappNumber,
  raised,
  cartHasItems,
}: {
  whatsappNumber: string;
  /** true mientras la tienda esté en modo pre-lanzamiento: esa landing (única en "/") tiene su propia barra fija de CTA en mobile que este botón, si no, tapa. */
  raised: boolean;
  /** /tienda también tiene su propia barra fija en mobile, pero solo aparece con algo en el carrito. */
  cartHasItems: boolean;
}) {
  const { pathname } = useLocation();
  if (!whatsappNumber) return null;
  if (HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

  const needsRaisedOffset = (raised && pathname === "/") || (cartHasItems && pathname === "/tienda");

  return (
    <a
      href={`https://wa.me/${whatsappNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Escríbenos por WhatsApp"
      className={`fixed right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105 ${
        needsRaisedOffset ? "bottom-24 sm:bottom-5" : "bottom-5"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2Zm5.8 14.07c-.24.68-1.4 1.3-1.93 1.38-.5.08-1.12.11-1.8-.11-.42-.13-.95-.3-1.63-.6-2.87-1.24-4.74-4.14-4.88-4.33-.14-.19-1.17-1.55-1.17-2.96 0-1.4.74-2.09 1-2.38.26-.28.57-.35.76-.35.19 0 .38 0 .55.01.18.01.42-.07.65.5.24.58.82 2 .89 2.14.07.15.12.32.02.51-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.28-.12.56.16.28.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.22 1.37.28.14.44.12.6-.07.16-.19.68-.79.86-1.06.18-.28.36-.23.6-.14.24.09 1.54.73 1.81.86.27.14.44.2.51.31.07.12.07.66-.17 1.34Z" />
      </svg>
    </a>
  );
}
