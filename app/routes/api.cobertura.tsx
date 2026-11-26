import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { connectDB } from "~/lib/db.server";
import { CoverageRequestModel } from "~/models/coverageRequest.server";
import { getShippingConfig } from "~/models/shipping.server";
import { normalizePostalCode, isPostalCodeInZone } from "~/lib/deliveryZone";
import { cleanPlainText } from "~/lib/formGuard.server";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";

const emailSchema = z.string().email().max(254);

/**
 * "Avísame cuando lleguen a mi zona": guarda el correo y el código postal de
 * quien quiso comprar desde fuera de la zona de entrega. Es un recurso público,
 * así que lleva límite por IP y no revela nada de lo que ya hay guardado.
 */
export async function action({ request }: ActionFunctionArgs) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit(`cobertura:${ip}`, { max: 10, windowMs: 10 * 60 * 1000 });
  if (!rateLimit.allowed) {
    return data({ ok: false as const, error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 });
  }

  const formData = await request.formData();
  const email = cleanPlainText(formData.get("email")).toLowerCase();
  const postalCode = normalizePostalCode(cleanPlainText(formData.get("postalCode")));

  if (!emailSchema.safeParse(email).success) {
    return data({ ok: false as const, error: "Escribe un correo válido para avisarte." }, { status: 400 });
  }
  if (!postalCode) {
    return data({ ok: false as const, error: "Escribe tu código postal de 5 dígitos." }, { status: 400 });
  }

  // Quien ya está dentro de la zona no debe terminar en esta lista por error.
  const { zone } = await getShippingConfig();
  if (isPostalCodeInZone(postalCode, zone)) {
    return data({ ok: false as const, error: `Ese código postal sí está en ${zone.name}: ya puedes comprar.` }, { status: 400 });
  }

  await connectDB();
  await CoverageRequestModel.updateOne({ email, postalCode }, { $setOnInsert: { email, postalCode } }, { upsert: true });
  return data({ ok: true as const });
}
