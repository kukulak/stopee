import { createCookie } from "react-router";
import { randomUUID } from "node:crypto";
import { connectDB } from "~/lib/db.server";
import { AnalyticsEventModel } from "~/models/analyticsEvent.server";

const visitorCookie = createCookie("__stopee_vid", {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 180,
});

/** Devuelve el id de visitante existente, o uno nuevo junto con su Set-Cookie. */
export async function getOrCreateVisitorId(
  request: Request,
): Promise<{ visitorId: string; setCookieHeader: string | null }> {
  const existing = (await visitorCookie.parse(request.headers.get("Cookie"))) as string | null;
  if (existing) return { visitorId: existing, setCookieHeader: null };
  const visitorId = randomUUID();
  return { visitorId, setCookieHeader: await visitorCookie.serialize(visitorId) };
}

export type TrackableEvent = "page_view" | "view_item" | "add_to_cart" | "begin_checkout" | "banner_click";

/** Cuánto se conservan los eventos (guardan correos de personas con sesión iniciada). */
const EVENT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
let lastPruneAt = 0;

/**
 * Borra los eventos que ya pasaron su plazo. Se ejecuta como máximo una vez por
 * hora por proceso, colgado de la escritura de un evento, en vez de un índice
 * TTL: así funciona igual en bases que ya tenían ese índice sin expiración.
 */
async function pruneOldEvents() {
  const now = Date.now();
  if (now - lastPruneAt < 60 * 60 * 1000) return;
  lastPruneAt = now;
  await AnalyticsEventModel.deleteMany({ createdAt: { $lt: new Date(now - EVENT_RETENTION_MS) } });
}

export async function logEvent(
  sessionId: string,
  type: TrackableEvent,
  sku?: string,
  identity?: { userId?: string; email?: string },
) {
  await connectDB();
  await AnalyticsEventModel.create({
    sessionId,
    type,
    sku,
    userId: identity?.userId || undefined,
    email: identity?.email || undefined,
  });
  // La limpieza nunca debe hacer fallar ni retrasar el registro del evento.
  void pruneOldEvents().catch(() => {});
}
