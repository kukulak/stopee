import { isValidGooglePixelId, isValidMetaPixelId, isValidTikTokPixelId } from "~/lib/inputValidation";
import type { ConsentChoices } from "~/lib/consent";

/**
 * Herramientas de terceros que miden visitas o anuncios (Google, Meta, TikTok…). Es el ÚNICO lugar
 * donde se declara cada una; de aquí salen:
 *  - los campos de /admin/settings (y su validación),
 *  - los dominios que la política de seguridad del sitio deja abrir (solo los de las herramientas
 *    que tienen ID configurado),
 *  - la categoría de cookies que pide permiso (estadísticas o marketing),
 *  - las filas de la política de cookies y las líneas de transferencias del aviso de privacidad.
 *
 * Para sumar una herramienta nueva (por ejemplo otro píxel de anuncios): agrega su id a
 * INTEGRATION_IDS, una entrada en INTEGRATIONS, su campo en SiteSettings y su cargador en
 * ~/lib/consentTags.ts (TAG_LOADERS; el compilador avisa si falta). Y si ya hay visitantes con una
 * elección guardada, sube CONSENT_VERSION en ~/lib/consent.ts para volver a preguntarles.
 *
 * La lista de dominios NO se edita desde el panel a propósito: es lo que impide que, si alguien
 * llegara a inyectar código o a entrar al panel, pueda mandar datos a un sitio ajeno.
 */
export const INTEGRATION_IDS = ["google", "meta", "tiktok"] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export type ConsentCategory = keyof ConsentChoices;

/** IDs ya validados de las herramientas que están configuradas. Lo que no está configurado no aparece. */
export type PixelIds = Partial<Record<IntegrationId, string>>;

export type IntegrationCookie = { name: string; purpose: string; duration: string };

export type Integration = {
  id: IntegrationId;
  /** Cómo se nombra en pantalla («Google Analytics»). */
  name: string;
  /** Quién la opera, para el aviso de privacidad y la tabla de cookies. */
  owner: string;
  category: ConsentCategory;
  /** Campo de SiteSettings donde se guarda el ID. */
  settingsField: "googlePixelId" | "metaPixelId" | "tiktokPixelId";
  fieldLabel: string;
  placeholder: string;
  invalidMessage: string;
  isValidId: (value: string) => boolean;
  /** Dominios que el navegador debe dejar abrir: scripts y conexiones (envío de eventos). */
  csp: { script: string[]; connect: string[] };
  cookies: IntegrationCookie[];
  /** Línea del aviso de privacidad, en la lista de transferencias. */
  transferLine: string;
  /** Enlace a la política de cookies del proveedor, para la política de cookies. */
  providerPolicy: { label: string; url: string };
};

