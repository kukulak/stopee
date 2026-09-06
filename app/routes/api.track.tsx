import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getOrCreateVisitorId, logEvent, type TrackableEvent } from "~/lib/tracking.server";

const VALID_TYPES: TrackableEvent[] = ["page_view", "view_item", "add_to_cart", "begin_checkout"];

/**
 * Resource route: recibe pings de eventos del front (fetch con keepalive)
 * para poder calcular el embudo de conversión con datos reales.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { visitorId, setCookieHeader } = await getOrCreateVisitorId(request);

  let body: { type?: string; sku?: string } = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false }, { status: 400 });
  }

  if (!body.type || !VALID_TYPES.includes(body.type as TrackableEvent)) {
    return json({ ok: false }, { status: 400 });
  }

  await logEvent(visitorId, body.type as TrackableEvent, body.sku);

  return json(
    { ok: true },
    setCookieHeader ? { headers: { "Set-Cookie": setCookieHeader } } : undefined,
  );
}
