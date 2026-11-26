import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse, outcomeOf } from "../helpers/http";

type Args = { request: Request; params: Record<string, string>; context: object };
type Handler = (args: Args) => Promise<Response>;

const VALID_ADDRESS: Record<string, string> = {
  shipName: "Ana Pérez",
  shipPhone: "55 1234 5678",
  shipLine1: "Av. Insurgentes Sur 123",
  shipLine2: "Col. Del Valle",
  shipCity: "Benito Juárez",
  shipPostalCode: "03100",
};

/**
 * El bidón de 20 L (y cualquier producto marcado "solo aliados") solo existe para un Punto de Recarga
 * activo con sesión iniciada. Estas pruebas recorren cada puerta por donde un producto llega a alguien:
 * catálogo, tienda, ficha, agregar al carrito, carrito, pago, auto-envío, paquetes y sitemap.
 */
describe.skipIf(!hasTestDb)("productos solo para aliados", () => {
  let catalog: typeof import("~/lib/catalog.server");
  let tiendaLoader: Handler;
  let tiendaAction: Handler;
  let skuLoader: Handler;
  let carritoLoader: Handler;
  let checkout: Handler;
  let subscription: Handler;
  let sitemap: Handler;
  let adminProducts: Handler;
  let adminBundles: Handler;
  let stripe: typeof import("~/lib/stripe.server").stripe;
  let cartStorage: typeof import("~/lib/cart.server").cartStorage;
  let sessionStorage: typeof import("~/lib/session.server").sessionStorage;
  let ProductModel: typeof import("~/models/product.server").ProductModel;
  let UserModel: typeof import("~/models/user.server").UserModel;
  let SiteSettingsModel: typeof import("~/models/siteSettings.server").SiteSettingsModel;
  let featured: typeof import("~/lib/featured.server");
  let createSession: MockInstance;

  beforeAll(async () => {
    assertDisposableDb();
    catalog = await import("~/lib/catalog.server");
    const tienda = (await import("~/routes/tienda")) as never as { loader: Handler; action: Handler };
    tiendaLoader = asResponse(tienda.loader);
    tiendaAction = asResponse(tienda.action);
    skuLoader = asResponse(((await import("~/routes/tienda_.$sku")) as never as { loader: Handler }).loader);
    carritoLoader = asResponse(((await import("~/routes/api.carrito")) as never as { loader: Handler }).loader);
    checkout = asResponse(((await import("~/routes/api.checkout")) as never as { action: Handler }).action);
    subscription = asResponse(((await import("~/routes/api.subscription")) as never as { action: Handler }).action);
    sitemap = asResponse(((await import("~/routes/sitemap[.]xml")) as never as { loader: Handler }).loader);
    adminProducts = ((await import("~/routes/admin.catalog_.products")) as never as { action: Handler }).action;
    adminBundles = ((await import("~/routes/admin.catalog_.bundles")) as never as { action: Handler }).action;
    ({ stripe } = await import("~/lib/stripe.server"));
    ({ cartStorage } = await import("~/lib/cart.server"));
    ({ sessionStorage } = await import("~/lib/session.server"));
    ({ ProductModel } = await import("~/models/product.server"));
    ({ UserModel } = await import("~/models/user.server"));
    ({ SiteSettingsModel } = await import("~/models/siteSettings.server"));
    featured = await import("~/lib/featured.server");
    await (await import("~/lib/db.server")).connectDB();
  });

  afterAll(async () => {
    await dropDb();
  });

  beforeEach(async () => {
    await wipeDb();
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    createSession = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" } as never);
    await SiteSettingsModel.create({ isStoreActive: true });
    await ProductModel.create({ name: "Concentrado 1L", sku: "CONC-1L", price: 399, stock: 20 });
    await ProductModel.create({
      name: "Bidón Concentrado 20L",
      sku: "BIDON-20L",
      price: 3000,
      stock: 10,
      unit: "L",
      unitValue: 20,
      visibility: "ALLY_ONLY",
      isSubscribable: true, // aunque alguien lo marque, nunca debe poder ir en un auto-envío
    });
  });

  // --- Ayudas --------------------------------------------------------------

  let ipCounter = 0;
  const freshIp = () => `172.20.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

  async function makeUser(over: Record<string, unknown> = {}) {
    return UserModel.create({
      email: `u${++ipCounter}@x.com`,
      passwordHash: "x",
      emailVerifiedAt: new Date(),
      ...over,
    });
  }
  const ally = () => makeUser({ isRefillAlly: true, allyStation: { businessName: "Vet", neighborhood: "Roma" } });

  async function cookies(opts: { user?: { _id: unknown }; items?: { sku: string; quantity: number }[] } = {}) {
    const parts: string[] = [];
    if (opts.items) {
      const c = await cartStorage.getSession();
      c.set("items", opts.items);
      parts.push((await cartStorage.commitSession(c)).split(";")[0]);
    }
    if (opts.user) {
      const s = await sessionStorage.getSession();
      s.set("userId", String(opts.user._id));
      s.set("iat", Date.now());
      parts.push((await sessionStorage.commitSession(s)).split(";")[0]);
    }
    return parts.join("; ");
  }

  const get = async (url: string, opts: Parameters<typeof cookies>[0] = {}): Promise<Args> => ({
    request: new Request(url, { headers: { cookie: await cookies(opts), "x-forwarded-for": freshIp() } }),
    params: {},
    context: {},
  });
  const post = async (url: string, fields: Record<string, string | string[]>, opts: Parameters<typeof cookies>[0] = {}): Promise<Args> => {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) for (const value of Array.isArray(v) ? v : [v]) body.append(k, value);
    return {
      request: new Request(url, {
        method: "POST",
        headers: { cookie: await cookies(opts), "x-forwarded-for": freshIp(), origin: new URL(url).origin },
        body,
      }),
      params: {},
      context: {},
    };
  };

  const skusOf = (items: { sku: string }[]) => items.map((i) => i.sku).sort();

  // --- Catálogo ------------------------------------------------------------

  describe("catálogo", () => {
    it("por defecto no incluye el bidón; un aliado sí lo ve", async () => {
      expect(skusOf(await catalog.getCatalogItems())).toEqual(["CONC-1L"]);
      expect(skusOf(await catalog.getCatalogItems({ viewerIsAlly: false }))).toEqual(["CONC-1L"]);
      expect(skusOf(await catalog.getCatalogItems({ viewerIsAlly: true }))).toEqual(["BIDON-20L", "CONC-1L"]);
    });

    it("buscar el bidón por SKU solo funciona para un aliado", async () => {
      expect(await catalog.getCatalogItemBySku("BIDON-20L")).toBeNull();
      const item = await catalog.getCatalogItemBySku("BIDON-20L", { viewerIsAlly: true });
      expect(item).toMatchObject({ sku: "BIDON-20L", visibility: "ALLY_ONLY", priceMxn: 3000 });
    });

    it("el bidón nunca es apto para auto-envío, aunque el producto lo diga", async () => {
      const item = await catalog.getCatalogItemBySku("BIDON-20L", { viewerIsAlly: true });
      expect(item!.isSubscribable).toBe(false);
    });

    it("los productos anteriores al campo (sin 'visibility') siguen siendo públicos", async () => {
      await ProductModel.collection.insertOne({
        name: "Viejo", sku: "VIEJO", price: 10, stock: 5, isAvailable: true, isIndividuallySellable: true,
        createdAt: new Date(), updatedAt: new Date(),
      });
      expect(skusOf(await catalog.getCatalogItems())).toContain("VIEJO");
    });

    it("el panel de administración (includeUnavailable) sí ve todo", async () => {
      expect(skusOf(await catalog.getCatalogItems({ includeUnavailable: true }))).toEqual(["BIDON-20L", "CONC-1L"]);
    });

    it("el precio público del concentrado nunca sale del bidón de aliados", async () => {
      await ProductModel.updateOne({ sku: "CONC-1L" }, { $set: { unit: "L", unitValue: 1 } });
      await ProductModel.updateOne({ sku: "BIDON-20L" }, { $set: { price: 5 } }); // el más barato
      expect((await catalog.getConcentratePrice())?.priceMxn).toBe(399);
    });
  });

  // --- Tienda y ficha ------------------------------------------------------

  describe("tienda", () => {
    const tiendaSkus = async (opts: Parameters<typeof cookies>[0] = {}) =>
      skusOf(((await (await tiendaLoader(await get("https://stopee.test/tienda", opts))).json()) as { catalogItems: { sku: string }[] }).catalogItems);

    it("el bidón aparece solo para un aliado con sesión", async () => {
      expect(await tiendaSkus()).toEqual(["CONC-1L"]);
      expect(await tiendaSkus({ user: await makeUser() })).toEqual(["CONC-1L"]);
      expect(await tiendaSkus({ user: await ally() })).toEqual(["BIDON-20L", "CONC-1L"]);
    });

    it("un aliado desactivado deja de verlo de inmediato, aunque su sesión siga abierta", async () => {
      const user = await ally();
      expect(await tiendaSkus({ user })).toContain("BIDON-20L");
      await UserModel.updateOne({ _id: user._id }, { $set: { isRefillAlly: false } });
      expect(await tiendaSkus({ user })).not.toContain("BIDON-20L");
    });

    it("la ficha del bidón responde 404 a quien no es aliado y 200 a quien sí", async () => {
      const url = "https://stopee.test/tienda/BIDON-20L";
      const asVisitor = { ...(await get(url)), params: { sku: "BIDON-20L" } };
      const hidden = (await outcomeOf(() => skuLoader(asVisitor))) as Response;
      expect(hidden.status).toBe(404);

      const asCustomer = { ...(await get(url, { user: await makeUser() })), params: { sku: "BIDON-20L" } };
      expect(((await outcomeOf(() => skuLoader(asCustomer))) as Response).status).toBe(404);

      const asAlly = { ...(await get(url, { user: await ally() })), params: { sku: "BIDON-20L" } };
      expect((await skuLoader(asAlly)).status).toBe(200);
    });

    it("no se puede agregar al carrito sin ser aliado", async () => {
      const fields = { intent: "add-to-cart", sku: "BIDON-20L", quantity: "1" };
      const denied = await tiendaAction(await post("https://stopee.test/tienda", fields));
      expect(denied.status).toBe(400);
      const customer = await tiendaAction(await post("https://stopee.test/tienda", fields, { user: await makeUser() }));
      expect(customer.status).toBe(400);
      const ok = await tiendaAction(await post("https://stopee.test/tienda", fields, { user: await ally() }));
      expect(ok.status).toBe(200);
    });

    it("tampoco se puede subir la cantidad de un bidón que ya estaba en el carrito sin ser aliado", async () => {
      const fields = { intent: "update-quantity", sku: "BIDON-20L", quantity: "2" };
      const denied = await tiendaAction(await post("https://stopee.test/tienda", fields));
      expect(denied.status).toBe(400);
    });

    it("el sitemap no lista el bidón", async () => {
      const xml = await (await sitemap(await get("https://stopee.test/sitemap.xml"))).text();
      expect(xml).toContain("/tienda/CONC-1L");
      expect(xml).not.toContain("BIDON-20L");
    });
  });

  // --- Carrito y pago ------------------------------------------------------

  describe("carrito y pago", () => {
    const items = [{ sku: "BIDON-20L", quantity: 1 }];

    it("un SKU del bidón metido a mano en la cookie no aparece en el carrito de quien no es aliado", async () => {
      const body = (await (await carritoLoader(await get("https://stopee.test/api/carrito", { items }))).json()) as { lines: { sku: string }[] };
      expect(body.lines).toEqual([]);
      const asAlly = (await (await carritoLoader(await get("https://stopee.test/api/carrito", { items, user: await ally() }))).json()) as { lines: { sku: string }[] };
      expect(asAlly.lines.map((l) => l.sku)).toEqual(["BIDON-20L"]);
    });

    it("no se cobra el bidón a quien no es aliado (carrito vacío para él)", async () => {
      const visitor = await outcomeOf(async () => checkout(await post("https://stopee.test/api/checkout", VALID_ADDRESS, { items })));
      expect((visitor as Response).status).toBe(400);
      expect((await (visitor as Response).json()) as { error: string }).toMatchObject({ error: "Tu carrito está vacío." });
      const customer = await outcomeOf(async () => checkout(await post("https://stopee.test/api/checkout", VALID_ADDRESS, { items, user: await makeUser() })));
      expect((customer as Response).status).toBe(400);
      expect(createSession).not.toHaveBeenCalled();
    });

    it("con un concentrado normal en el carrito, el bidón se descarta y solo se cobra lo público", async () => {
      const mixed = [{ sku: "CONC-1L", quantity: 1 }, ...items];
      const response = await checkout(await post("https://stopee.test/api/checkout", VALID_ADDRESS, { items: mixed, user: await makeUser() }));
      expect(response.status).toBe(302);
      const call = createSession.mock.calls[0][0] as { line_items: { price_data: { unit_amount: number } }[] };
      expect(call.line_items.map((l) => l.price_data.unit_amount)).toEqual([39900]);
    });

    it("un aliado paga el bidón al precio de aliado", async () => {
      const response = await checkout(await post("https://stopee.test/api/checkout", VALID_ADDRESS, { items, user: await ally() }));
      expect(response.status).toBe(302);
      const call = createSession.mock.calls[0][0] as { line_items: { price_data: { unit_amount: number }; quantity: number }[] };
      expect(call.line_items[0]).toMatchObject({ quantity: 1, price_data: { unit_amount: 300000 } });
    });

    it("el candado de CDMX también vale para el bidón", async () => {
      const response = await checkout(
        await post("https://stopee.test/api/checkout", { ...VALID_ADDRESS, shipPostalCode: "52000" }, { items, user: await ally() }),
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/solo entregamos en/);
      expect(createSession).not.toHaveBeenCalled();
    });

    it("el bidón no entra a un auto-envío ni siquiera para un aliado", async () => {
      const response = await subscription(
        await post(
          "https://stopee.test/api/subscription",
          { frequency: "4-semanas", sku: "BIDON-20L", quantity: "1", ...VALID_ADDRESS },
          { user: await ally() },
        ),
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/ya no están disponibles para auto-envío/);
      expect(createSession).not.toHaveBeenCalled();
    });
  });

  // --- Administración ------------------------------------------------------

  describe("administración", () => {
    async function adminCookie() {
      const u = await makeUser({ role: "admin", twoFactor: { enabledAt: new Date() } });
      const s = await sessionStorage.getSession();
      s.set("userId", String(u._id));
      s.set("iat", Date.now());
      s.set("mfa", true);
      return (await sessionStorage.commitSession(s)).split(";")[0];
    }
    const adminPost = (url: string, fields: Record<string, string>, cookie: string): Args => ({
      request: new Request(url, { method: "POST", headers: { cookie, origin: new URL(url).origin }, body: new URLSearchParams(fields) }),
      params: {},
      context: {},
    });
    const productForm = (over: Record<string, string> = {}) => ({
      intent: "create-product",
      name: "Bidón nuevo",
      sku: "BIDON-NUEVO",
      price: "2900",
      stock: "5",
      unitValue: "20",
      unit: "L",
      ...over,
    });

    it("un producto solo para aliados se guarda sin estrella y sin auto-envío, aunque se marquen", async () => {
      const cookie = await adminCookie();
      const result = await asResponse(adminProducts)(
        adminPost("https://stopee.test/admin/catalog/products", productForm({ visibility: "ALLY_ONLY", isFeatured: "on", isSubscribable: "on", isIndividuallySellable: "on" }), cookie),
      );
      expect(result.status).toBe(200);
      const saved = await ProductModel.findOne({ sku: "BIDON-NUEVO" }).lean();
      expect(saved).toMatchObject({ visibility: "ALLY_ONLY", isFeatured: false, isSubscribable: false });
    });

    it("un valor raro en 'visibility' cuenta como público (nunca queda en un estado inválido)", async () => {
      const cookie = await adminCookie();
      await asResponse(adminProducts)(adminPost("https://stopee.test/admin/catalog/products", productForm({ visibility: "TODOS", isIndividuallySellable: "on" }), cookie));
      expect((await ProductModel.findOne({ sku: "BIDON-NUEVO" }).lean())!.visibility).toBe("PUBLIC");
    });

    it("solo un administrador puede cambiar la visibilidad", async () => {
      const customerCookie = (await cookies({ user: await makeUser() }));
      const result = (await outcomeOf(() =>
        adminProducts(adminPost("https://stopee.test/admin/catalog/products", productForm({ visibility: "ALLY_ONLY" }), customerCookie)),
      )) as Response;
      expect([302, 403]).toContain(result.status);
      expect(await ProductModel.countDocuments({ sku: "BIDON-NUEVO" })).toBe(0);
    });

    it("el bidón no puede ser la estrella de la tienda", async () => {
      const bidon = (await ProductModel.findOne({ sku: "BIDON-20L" }).lean())!;
      await featured.toggleFeatured("product", String(bidon._id));
      expect((await ProductModel.findOne({ sku: "BIDON-20L" }).lean())!.isFeatured).toBeFalsy();
    });

    it("un paquete público no puede llevar el bidón dentro (y uno normal sí se crea)", async () => {
      const cookie = await adminCookie();
      const BundleModel = (await import("~/models/bundle.server")).BundleModel;
      const bidon = (await ProductModel.findOne({ sku: "BIDON-20L" }).lean())!;
      const concentrado = (await ProductModel.findOne({ sku: "CONC-1L" }).lean())!;
      const bundleForm = (productId: unknown) => ({
        intent: "create-bundle",
        bundleName: "Paquete de prueba",
        productId: String(productId),
        quantity: "1",
        discountPercentage: "0",
      });

      // Control: con un producto público el mismo formulario sí crea el paquete.
      const ok = await asResponse(adminBundles)(adminPost("https://stopee.test/admin/catalog/bundles", bundleForm(concentrado._id), cookie));
      expect(ok.status).toBe(200);
      expect(await BundleModel.countDocuments()).toBe(1);

      // Con el bidón: se rechaza por ser solo para aliados y no se crea otro.
      const rejected = await asResponse(adminBundles)(adminPost("https://stopee.test/admin/catalog/bundles", bundleForm(bidon._id), cookie));
      expect(rejected.status).toBe(400);
      expect(((await rejected.json()) as { error: string }).error).toMatch(/solo para aliados/);
      expect(await BundleModel.countDocuments()).toBe(1);
    });
  });
});
