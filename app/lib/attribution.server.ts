import { createCookie } from "@remix-run/node";

export type Attribution = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
};

/**
 * Los valores utm_* vienen de la URL y la cookie no está firmada, así que se
 * recortan: Stripe rechaza metadatos de más de 500 caracteres (un utm_campaign
 * larguísimo haría fallar el pago de ese visitante) y no deben guardarse
 * textos arbitrarios en los pedidos.
 */
function cleanUtm(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100) : "";
}

function cleanAttribution(raw: Partial<Attribution> | null): Attribution | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    utm_source: cleanUtm(raw.utm_source),
    utm_medium: cleanUtm(raw.utm_medium),
    utm_campaign: cleanUtm(raw.utm_campaign),
  };
}

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
  const existing = cleanAttribution(await attributionCookie.parse(request.headers.get("Cookie")));

  if (existing || !isAttributableEntryPoint(url.pathname)) {
    return { attribution: existing, setCookieHeader: null };
  }

  const utmSource = url.searchParams.get("utm_source");
  let attribution: Attribution | null = null;

  if (cleanUtm(utmSource)) {
    attribution = cleanAttribution({
      utm_source: utmSource ?? "",
      utm_medium: url.searchParams.get("utm_medium") ?? "",
      utm_campaign: url.searchParams.get("utm_campaign") ?? "",
    });
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
  return cleanAttribution(await attributionCookie.parse(request.headers.get("Cookie")));
}
