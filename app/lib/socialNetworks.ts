/**
 * Catálogo de redes sociales reconocidas. El admin solo pega el link del
 * perfil en /admin/negocio; la red (y su ícono) se deduce del dominio, así no
 * hay que elegir nada de una lista ni cambiar código por cada red nueva.
 *
 * Para darle ícono propio a una red nueva (ej. Mastodon): agrega una entrada
 * aquí con sus dominios y su dibujo en components/ui/SocialIcon.tsx. Mientras
 * tanto, cualquier link de una red desconocida se muestra con un ícono de
 * enlace y el nombre de su dominio — nunca se rompe ni se oculta.
 *
 * Sin sufijo ".server": lo usan tanto el root loader como la vista previa en
 * vivo del formulario del admin.
 */
export type SocialNetwork = { id: string; name: string; domains: string[] };

export const SOCIAL_NETWORKS: SocialNetwork[] = [
  { id: "instagram", name: "Instagram", domains: ["instagram.com"] },
  { id: "tiktok", name: "TikTok", domains: ["tiktok.com"] },
  { id: "facebook", name: "Facebook", domains: ["facebook.com", "fb.com", "fb.me"] },
  { id: "youtube", name: "YouTube", domains: ["youtube.com", "youtu.be"] },
  { id: "x", name: "X", domains: ["x.com", "twitter.com"] },
  { id: "linkedin", name: "LinkedIn", domains: ["linkedin.com"] },
  { id: "discord", name: "Discord", domains: ["discord.com", "discord.gg", "discordapp.com"] },
  { id: "telegram", name: "Telegram", domains: ["t.me", "telegram.me", "telegram.org"] },
  { id: "twitch", name: "Twitch", domains: ["twitch.tv"] },
  { id: "whatsapp", name: "WhatsApp", domains: ["wa.me", "whatsapp.com"] },
];

/** Acepta "instagram.com/stopee" sin https:// y lo normaliza; null si no es un link web válido. */
export function normalizeSocialUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Deduce la red a partir del link; las desconocidas caen en el ícono genérico "link". */
export function detectNetwork(url: string): { id: string; name: string } {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { id: "link", name: url };
  }
  const known = SOCIAL_NETWORKS.find((n) =>
    n.domains.some((d) => host === d || host.endsWith(`.${d}`)),
  );
  return known ? { id: known.id, name: known.name } : { id: "link", name: host };
}
