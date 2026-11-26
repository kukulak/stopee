/**
 * Cualquier dirección que no existe. Existe como ruta (en vez de dejar que el 404 salga sin ninguna) para
 * que el cargador raíz SÍ corra y la página de error sepa si ya hay una sesión iniciada: así una página que
 * no existe y un producto «solo para aliados» muestran exactamente la misma pantalla.
 */
export function loader(): never {
  throw new Response("Página no encontrada", { status: 404 });
}

export default function NotFound() {
  return null;
}
