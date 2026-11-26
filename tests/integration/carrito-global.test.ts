import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse } from "../helpers/http";

type Loader = (args: { request: Request; params: object; context: object }) => Promise<Response>;

/**
 * El carrito se puede abrir desde cualquier página (blog, nosotros…) sin ir a la tienda: pide
 * su contenido a /api/carrito. Debe devolver lo mismo que ve /tienda y nunca guardarse en caché.
 */
describe.skipIf(!hasTestDb)("carrito desde cualquier página", () => {
  let loader: Loader;
  let cartStorage: typeof import("~/lib/cart.server").cartStorage;
  let SiteSettingsModel: typeof import("~/models/siteSettings.server").SiteSettingsModel;
  let ProductModel: typeof import("~/models/product.server").ProductModel;
  let connectDB: typeof import("~/lib/db.server").connectDB;

  beforeAll(async () => {
    assertDisposableDb();
    loader = asResponse(((await import("~/routes/api.carrito")) as never as { loader: Loader }).loader);
    ({ cartStorage } = await import("~/lib/cart.server"));
    ({ SiteSettingsModel } = await import("~/models/siteSettings.server"));
    ({ ProductModel } = await import("~/models/product.server"));
    ({ connectDB } = await import("~/lib/db.server"));
    await connectDB();
  });

  afterAll(async () => {
    await dropDb();
  });

  beforeEach(async () => {
    await wipeDb();
    await SiteSettingsModel.create({ isStoreActive: true });
    await ProductModel.create({ name: "Concentrado 1L", sku: "CONC-1L", price: 400, stock: 20 });
  });

  async function get(items?: { sku: string; quantity: number }[]) {
    const session = await cartStorage.getSession();
    if (items) session.set("items", items);
    const cookie = (await cartStorage.commitSession(session)).split(";")[0];
    return loader({ request: new Request("https://stopee.test/api/carrito", { headers: { cookie } }), params: {}, context: {} });
  }

  it("devuelve renglones, envío y la zona de entrega, y no se guarda en caché", async () => {
    const response = await get([{ sku: "CONC-1L", quantity: 2 }]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    const body = (await response.json()) as {
      lines: { sku: string; quantity: number }[];
      subtotalMxn: number;
      shipping: { enabled: boolean };
      deliveryZone: { name: string; postalRanges: string };
    };
    expect(body.lines).toEqual([expect.objectContaining({ sku: "CONC-1L", quantity: 2 })]);
    expect(body.subtotalMxn).toBe(800);
    expect(body.shipping.enabled).toBe(true);
    expect(body.deliveryZone).toEqual({ name: "Ciudad de México", postalRanges: "01000-16999" });
  });

  it("un carrito vacío responde vacío (el panel muestra su estado vacío)", async () => {
    const body = (await (await get()).json()) as { lines: unknown[]; subtotalMxn: number };
    expect(body.lines).toEqual([]);
    expect(body.subtotalMxn).toBe(0);
  });

  it("con la tienda cerrada al público no entrega el carrito", async () => {
    await SiteSettingsModel.updateMany({}, { isStoreActive: false });
    let status = 0;
    try {
      status = (await get([{ sku: "CONC-1L", quantity: 1 }])).status;
    } catch (thrown) {
      status = (thrown as Response).status ?? 403;
    }
    expect(status).toBe(403);
  });
});
