import { createCookie } from "react-router";
import { randomUUID } from "node:crypto";
import {
  CONSENT_COOKIE_NAME,
  CONSENT_MAX_AGE_SECONDS,
  parseStoredConsent,
  toStoredConsent,
  type ConsentChoices,
  type ConsentState,
} from "~/lib/consent";
import { ATTRIBUTION_COOKIE_NAME } from "~/lib/attribution.server";
import { VISITOR_COOKIE_NAME } from "~/lib/tracking.server";

const consentCookie = createCookie(CONSENT_COOKIE_NAME, {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: CONSENT_MAX_AGE_SECONDS,
});

/** La elección vigente del visitante, o null si nunca eligió (o si cambió la versión del aviso). */
export async function readConsent(request: Request): Promise<ConsentState | null> {
  try {
    return parseStoredConsent(await consentCookie.parse(request.headers.get("Cookie")));
  } catch {
    return null;
  }
}

/** Nueva elección: conserva el identificador anterior para que el historial de una persona quede junto. */
export async function buildConsentCookie(
  choices: ConsentChoices,
  previous: ConsentState | null,
): Promise<{ state: ConsentState; setCookie: string }> {
  const id = previous?.id ?? randomUUID();
  const decidedAt = new Date();
  const setCookie = await consentCookie.serialize(toStoredConsent({ id, ...choices, decidedAt }));
  return { state: { id, ...choices, decidedAt: decidedAt.toISOString() }, setCookie };
}

/**
 * Cookies propias de estadísticas que, sin permiso, no deben existir: si el navegador ya las trae
 * (de antes de que hubiera aviso, o porque se retiró el permiso), se mandan a borrar.
 */
export function expireAnalyticsCookies(request: Request): string[] {
  const header = request.headers.get("Cookie") ?? "";
  const present = new Set(header.split(";").map((part) => part.split("=")[0].trim()));
  return [VISITOR_COOKIE_NAME, ATTRIBUTION_COOKIE_NAME]
    .filter((name) => present.has(name))
    .map(
      (name) =>
        `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${
          process.env.NODE_ENV === "production" ? "; Secure" : ""
        }`,
    );
}
