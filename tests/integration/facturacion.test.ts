import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse, outcomeOf } from "../helpers/http";

type Args = { request: Request; params: Record<string, string>; context: object };
type Handler = (args: Args) => Promise<Response>;

/**
 * Los datos de facturación en la cuenta del cliente y su vista en el administrador:
 * quién puede verlos, quién puede cambiarlos y qué se guarda.
 */
describe.skipIf(!hasTestDb)("facturación (CFDI)", () => {
  let cuentaAction: Handler;
  let cuentaLoader: Handler;
  let ordersLoader: Handler;
  let ordersAction: Handler;
  let sessionStorage: typeof import("~/lib/session.server").sessionStorage;
  let UserModel: typeof import("~/models/user.server").UserModel;
  let OrderModel: typeof import("~/models/order.server").OrderModel;
  let connectDB: typeof import("~/lib/db.server").connectDB;

  beforeAll(async () => {
    assertDisposableDb();
    const cuenta = (await import("~/routes/cuenta")) as never as { action: Handler; loader: Handler };
    cuentaAction = asResponse(cuenta.action);
    cuentaLoader = asResponse(cuenta.loader);
    const orders = (await import("~/routes/admin.orders")) as never as { action: Handler; loader: Handler };
    ordersAction = asResponse(orders.action);
    ordersLoader = asResponse(orders.loader);
    ({ sessionStorage } = await import("~/lib/session.server"));
    ({ UserModel } = await import("~/models/user.server"));
    ({ OrderModel } = await import("~/models/order.server"));
    ({ connectDB } = await import("~/lib/db.server"));
    await connectDB();
  });

  afterAll(async () => {
    await dropDb();
  });

  beforeEach(async () => {
    await wipeDb();
    vi.restoreAllMocks();
  });

  const makeUser = (overrides: Record<string, unknown> = {}) =>
    UserModel.create({ email: "ana@correo.com", passwordHash: "x", emailVerifiedAt: new Date(), ...overrides });

  async function cookieFor(userId: unknown, extra: Record<string, unknown> = {}) {
    const s = await sessionStorage.getSession();
    s.set("userId", String(userId));
    s.set("iat", Date.now());
    for (const [k, v] of Object.entries(extra)) s.set(k, v);
    return (await sessionStorage.commitSession(s)).split(";")[0];
  }
  const adminCookie = async () => {
    const admin = await makeUser({ email: "admin@correo.com", role: "admin", twoFactor: { enabledAt: new Date() } });
    return cookieFor(admin._id, { mfa: true });
  };

  const post = (url: string, fields: Record<string, string>, cookie?: string): Args => ({
    request: new Request(url, {
      method: "POST",
      headers: { ...(cookie ? { cookie } : {}), origin: new URL(url).origin },
      body: new URLSearchParams(fields),
    }),
    params: {},
    context: {},
  });
  const get = (url: string, cookie?: string): Args => ({
    request: new Request(url, { headers: cookie ? { cookie } : {} }),
    params: {},
    context: {},
  });

  const FISCAL = { invRfc: "pelj-800101ab1", invRazonSocial: "juan pérez lópez", invRegimen: "612", invCp: "03100", invUso: "G03" };

  describe("datos fiscales en la cuenta", () => {
    it("se guardan limpios y los carga el perfil", async () => {
      const user = await makeUser();
      const cookie = await cookieFor(user._id);
      const r = await cuentaAction(post("https://stopee.test/cuenta", { intent: "billing-update", ...FISCAL }, cookie));
      expect(r.status).toBe(200);
      expect((await UserModel.findById(user._id).lean())!.billingInfo).toMatchObject({
        rfc: "PELJ800101AB1",
        razonSocial: "JUAN PÉREZ LÓPEZ",
        regimenFiscal: "612",
        codigoPostalFiscal: "03100",
        usoCfdi: "G03",
      });
      const loaded = (await (await cuentaLoader(get("https://stopee.test/cuenta", cookie))).json()) as { user: { billing: { rfc: string } | null } };
      expect(loaded.user.billing?.rfc).toBe("PELJ800101AB1");
    });

    it("datos incompletos o imposibles: 400 con cada error y no se guarda nada", async () => {
      const user = await makeUser();
      const cookie = await cookieFor(user._id);
      const r = await cuentaAction(
        post("https://stopee.test/cuenta", { intent: "billing-update", ...FISCAL, invRfc: "XYZ", invUso: "" }, cookie),
      );
      expect(r.status).toBe(400);
      const body = (await r.json()) as { errors: Record<string, string> };
      expect(Object.keys(body.errors).sort()).toEqual(["rfc", "usoCfdi"]);
      expect((await UserModel.findById(user._id).lean())!.billingInfo).toBeUndefined();
    });

    it("«Sin obligaciones fiscales» solo acepta S01", async () => {
      const user = await makeUser();
      const cookie = await cookieFor(user._id);
      const r = await cuentaAction(post("https://stopee.test/cuenta", { intent: "billing-update", ...FISCAL, invRegimen: "616" }, cookie));
      expect(r.status).toBe(400);
    });

    it("quitarlos los borra, y son de cada cuenta: nadie toca los de otra", async () => {
      const ana = await makeUser();
      const beto = await makeUser({ email: "beto@correo.com" });
      const cookieAna = await cookieFor(ana._id);
      const cookieBeto = await cookieFor(beto._id);
      await cuentaAction(post("https://stopee.test/cuenta", { intent: "billing-update", ...FISCAL }, cookieAna));
      await cuentaAction(post("https://stopee.test/cuenta", { intent: "billing-remove" }, cookieBeto));
      expect((await UserModel.findById(ana._id).lean())!.billingInfo?.rfc).toBe("PELJ800101AB1");
      await cuentaAction(post("https://stopee.test/cuenta", { intent: "billing-remove" }, cookieAna));
      expect((await UserModel.findById(ana._id).lean())!.billingInfo).toBeUndefined();
    });

    it("sin sesión no se puede guardar nada", async () => {
      const outcome = await outcomeOf(() => cuentaAction(post("https://stopee.test/cuenta", { intent: "billing-update", ...FISCAL })));
      expect((outcome as Response).status).not.toBe(200);
      expect(await UserModel.countDocuments({ billingInfo: { $exists: true } })).toBe(0);
    });
  });

  describe("administración de pedidos con factura", () => {
    const makeOrder = (overrides: Record<string, unknown> = {}) =>
      OrderModel.create({
        email: "cliente@correo.com",
        items: [{ sku: "CONC-1L", name: "Concentrado 1L", quantity: 1, unitPriceMxn: 399 }],
        totalAmount: 399,
        netAmount: 399,
        ...overrides,
      });
    const billing = { rfc: "PELJ800101AB1", razonSocial: "JUAN PÉREZ LÓPEZ", regimenFiscal: "612", codigoPostalFiscal: "03100", usoCfdi: "G03" };

    type Row = { id: string; requiresInvoice: boolean; billing: { rfc: string } | null; number: string; invoiceIssuedAt: string | null };
    const list = async (cookie: string, query = "") =>
      (await (await ordersLoader(get(`https://stopee.test/admin/orders${query}`, cookie))).json()) as {
        orders: Row[];
        invoicesPending: number;
        onlyInvoice: boolean;
      };

    it("el listado marca los pedidos que requieren factura y trae sus datos fiscales y número de pedido", async () => {
      const cookie = await adminCookie();
      const con = await makeOrder({ requiresInvoice: true, billingInfo: billing });
      await makeOrder({ email: "otro@correo.com" });

      const all = await list(cookie);
      expect(all.orders).toHaveLength(2);
      const row = all.orders.find((o) => o.id === String(con._id))!;
      expect(row).toMatchObject({ requiresInvoice: true, number: String(con._id).slice(-8).toUpperCase() });
      expect(row.billing?.rfc).toBe("PELJ800101AB1");
      expect(all.orders.find((o) => !o.requiresInvoice)!.billing).toBeNull();
      expect(all.invoicesPending).toBe(1);
    });

    it("el filtro «requieren factura» deja solo esos pedidos", async () => {
      const cookie = await adminCookie();
      await makeOrder({ requiresInvoice: true, billingInfo: billing });
      await makeOrder({ email: "otro@correo.com" });
      const filtered = await list(cookie, "?factura=1");
      expect(filtered.onlyInvoice).toBe(true);
      expect(filtered.orders).toHaveLength(1);
      expect(filtered.orders[0].requiresInvoice).toBe(true);
    });

    it("marcar como facturada baja el contador de pendientes, y se puede deshacer", async () => {
      const cookie = await adminCookie();
      const order = await makeOrder({ requiresInvoice: true, billingInfo: billing });

      await ordersAction(post("https://stopee.test/admin/orders", { intent: "mark-invoiced", id: String(order._id) }, cookie));
      let state = await list(cookie);
      expect(state.invoicesPending).toBe(0);
      expect(state.orders[0].invoiceIssuedAt).toBeTruthy();

      await ordersAction(post("https://stopee.test/admin/orders", { intent: "unmark-invoiced", id: String(order._id) }, cookie));
      state = await list(cookie);
      expect(state.invoicesPending).toBe(1);
      expect(state.orders[0].invoiceIssuedAt).toBeNull();
    });

    it("un pedido que no pidió factura no se puede marcar como facturado", async () => {
      const cookie = await adminCookie();
      const order = await makeOrder();
      await ordersAction(post("https://stopee.test/admin/orders", { intent: "mark-invoiced", id: String(order._id) }, cookie));
      expect((await OrderModel.findById(order._id).lean())!.invoiceIssuedAt).toBeUndefined();
    });

    it("un cliente (o un visitante) no ve los datos fiscales de nadie ni marca facturas", async () => {
      const customer = await makeUser({ email: "cliente2@correo.com" });
      const customerCookie = await cookieFor(customer._id);
      const order = await makeOrder({ requiresInvoice: true, billingInfo: billing });

      const seen = await outcomeOf(() => ordersLoader(get("https://stopee.test/admin/orders", customerCookie)));
      expect((seen as Response).status).not.toBe(200);
      const anon = await outcomeOf(() => ordersLoader(get("https://stopee.test/admin/orders")));
      expect((anon as Response).status).not.toBe(200);

      const tried = await outcomeOf(() =>
        ordersAction(post("https://stopee.test/admin/orders", { intent: "mark-invoiced", id: String(order._id) }, customerCookie)),
      );
      expect((tried as Response).status).not.toBe(200);
      expect((await OrderModel.findById(order._id).lean())!.invoiceIssuedAt).toBeUndefined();
    });

    it("«Mis pedidos» del cliente muestra su número de pedido y si pidió factura", async () => {
      const user = await makeUser();
      const cookie = await cookieFor(user._id);
      const order = await makeOrder({ user: user._id, requiresInvoice: true, billingInfo: billing });
      const loaded = (await (await cuentaLoader(get("https://stopee.test/cuenta", cookie))).json()) as {
        orders: { number: string; requiresInvoice: boolean }[];
      };
      expect(loaded.orders[0]).toMatchObject({ number: String(order._id).slice(-8).toUpperCase(), requiresInvoice: true });
    });
  });
});
