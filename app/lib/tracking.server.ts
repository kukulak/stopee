import { createCookie } from "@remix-run/node";
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
}
