/**
 * Sin un servicio externo (Sentry, etc.) de por medio, la única forma real
 * de diagnosticar un error en producción es el log del propio hosting — así
 * que cada error se registra en una sola línea JSON (nivel, hora, de dónde
 * salió, mensaje, stack y contexto de la request) para poder buscarlo/
 * filtrarlo ahí sin tener que adivinar qué generó un `console.error` suelto.
 */
function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  // Remix a veces lanza objetos internos (ErrorResponse, etc.) que no son
  // instancias de Error — sin esto, `String(error)` da "[object Object]" y
  // se pierde toda la información útil.
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

export function logError(context: string, error: unknown, meta?: Record<string, unknown>) {
  const entry = {
    level: "error",
    timestamp: new Date().toISOString(),
    context,
    ...describeError(error),
    ...meta,
  };
  console.error(JSON.stringify(entry));
}

/**
 * Registro de acciones administrativas sensibles (crear cuentas, cambiar roles),
 * en una línea JSON para poder buscarlas en los registros del hosting. Nunca
 * incluir contraseñas ni enlaces.
 */
export function logAudit(action: string, meta: Record<string, unknown>) {
  console.info(JSON.stringify({ level: "info", timestamp: new Date().toISOString(), context: "audit", action, ...meta }));
}

/** Avisos que no son un error pero conviene ver en los registros (por ejemplo, algo que el navegador bloqueó). */
export function logWarn(context: string, meta: Record<string, unknown>) {
  console.warn(JSON.stringify({ level: "warn", timestamp: new Date().toISOString(), context, ...meta }));
}