export const INTEGRATIONS: readonly Integration[] = [
  {
    id: "google",
    name: "Google Analytics",
    owner: "Google",
    category: "analytics",
    settingsField: "googlePixelId",
    fieldLabel: "Google Pixel ID (GA4 / GTM)",
    placeholder: "G-XXXXXXXXXX",
    invalidMessage: 'El ID de Google no es válido. Debe verse como "G-XXXXXXXXXX".',
    isValidId: isValidGooglePixelId,
    csp: {
      script: ["https://www.googletagmanager.com"],
      connect: [
        "https://www.google-analytics.com",
        "https://*.google-analytics.com",
        "https://*.analytics.google.com",
        "https://www.googletagmanager.com",
      ],
    },
    cookies: [
      {
        name: "`_ga` y `_ga_*`",
        purpose: "Google Analytics: distingue visitantes y sesiones para generar estadísticas",
        duration: "Hasta 2 años",
      },
    ],
    transferLine:
      "- **Google LLC** — estadísticas de uso del sitio (Google Analytics), únicamente si aceptas las cookies de estadísticas.",
    providerPolicy: { label: "cómo usa Google las cookies", url: "https://policies.google.com/technologies/cookies" },
  },
  {
    id: "meta",
    name: "el píxel de Meta",
    owner: "Meta",
    category: "marketing",
    settingsField: "metaPixelId",
    fieldLabel: "Meta Pixel ID",
    placeholder: "123456789012345",
    invalidMessage: "El ID del píxel de Meta no es válido: son solo números (de 8 a 20 dígitos).",
    isValidId: isValidMetaPixelId,
    csp: { script: ["https://connect.facebook.net"], connect: ["https://www.facebook.com"] },
    cookies: [
      {
        name: "`_fbp`",
        purpose: "Píxel de Meta: identifica el navegador para medir el resultado de nuestros anuncios",
        duration: "Hasta 90 días",
      },
      {
        name: "`_fbc`",
        purpose: "Píxel de Meta: guarda de qué anuncio venías, si llegaste desde uno",
        duration: "Hasta 90 días",
      },
    ],
    transferLine:
      "- **Meta Platforms, Inc.** — medición de anuncios en Facebook e Instagram, únicamente si aceptas las cookies de marketing.",
    providerPolicy: { label: "política de cookies de Meta", url: "https://www.facebook.com/privacy/policies/cookies/" },
  },
  {
    id: "tiktok",
    name: "el píxel de TikTok",
    owner: "TikTok",
    category: "marketing",
    settingsField: "tiktokPixelId",
    fieldLabel: "TikTok Pixel ID",
    placeholder: "C4ABCDEFGHIJ1234567",
    invalidMessage: "El ID del píxel de TikTok no es válido: son letras mayúsculas y números, sin espacios.",
    isValidId: isValidTikTokPixelId,
    csp: {
      script: ["https://analytics.tiktok.com"],
      connect: ["https://analytics.tiktok.com", "https://analytics-ipv6.tiktokw.us"],
    },
    cookies: [
      {
        name: "`_ttp` y otras `_tt_*`",
        purpose: "Píxel de TikTok: identifica el navegador para medir el resultado de nuestros anuncios en TikTok",
        duration: "Hasta 13 meses",
      },
    ],
    transferLine:
      "- **TikTok** — medición de anuncios en TikTok, únicamente si aceptas las cookies de marketing.",
    providerPolicy: { label: "política de cookies de TikTok", url: "https://www.tiktok.com/legal/page/global/cookie-policy/en" },
  },
];

/** Los IDs guardados en la configuración que tienen el formato correcto; los vacíos o inválidos se ignoran. */
export function configuredPixelIds(settings: Partial<Record<Integration["settingsField"], string | null | undefined>>): PixelIds {
  const ids: PixelIds = {};
  for (const integration of INTEGRATIONS) {
    const value = settings[integration.settingsField] ?? "";
    if (value && integration.isValidId(value)) ids[integration.id] = value;
  }
  return ids;
}

/** Herramientas de una categoría; con `ids`, solo las que están configuradas. */
export function integrationsIn(category: ConsentCategory, ids?: PixelIds): Integration[] {
  return INTEGRATIONS.filter((integration) => integration.category === category && (!ids || ids[integration.id]));
}

/** Dominios que la política de seguridad debe permitir: solo los de las herramientas configuradas. */
export function cspDomainsFor(ids: PixelIds): { script: string[]; connect: string[] } {
  const script = new Set<string>();
  const connect = new Set<string>();
  for (const integration of INTEGRATIONS) {
    if (!ids[integration.id]) continue;
    integration.csp.script.forEach((domain) => script.add(domain));
    integration.csp.connect.forEach((domain) => connect.add(domain));
  }
  return { script: [...script], connect: [...connect] };
}

/** Filas de la tabla de cookies (markdown) de las herramientas de una categoría. */
export function cookieTableRows(category: ConsentCategory): string {
  return integrationsIn(category)
    .flatMap((integration) =>
      integration.cookies.map((cookie) => `| ${cookie.name} | ${cookie.purpose} | ${cookie.duration} | ${integration.owner} |`),
    )
    .join("\n");
}

/** Líneas de transferencias del aviso de privacidad (una por herramienta). */
export function transferLines(): string {
  return INTEGRATIONS.map((integration) => integration.transferLine).join("\n");
}

/** Enlaces a las políticas de cookies de cada proveedor. */
export function providerPolicyLines(): string {
  return INTEGRATIONS.map(
    (integration) => `- ${integration.owner}: [${integration.providerPolicy.label}](${integration.providerPolicy.url}).`,
  ).join("\n");
}

/** «Google Analytics y el píxel de Meta»: nombres para el texto del panel de cookies. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}
