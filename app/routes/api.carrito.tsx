import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { requireStoreAccessApi } from "~/lib/storeAccess.server";
import { getUser } from "~/lib/session.server";
import { getCatalogItems } from "~/lib/catalog.server";
import { getShippingConfig } from "~/models/shipping.server";
import { buildCartView } from "~/lib/cartView.server";

/**
 * El carrito completo (renglones, descuentos, envío) para dibujarlo en cualquier
 * página: así, quien está leyendo el blog puede abrir su carrito, revisarlo y
 * seguir leyendo, sin que lo mande a la tienda. Es el mismo cálculo que usa
 * /tienda, y depende de la cookie de cada visitante, por eso nunca se guarda en caché.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireStoreAccessApi(request);
  const [user, catalogItems, shippingConfig] = await Promise.all([
    getUser(request),
    getCatalogItems(),
    getShippingConfig(),
  ]);
  const view = await buildCartView(request, { user, catalogItems, shippingConfig });
  return data(view, { headers: { "Cache-Control": "private, no-store" } });
}
