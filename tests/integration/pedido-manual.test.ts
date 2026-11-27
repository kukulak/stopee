import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse, outcomeOf } from "../helpers/http";

type Args = { request: Request; params: Record<string, string>; context: object };
type Handler = (args: Args) => Promise<Response>;

const FISCAL_FORM = {
  invoiceRequested: "on",
  invRfc: "pelj-800101ab1",
  invRazonSocial: "juan pérez lópez",
  invRegimen: "612",
  invCp: "03100",
  invUso: "G03",
};

/** «Crear pedido»: una venta que no pasó por la tienda (efectivo, vecinos…) y queda registrada como un pedido más. */
describe.skipIf(!hasTestDb)("pedido manual", () => {
  let newAction: Handler;
  let newLoader: Handler;
  let ordersLoader: Handler;
  let exportLoader: Handler;
  let sessionStorage: typeof import("~/lib/session.server").sessionStorage;
  let UserModel: typeof import("~/models/user.server").UserModel;
  let OrderModel: typeof import("~/models/order.server").OrderModel;
  let ProductModel: typeof import("~/models/product.server").ProductModel;
  let BundleModel: typeof import("~/models/bundle.server").BundleModel;
  let adminId: unknown;
  let cachedAdmin: string | undefined;

  beforeAll(async () => {
    assertDisposableDb();
    const route = (await import("~/routes/admin.orders_.new")) as never as { action: Handler; loader: Handler };
    newAction = asResponse(route.action);
    newLoader = asResponse(route.loader);
    ordersLoader = asResponse(((await import("~/routes/admin.orders")) as never as { loader: Handler }).loader);
    exportLoader = asResponse(((await import("~/routes/admin_.exports.sales")) as never as { loader: Handler }).loader);
    ({ sessionStorage } = await import("~/lib/session.server"));
    ({ UserModel } = await import("~/models/user.server"));
    ({ OrderModel } = await import("~/models/order.server"));
    ({ ProductModel } = await import("~/models/product.server"));
    ({ BundleModel } = await import("~/models/bundle.server"));
    await (await import("~/lib/db.server")).connectDB();
  });
  afterAll(async () => {
    await dropDb();
  });
  beforeEach(async () => {
    await wipeDb();
    cachedAdmin = undefined;
  });

  async function cookieFor(userId: unknown, extra: Record<string, unknown> = {}) {
    const s = await sessionStorage.getSession();
    s.set("userId", String(userId));
    s.set("iat", Date.now());
    for (const [k, v] of Object.entries(extra)) s.set(k, v);
    return (await sessionStorage.commitSession(s)).split(";")[0];
  }
  const adminCookie = async () => {
    if (!cachedAdmin) {
      const admin = await UserModel.create({
        name: "Lucía",
        email: "admin@correo.com",
        passwordHash: "x",
        emailVerifiedAt: new Date(),
        role: "admin",
        twoFactor: { enabledAt: new Date() },
      });
      adminId = admin._id;
      cachedAdmin = await cookieFor(admin._id, { mfa: true });
    }
    return cachedAdmin;
  };
  const makeProduct = (over: Record<string, unknown> = {}) =>
    ProductModel.create({ name: "Concentrado STOPee 1 L", sku: "CONC-1L", price: 320, stock: 10, ...over });

  type Line = [sku: string, qty: string | number, price?: string | number];
  /** Arma el formulario como lo manda la pantalla: renglones repetidos (lineSku, lineQty, linePrice) y el resto de campos. */
  const formOf = (lines: Line[], fields: Record<string, string> = {}) => {
    const params = new URLSearchParams({ paymentMethod: "cash", status: "delivered", ...fields });
    for (const [sku, qty, price] of lines) {
      params.append("lineSku", sku);
      params.append("lineQty", String(qty));
      params.append("linePrice", price === undefined ? "" : String(price));
    }
    return params;
  };
  const send = async (params: URLSearchParams, cookie?: string) => {
    const url = "https://stopee.test/admin/orders/new";
    return newAction({
      request: new Request(url, {
        method: "POST",
        headers: { cookie: cookie ?? (await adminCookie()), origin: new URL(url).origin },
        body: params,
      }),
      params: {},
      context: {},
    });
  };

  it("registra la venta como pedido manual, con número, y descuenta el inventario", async () => {
    const product = await makeProduct();
    const response = await send(formOf([["CONC-1L", 3]], { customerName: "Vecino 4B" }));
    const body = (await response.json()) as { ok: boolean; number: string; total: number; units: number; lowStock: string[] };
    expect(body).toMatchObject({ ok: true, total: 960, units: 3, lowStock: [] });

    const order = (await OrderModel.findOne().lean())!;
    expect(order).toMatchObject({
      source: "manual",
      paymentMethod: "cash",
      status: "delivered",
      customerName: "Vecino 4B",
      email: "",
      totalAmount: 960,
      netAmount: 960,
      discountAmount: 0,
      type: "one_time",
      countsTowardLoyalty: false,
    });
    expect(order.items).toEqual([{ sku: "CONC-1L", name: "Concentrado STOPee 1 L", quantity: 3, unitPriceMxn: 320 }]);
    expect(String(order._id).slice(-8).toUpperCase()).toBe(body.number);
    expect((await ProductModel.findById(product._id).lean())!.stock).toBe(7);
  });

  it("guarda quién del equipo registró la venta y lo muestra en la lista y en el CSV", async () => {
    await makeProduct();
    await send(formOf([["CONC-1L", 1]]));
    const order = (await OrderModel.findOne().lean())!;
    expect(String(order.createdBy)).toBe(String(adminId));
    expect(order.createdByName).toBe("Lucía");

    const cookie = await adminCookie();
    const list = (await (await ordersLoader({ request: new Request("https://stopee.test/admin/orders", { headers: { cookie } }), params: {}, context: {} })).json()) as {
      orders: { manual: boolean; createdByName: string }[];
    };
    expect(list.orders[0]).toMatchObject({ manual: true, createdByName: "Lucía" });
    const csv = await (await exportLoader({ request: new Request("https://stopee.test/admin/exports/sales", { headers: { cookie } }), params: {}, context: {} })).text();
    const [header, line] = csv.split("\n");
    expect(line.split(",")[header.split(",").indexOf("registrado_por")]).toBe('"Lucía"');
  });

  it("varios renglones en un pedido: productos, paquetes y lo exclusivo de Puntos de recarga", async () => {
    const concentrado = await makeProduct();
    const bidon = await makeProduct({ name: "Bidón de recarga", sku: "BIDON-20L", price: 900, stock: 5, visibility: "ALLY_ONLY" });
    await BundleModel.create({
      name: "Kit inicial",
      sku: "kit-inicial",
      bundlePrice: 600,
      products: [{ product: concentrado._id, quantity: 2, discountPercentage: 0 }],
    });
    const response = await send(formOf([["CONC-1L", 1], ["kit-inicial", 2], ["BIDON-20L", 1, 850]]));
    expect(((await response.json()) as { total: number; units: number })).toMatchObject({ total: 320 + 1200 + 850, units: 4 });

    const order = (await OrderModel.findOne().lean())!;
    expect(order.items.map((i) => [i.sku, i.quantity, i.unitPriceMxn])).toEqual([
      ["CONC-1L", 1, 320],
      ["kit-inicial", 2, 600],
      ["BIDON-20L", 1, 850],
    ]);
    // 1 suelto + 2 kits × 2 concentrados = 5 menos; el bidón baja 1.
    expect((await ProductModel.findById(concentrado._id).lean())!.stock).toBe(5);
    expect((await ProductModel.findById(bidon._id).lean())!.stock).toBe(4);
    // Lista: 320 + 1200 + 900 = 2420; cobrado 2370 → descuento de 50.
    expect(order).toMatchObject({ totalAmount: 2420, netAmount: 2370, discountAmount: 50 });
  });

  it("el mismo producto en dos renglones suma para el aviso de inventario", async () => {
    await makeProduct({ stock: 3 });
    const body2 = (await (await send(formOf([["CONC-1L", 2], ["CONC-1L", 2, 300]]))).json()) as { ok: boolean; lowStock: string[] };
    expect(body2.ok).toBe(true);
    expect(body2.lowStock[0]).toMatch(/había 3, vendiste 4/);
  });

  it("con un precio menor al de lista, la diferencia queda como descuento", async () => {
    const product = await makeProduct();
    await send(formOf([["CONC-1L", 2, 300]]));
    const order = (await OrderModel.findOne().lean())!;
    expect(order).toMatchObject({ totalAmount: 640, netAmount: 600, discountAmount: 40, discountPercent: 6.25 });
    expect(order.items[0].unitPriceMxn).toBe(300);
  });

  it("avisa si vendió más de lo que había y deja el inventario en 0, sin negativos", async () => {
    const product = await makeProduct({ stock: 2 });
    const body = (await (await send(formOf([["CONC-1L", 5]]))).json()) as { ok: boolean; lowStock: string[] };
    expect(body.ok).toBe(true);
    expect(body.lowStock[0]).toMatch(/había 2, vendiste 5/);
    expect((await ProductModel.findById(product._id).lean())!.stock).toBe(0);
  });

  it("con factura pedida entra a la lista de pendientes y al CSV de facturas", async () => {
    const product = await makeProduct();
    await send(formOf([["CONC-1L", 1]], { ...FISCAL_FORM, email: "Ana@Correo.com" }));
    const order = (await OrderModel.findOne().lean())!;
    expect(order).toMatchObject({ requiresInvoice: true, email: "ana@correo.com" });
    expect(order.billingInfo).toMatchObject({ rfc: "PELJ800101AB1", razonSocial: "JUAN PÉREZ LÓPEZ", regimenFiscal: "612" });

    const orders = (await (await ordersLoader({ request: new Request("https://stopee.test/admin/orders", { headers: { cookie: await adminCookie() } }), params: {}, context: {} })).json()) as {
      invoicesPending: number;
    };
    expect(orders.invoicesPending).toBe(1);

    const csv = await (
      await exportLoader({ request: new Request("https://stopee.test/admin/exports/sales?factura=1", { headers: { cookie: await adminCookie() } }), params: {}, context: {} })
    ).text();
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain("PELJ800101AB1");
  });

  it("el CSV de ventas distingue las ventas manuales y cómo se pagó", async () => {
    const product = await makeProduct();
    await send(formOf([["CONC-1L", 1]], { paymentMethod: "transfer" }));
    await OrderModel.create({ email: "web@correo.com", items: [{ sku: "A", name: "A", quantity: 1, unitPriceMxn: 1 }], totalAmount: 1, netAmount: 1 });
    const text = await (
      await exportLoader({ request: new Request("https://stopee.test/admin/exports/sales", { headers: { cookie: await adminCookie() } }), params: {}, context: {} })
    ).text();
    const [header, ...lines] = text.split("\n");
    const cols = header.split(",");
    const cell = (line: string, name: string) => line.split(",")[cols.indexOf(name)].replace(/^"|"$/g, "");
    expect(lines.map((l) => [cell(l, "origen"), cell(l, "pago")]).sort()).toEqual([
      ["Manual", "Transferencia"],
      ["Web", ""],
    ]);
  });

  it("no guarda nada si falta algo o hay un dato mal, y no toca el inventario", async () => {
    const product = await makeProduct();
    const stock = async () => (await ProductModel.findById(product._id).lean())!.stock;
    const cases: Array<[URLSearchParams, RegExp]> = [
      [formOf([]), /al menos un producto/],
      [formOf([["CONC-1L", "1.5"]]), /entero/],
      [formOf([["CONC-1L", "abc"]]), /entero/],
      [formOf([["CONC-1L", 0]]), /entero/],
      [formOf([["CONC-1L", 1, -5]]), /precio/],
      [formOf([["NO-EXISTE", 1]]), /ya no está disponible/],
      [formOf([["CONC-1L", 1]], { email: "no-es-correo" }), /correo/],
      [formOf([["CONC-1L", 1]], { paymentMethod: "bitcoin" }), /cómo te pagaron/],
      [formOf([["CONC-1L", 1]], { status: "refunded" }), /estado/],
      [formOf([["CONC-1L", 1]], { date: "2999-01-01" }), /futura/],
      [formOf([["CONC-1L", 1]], { date: "ayer" }), /fecha/],
    ];
    for (const [params, message] of cases) {
      const response = await send(params);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(message);
    }
    expect(await OrderModel.countDocuments()).toBe(0);
    expect(await stock()).toBe(10);
  });

  it("con la factura mal llenada devuelve los errores campo por campo y no registra la venta", async () => {
    const product = await makeProduct();
    const response = await send(formOf([["CONC-1L", 1]], { invoiceRequested: "on", invRfc: "123", invRazonSocial: "", invRegimen: "", invCp: "1", invUso: "G03" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { invoiceErrors: Record<string, string> };
    expect(Object.keys(body.invoiceErrors)).toEqual(expect.arrayContaining(["rfc", "razonSocial", "codigoPostalFiscal"]));
    expect(await OrderModel.countDocuments()).toBe(0);
    expect((await ProductModel.findById(product._id).lean())!.stock).toBe(10);
  });

  it("una venta de días atrás se guarda con esa fecha", async () => {
    const product = await makeProduct();
    await send(formOf([["CONC-1L", 1]], { date: "2026-01-15" }));
    expect((await OrderModel.findOne().lean())!.createdAt.toISOString()).toBe("2026-01-15T18:00:00.000Z");
  });

  it("solo un administrador puede ver el formulario o registrar ventas", async () => {
    const product = await makeProduct();
    const customer = await UserModel.create({ email: "cliente@correo.com", passwordHash: "x", emailVerifiedAt: new Date() });
    const customerCookie = await cookieFor(customer._id);
    for (const cookie of ["", customerCookie]) {
      const seenAction = await outcomeOf(() => send(formOf([["CONC-1L", 1]]), cookie));
      expect((seenAction as Response).status).not.toBe(200);
      const seenLoader = await outcomeOf(() =>
        newLoader({ request: new Request("https://stopee.test/admin/orders/new", { headers: cookie ? { cookie } : {} }), params: {}, context: {} }),
      );
      expect((seenLoader as Response).status).not.toBe(200);
    }
    expect(await OrderModel.countDocuments()).toBe(0);
    expect((await ProductModel.findById(product._id).lean())!.stock).toBe(10);
  });
});
