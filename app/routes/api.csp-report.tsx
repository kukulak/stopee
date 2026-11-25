import type { ActionFunctionArgs } from "react-router";
import { parseCspReport, shouldLogViolation } from "~/lib/cspReport.server";
import { logWarn } from "~/lib/logger.server";
import { checkRateLimit, getClientIp } from "~/lib/rateLimit.server";

/**
 * Recibe los avisos de la política de seguridad (ver securityHeaders.server.ts). No guarda nada en la
 * base: deja una línea en los registros del hosting (contexto «csp.violation») para enterarse, por
 * ejemplo, de que un píxel nuevo está bloqueado, sin depender de que alguien abra la consola.
 */
export async function action({ request }: ActionFunctionArgs) {
  const done = new Response(null, { status: 204 });

  // Un navegador con un píxel bloqueado puede mandar muchos avisos seguidos.
  if (!checkRateLimit(`csp:${getClientIp(request)}`, { max: 30, windowMs: 60 * 1000 }).allowed) return done;

  let body = "";
  try {
    body = (await request.text()).slice(0, 9000);
  } catch {
    return done;
  }

  const violation = parseCspReport(body);
  if (violation && shouldLogViolation(violation)) {
    logWarn("csp.violation", {
      directive: violation.directive,
      blocked: violation.blocked,
      page: violation.page,
      source: violation.source,
    });
  }
  return done;
}

// Sin pantalla: solo recibe avisos.
export function loader() {
  return new Response(null, { status: 405 });
}
