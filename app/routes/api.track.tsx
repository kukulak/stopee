import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getOrCreateVisitorId, logEvent, type TrackableEvent } from "~/lib/tracking.server";
import { getUser } from "~/lib/session.server";
import { checkRateLimit, getClientIp } from "~/lib/rateLimit.server";

const VALID_TYPES: TrackableEvent[] = ["page_view", "view_item", "add_to_cart", "begin_checkout", "banner_click"];

/**
 * Resource route: recibe pings de eventos del front (fetch con keepalive)
 * para poder calcular el embudo de conversión con datos reales.
 */
export async function action({ request }: ActionFunctionArgs) {
  // Límite generoso (un visitante real navegando genera varios eventos por
  // minuto) — solo para frenar un flood automatizado, no fallar en silencio
  // no importa aquí (no es una acción que el usuario esté esperando ver).
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`track:${ip}`, { max: 120, windowMs: 60 * 1000 });
  if (!rateLimit.allowed) {
    return json({ ok: false }, { status: 429 });
  }

  const { visitorId, setCookieHeader } = await getOrCreateVisitorId(request);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false }, { status: 400 });
  }

  // Nada de lo que llega aquí es confiable: se exige el tipo exacto de cada
  // campo y se limita el largo (un objeto o un texto enorme en `sku` rompía el
  // registro o llenaba la base).
  const body = (raw && typeof raw === "object" ? raw : {}) as { type?: unknown; sku?: unknown };
  if (typeof body.type !== "string" || !VALID_TYPES.includes(body.type as TrackableEvent)) {
    return json({ ok: false }, { status: 400 });
  }
  const sku = typeof body.sku === "string" && body.sku.length <= 100 ? body.sku : undefined;

  const user = await getUser(request);
  await logEvent(
    visitorId,
    body.type as TrackableEvent,
    sku,
    user ? { userId: String(user._id), email: user.email } : undefined,
  );

  return json(
    { ok: true },
    setCookieHeader ? { headers: { "Set-Cookie": setCookieHeader } } : undefined,
  );
}
