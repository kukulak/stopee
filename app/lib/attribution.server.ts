import { createCookie } from "@remix-run/node";

export type Attribution = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
};

const attributionCookie = createCookie("__stopee_attribution", {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 90, // 90 días: suficiente para atribuir compras que tardan en decidirse
});

/**
 * Atribución a primer toque: si el visitante ya trae una cookie de
 * atribución, se conserva (fue el anuncio/canal que originalmente lo trajo);
 * solo se sobrescribe cuando llega con utm_source nuevo y no tenía ninguna.
 * Devuelve la atribución vigente y, si hay que grabarla, el header Set-Cookie.
 */
/** Solo se infiere en páginas donde tiene sentido registrar una sesión de prospecto. */
export function isAttributableEntryPoint(pathname: string) {
  return pathname === "/" || pathname === "/tienda" || pathname.startsWith("/blog");
}

export async function readOrCaptureAttribution(
  request: Request,
): Promise<{ attribution: Attribution | null; setCookieHeader: string | null }> {
  const url = new URL(request.url);
  const existing = ((await attributionCookie.parse(
    request.headers.get("Cookie"),
  )) as Attribution | null) ?? null;

  if (existing || !isAttributableEntryPoint(url.pathname)) {
    return { attribution: existing, setCookieHeader: null };
  }

  const utmSource = url.searchParams.get("utm_source");
  let attribution: Attribution | null = null;

  if (utmSource) {
    attribution = {
      utm_source: utmSource,
      utm_medium: url.searchParams.get("utm_medium") ?? "",
      utm_campaign: url.searchParams.get("utm_campaign") ?? "",
    };
  } else {
    // Sin parámetros de campaña: se infiere el canal por el referrer y la
    // página de entrada, en vez de dejarlo todo como "directo".
    const referer = request.headers.get("Referer") ?? "";
    let refererHost = "";
    try {
      refererHost = referer ? new URL(referer).host : "";
    } catch {
      refererHost = "";
    }

    if (refererHost.includes("google.")) {
      attribution = { utm_source: "google", utm_medium: "organic", utm_campaign: "" };
    } else if (refererHost.includes("facebook.") || refererHost.includes("instagram.")) {
      attribution = { utm_source: "meta_ads", utm_medium: "social", utm_campaign: "" };
    } else if (url.pathname.startsWith("/blog")) {
      attribution = { utm_source: "blog", utm_medium: "organic", utm_campaign: "" };
    } else {
      attribution = { utm_source: "direct", utm_medium: "none", utm_campaign: "" };
    }
  }

  return { attribution, setCookieHeader: await attributionCookie.serialize(attribution) };
}

export async function getAttribution(request: Request): Promise<Attribution | null> {
  return ((await attributionCookie.parse(request.headers.get("Cookie"))) as Attribution | null) ?? null;
}
