import { requireStoreAccessApi } from "~/lib/storeAccess.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { getUser } from "~/lib/session.server";
import { createSubscriptionCheckoutSession } from "~/lib/stripe.server";
import { getCatalogItemBySku } from "~/lib/catalog.server";
import { getAttribution } from "~/lib/attribution.server";
import { getSubscriptionConfig } from "~/models/subscriptionSettings.server";
import { isOfferedFrequency } from "~/lib/subscriptionConfig";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { getShippingConfig } from "~/models/shipping.server";
import { rememberDeliveryAddress } from "~/lib/addressBook.server";
import { logError } from "~/lib/logger.server";
import { addressToMetadata, outOfZoneMessage, readAddressFields, validateDeliveryAddress } from "~/lib/deliveryAddress";

export async function action({ request }: ActionFunctionArgs) {
  await requireStoreAccessApi(request);
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit(`checkout:${ip}`, { max: 20, windowMs: 10 * 60 * 1000 });
  if (!rateLimit.allowed) {
    return data({ error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 });
  }

  const user = await getUser(request);

  if (!user) {
    const url = new URL(request.url);
    const redirectTo = url.searchParams.get("redirectTo") ?? "/suscripcion";
    return redirect(`/cuenta/entrar?redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  const formData = await request.formData();
  const frequency = formData.get("frequency");
  const config = await getSubscriptionConfig();

  if (typeof frequency !== "string" || !isOfferedFrequency(config, frequency)) {
    return data({ error: "Elige una frecuencia válida." }, { status: 400 });
  }

  const skus = formData.getAll("sku") as string[];
  const quantitiesRaw = formData.getAll("quantity") as string[];
  const requestedRows = skus
    .map((sku, i) => ({ sku, quantity: Number(quantitiesRaw[i] ?? 0) }))
    .filter((r) => r.sku && r.quantity > 0);

  if (requestedRows.length === 0) {
    return data({ error: "Elige al menos un producto para tu caja." }, { status: 400 });
  }

  // Nunca se confía en el precio que venga del formulario — se resuelve cada
  // SKU contra el catálogo real y se descarta cualquiera que ya no exista o
  // que el admin haya marcado como no apto para auto-envío.
  const resolved = await Promise.all(
    requestedRows.map(async (row) => {
      const product = await getCatalogItemBySku(row.sku);
      if (!product || product.kind !== "product" || !product.isSubscribable) return null;
      return { sku: product.sku, name: product.name, quantity: row.quantity, unitPriceMxn: product.priceMxn };
    }),
  );
  const items = resolved.filter((i): i is NonNullable<typeof i> => i !== null);

  if (items.length === 0) {
    return data({ error: "Los productos elegidos ya no están disponibles para auto-envío." }, { status: 400 });
  }

  // La caja siempre llega a domicilio, dentro de la zona de entrega: mismo candado que en una
  // compra normal, revisado aquí en el servidor.
  const { zone } = await getShippingConfig();
  const addressResult = validateDeliveryAddress(readAddressFields(formData), { mode: "home", zone });
  if (!addressResult.ok) {
    return data(
      {
        error: addressResult.outOfZone ? outOfZoneMessage(zone) : "Revisa los datos de entrega marcados en rojo.",
        fieldErrors: addressResult.errors,
      },
      { status: 400 },
    );
  }

  const attribution = await getAttribution(request);

  // Stripe rechaza metadatos de más de 500 caracteres; se avisa claro en vez de un error genérico.
  const subscriptionItemsMetadata = items.map((i) => `${i.sku}:${i.quantity}:${i.unitPriceMxn}`).join(",");
  if (subscriptionItemsMetadata.length > 480) {
    return data({ error: "Tu caja tiene demasiados productos distintos. Quita alguno para continuar." }, { status: 400 });
  }

  const session = await createSubscriptionCheckoutSession({
    frequency,
    // El descuento se toma de la configuración actual, nunca del formulario.
    discountPercent: config.discountPercent,
    items,
    customerEmail: user.email,
    metadata: {
      ...addressToMetadata(addressResult.address),
      userId: String(user._id),
      // Igual que cartSkus en el checkout de una sola compra: el webhook
      // reconstruye la caja exacta a partir de esto al confirmar el pago.
      discountPercent: String(config.discountPercent),
      subscriptionItems: subscriptionItemsMetadata,
      utm_source: attribution?.utm_source ?? "",
      utm_medium: attribution?.utm_medium ?? "",
      utm_campaign: attribution?.utm_campaign ?? "",
    },
  });

  if (!session.url) {
    return data(
      { error: "No se pudo iniciar la suscripción. Intenta de nuevo." },
      { status: 502 },
    );
  }

  // Igual que en una compra normal: la dirección escrita queda guardada en su cuenta (sin pisar la principal).
  try {
    await rememberDeliveryAddress(String(user._id), addressResult.address);
  } catch (error) {
    logError("subscription.save-profile-address", error);
  }

  return redirect(session.url);
}
