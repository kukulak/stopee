import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { getUser } from "~/lib/session.server";
import { createSubscriptionCheckoutSession } from "~/lib/stripe.server";
import { getAttribution } from "~/lib/attribution.server";
import {
  SUBSCRIPTION_FREQUENCIES,
  type SubscriptionFrequency,
} from "~/data/subscriptionFrequencies";

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);

  if (!user) {
    const url = new URL(request.url);
    const redirectTo = url.searchParams.get("redirectTo") ?? "/tienda#suscripcion";
    return redirect(`/cuenta/entrar?redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  const formData = await request.formData();
  const frequency = formData.get("frequency");

  if (typeof frequency !== "string" || !(frequency in SUBSCRIPTION_FREQUENCIES)) {
    return json({ error: "Elige una frecuencia válida." }, { status: 400 });
  }

  const attribution = await getAttribution(request);

  const session = await createSubscriptionCheckoutSession({
    frequency: frequency as SubscriptionFrequency,
    customerEmail: user.email,
    metadata: {
      userId: String(user._id),
      utm_source: attribution?.utm_source ?? "",
      utm_medium: attribution?.utm_medium ?? "",
      utm_campaign: attribution?.utm_campaign ?? "",
    },
  });

  if (!session.url) {
    return json(
      { error: "No se pudo iniciar la suscripción. Intenta de nuevo." },
      { status: 502 },
    );
  }

  return redirect(session.url);
}
