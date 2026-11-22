/**
 * Las rutas devuelven lo que pide React Router 7: un objeto (o `data(objeto, { status, headers })`) y,
 * para redirecciones, un `Response`. Las pruebas razonan en términos de respuesta HTTP (código, cabeceras,
 * cookies, cuerpo), así que aquí se convierte lo primero en lo segundo, igual que lo hace el servidor.
 */

type DataWithResponseInit = { type: "DataWithResponseInit"; data: unknown; init: ResponseInit | null };

export function isDataResult(value: unknown): value is DataWithResponseInit {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "DataWithResponseInit";
}

/** Lo que devuelve (o lanza) una ruta -> la Response que vería el navegador. */
export async function toResponse(result: unknown): Promise<Response> {
  if (result instanceof Response) return result;
  if (isDataResult(result)) {
    const headers = new Headers(result.init?.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(result.data), { status: result.init?.status ?? 200, headers });
  }
  return Response.json(result);
}

/** Envuelve el `action` o `loader` de una ruta para que siempre entregue una Response. */
export function asResponse<Args extends unknown[]>(handler: (...args: Args) => unknown | Promise<unknown>) {
  return async (...args: Args): Promise<Response> => toResponse(await handler(...args));
}

/** Para código que puede lanzar una redirección, un 403 o un `data(...)`: devuelve siempre la Response. */
export async function outcomeOf<T>(fn: () => Promise<T>): Promise<T | Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Response) return error;
    if (isDataResult(error)) return toResponse(error);
    throw error;
  }
}
