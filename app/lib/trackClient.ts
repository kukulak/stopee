/** Ping de evento desde el navegador — nunca bloquea la interacción del usuario. */
export function trackEvent(type: "page_view" | "view_item" | "add_to_cart" | "begin_checkout", sku?: string) {
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, sku }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // El tracking nunca debe romper la experiencia de compra.
  }
}
