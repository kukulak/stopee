import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { CONSENT_VERSION, choicesFromForm, type ConsentChoice } from "~/lib/consent";
import { buildConsentCookie, expireAnalyticsCookies, readConsent } from "~/lib/consent.server";
import { connectDB } from "~/lib/db.server";
import { logError } from "~/lib/logger.server";
import { checkRateLimit, getClientIp } from "~/lib/rateLimit.server";
import { ConsentLogModel } from "~/models/consentLog.server";

/**
 * Guarda la elección de cookies del visitante (botones del aviso y del panel «Configurar cookies»).
 * La respuesta lleva la cookie con la elección; si se rechazan las estadísticas, también manda a
 * borrar las cookies propias de medición que el navegador ya tuviera.
 *
 * El origen de la petición lo verifica server.js para todo envío, así que otro sitio no puede
 * fabricar un «acepto» en nombre de un visitante.
 */
export async function action({ request }: ActionFunctionArgs) {
  const rateLimit = await checkRateLimit(`consent:${getClientIp(request)}`, { max: 30, windowMs: 60 * 1000 });
  if (!rateLimit.allowed) return data({ ok: false as const }, { status: 429 });

  const form = await request.formData();
  const choices = choicesFromForm(form.get("choice"), form.get("analytics"), form.get("marketing"));
  if (!choices) return data({ ok: false as const }, { status: 400 });

  const previous = await readConsent(request);
  const { state, setCookie } = await buildConsentCookie(choices, previous);

  const headers = new Headers();
  headers.append("Set-Cookie", setCookie);
  if (!choices.analytics) {
    for (const expired of expireAnalyticsCookies(request)) headers.append("Set-Cookie", expired);
  }

  // La prueba de consentimiento no debe impedir que la elección se guarde.
  try {
    await connectDB();
    const path = String(form.get("path") ?? "");
    await ConsentLogModel.create({
      consentId: state.id,
      version: CONSENT_VERSION,
      ...choices,
      choice: form.get("choice") as ConsentChoice,
      path: path.startsWith("/") ? path.split(/[?#]/)[0].slice(0, 200) : "",
    });
  } catch (error) {
    logError("consent.log", error);
  }

  return data({ ok: true as const, ...choices }, { headers });
}
