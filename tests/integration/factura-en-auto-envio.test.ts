import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse, outcomeOf } from "../helpers/http";

// Stripe no se toca: solo interesa qué datos le mandaría la contratación.
const { createSubscriptionCheckoutSession } = vi.hoisted(() => ({ createSubscriptionCheckoutSession: vi.fn() }));
vi.mock("~/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/stripe.server")>()),
  createSubscriptionCheckoutSession,
}));

type Args = { request: Request; params: Record<string, string>; context: object };
type Handler = (args: Args) => Promise<Response>;

const ADDRESS: Record<string, string> = {
  shipName: "Ana Pérez",
  shipPhone: "55 1234 5678",
  shipLine1: "Av. Insurgentes Sur 123",
  shipLine2: "Col. Del Valle",
  shipCity: "Benito Juárez",
  shipPostalCode: "03100",
};
const FISCAL_FORM = { invoiceRequested: "on", invRfc: "pelj-800101ab1", invRazonSocial: "juan pérez lópez", invRegimen: "612", invCp: "03100", invUso: "G03" };
const FISCAL = { rfc: "PELJ800101AB1", razonSocial: "JUAN PÉREZ LÓPEZ", regimenFiscal: "612", codigoPostalFiscal: "03100", usoCfdi: "G03" };

/**
 * «Factura en cada caja» del auto-envío: se pide al contratar, se prende o apaga desde la cuenta
 * y el reporte de ventas trae los datos fiscales de cada pedido.
 */
describe.skipIf(!hasTestDb)("factura en el auto-envío y reporte de ventas", () => {
  let subscriptionAction: Handler;
  let cuentaAction: Handler;
  let exportLoader: Handler;
  let sessionStorage: typeof import("~/lib/session.server").sessionStorage;
  let UserModel: typeof import("~/models/user.server").UserModel;
  let OrderModel: typeof import("~/models/order.server").OrderModel;
  let SubscriptionModel: typeof import("~/models/subscription.server").SubscriptionModel;
  let ProductModel: typeof import("~/models/product.server").ProductModel;
  let SiteSettingsModel: typeof import("~/models/siteSettings.server").SiteSettingsModel;

  beforeAll(async () => {
    assertDisposableDb();
    subscriptionAction = asResponse(((await import("~/routes/api.subscription")) as never as { action: Handler }).action);
    cuentaAction = asResponse(((await import("~/routes/cuenta")) as never as { action: Handler }).action);
    exportLoader = asResponse(((await import("~/routes/admin_.exports.sales")) as never as { loader: Handler }).loader);
    ({ sessionStorage } = await import("~/lib/session.server"));
    ({ UserModel } = await import("~/models/user.server"));
    ({ OrderModel } = await import("~/models/order.server"));
    ({ SubscriptionModel } = await import("~/models/subscription.server"));
    ({ ProductModel } = await import("~/models/product.server"));
    ({ SiteSettingsModel } = await import("~/models/siteSettings.server"));
    await (await import("~/lib/db.server")).connectDB();
  });

  afterAll(async () => {
    await dropDb();
  });

  beforeEach(async () => {
    await wipeDb();
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    createSubscriptionCheckoutSession.mockReset();
    createSubscriptionCheckoutSession.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    await SiteSettingsModel.create({ isStoreActive: true });
    await ProductModel.create({ name: "Concentrado 1L", sku: "CONC-1L", price: 399, stock: 20 });
  });

  let counter = 0;
  const freshIp = () => `172.21.${(++counter >> 8) & 255}.${counter & 255}`;
  const makeUser = (over: Record<string, unknown> = {}) =>
    UserModel.create({ email: `u${++counter}@correo.com`, passwordHash: "x", emailVerifiedAt: new Date(), ...over });

  async function cookieFor(userId: unknown, extra: Record<string, unknown> = {}) {
    const s = await sessionStorage.getSession();
    s.set("userId", String(userId));
    s.set("iat", Date.now());
    for (const [k, v] of Object.entries(extra)) s.set(k, v);
    return (await sessionStorage.commitSession(s)).split(";")[0];
  }
  const post = (url: string, fields: Record<string, string>, cookie: string): Args => ({
    request: new Request(url, {
      method: "POST",
      headers: { cookie, origin: new URL(url).origin, "x-forwarded-for": freshIp() },
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
  const subscribe = async (user: { _id: unknown }, extra: Record<string, string> = {}) =>
    subscriptionAction(
      post("https://stopee.test/api/subscription", { frequency: "4-semanas", sku: "CONC-1L", quantity: "1", ...ADDRESS, ...extra }, await cookieFor(user._id)),
    );
  const sentMetadata = () => (createSubscriptionCheckoutSession.mock as Mock["mock"]).calls[0][0].metadata as Record<string, string>;

  // --- Al contratar -----------------------------------------------------------

  describe("al contratar", () => {
    it("con «Requiero factura»: los datos viajan limpios a Stripe y quedan guardados en la cuenta", async () => {
      const user = await makeUser();
      const response = await subscribe(user, FISCAL_FORM);
      expect(response.status).toBe(302);

      expect(sentMetadata()).toMatchObject({
        invoiceRequested: "true",
        invRfc: FISCAL.rfc,
        invRazonSocial: FISCAL.razonSocial,
        invRegimen: "612",
        invCp: "03100",
        invUso: "G03",
      });
      // Sin la casilla «guardar»: en un auto-envío siempre se guardan, de ahí salen los datos de cada renovación.
      expect((await UserModel.findById(user._id).lean())!.billingInfo).toMatchObject({ rfc: FISCAL.rfc, razonSocial: FISCAL.razonSocial });
    });

    it("datos fiscales inválidos: 400 con cada error y no se manda a pagar", async () => {
      const user = await makeUser();
      const response = await subscribe(user, { ...FISCAL_FORM, invRfc: "123", invCp: "12" });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string; invoiceErrors: Record<string, string> };
      expect(body.invoiceErrors.rfc).toBeTruthy();
      expect(body.invoiceErrors.codigoPostalFiscal).toBeTruthy();
      expect(createSubscriptionCheckoutSession).not.toHaveBeenCalled();
      expect((await UserModel.findById(user._id).lean())!.billingInfo?.rfc).toBeUndefined();
    });

    it("sin la casilla: no viaja nada fiscal y no se toca lo que ya tenía guardado", async () => {
      const user = await makeUser({ billingInfo: FISCAL });
      const response = await subscribe(user, { invRfc: "XAXX010101000" }); // campos sueltos sin la casilla se ignoran
      expect(response.status).toBe(302);
      expect(sentMetadata().invoiceRequested).toBeUndefined();
      expect(sentMetadata().invRfc).toBeUndefined();
      expect((await UserModel.findById(user._id).lean())!.billingInfo!.rfc).toBe(FISCAL.rfc);
    });
  });

  // --- Prender y apagar desde la cuenta ---------------------------------------

  describe("desde la cuenta", () => {
    const makeSubscription = (user: { _id: unknown }, extra: Record<string, unknown> = {}) =>
      SubscriptionModel.create({
        user: user._id,
        stripeSubscriptionId: `sub_${++counter}`,
        stripeCustomerId: "cus_1",
        items: [{ sku: "CONC-1L", name: "Concentrado 1L", quantity: 1, unitPriceMxn: 399 }],
        frequency: "4-semanas",
        ...extra,
      });
    const toggle = async (user: { _id: unknown }, subscriptionId: unknown, invoice: "on" | "off") =>
      cuentaAction(post("https://stopee.test/cuenta", { intent: "subscription-invoice", subscriptionId: String(subscriptionId), invoice }, await cookieFor(user._id)));
    const flag = async (id: unknown) => (await SubscriptionModel.findById(id).lean())!.requiresInvoice;

    it("se prende y se apaga cuando ya tiene datos fiscales guardados", async () => {
      const user = await makeUser({ billingInfo: FISCAL });
      const sub = await makeSubscription(user);
      expect(await flag(sub._id)).toBe(false);

      expect((await toggle(user, sub._id, "on")).status).toBe(200);
      expect(await flag(sub._id)).toBe(true);

      expect((await toggle(user, sub._id, "off")).status).toBe(200);
      expect(await flag(sub._id)).toBe(false);
    });

    it("sin datos fiscales no se puede prender y explica qué hacer", async () => {
      const user = await makeUser();
      const sub = await makeSubscription(user);
      const response = await toggle(user, sub._id, "on");
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/datos de facturación/);
      expect(await flag(sub._id)).toBe(false);
    });

    it("nadie toca la suscripción de otra persona", async () => {
      const owner = await makeUser({ billingInfo: FISCAL });
      const intruder = await makeUser({ billingInfo: FISCAL });
      const sub = await makeSubscription(owner);
      const response = await toggle(intruder, sub._id, "on");
      expect(response.status).toBe(404);
      expect(await flag(sub._id)).toBe(false);
    });

    it("quitar los datos fiscales apaga la factura automática de sus cajas", async () => {
      const user = await makeUser({ billingInfo: FISCAL });
      const sub = await makeSubscription(user, { requiresInvoice: true });
      const response = await cuentaAction(post("https://stopee.test/cuenta", { intent: "billing-remove" }, await cookieFor(user._id)));
      expect(response.status).toBe(200);
      expect(await flag(sub._id)).toBe(false);
      expect((await UserModel.findById(user._id).lean())!.billingInfo?.rfc).toBeUndefined();
    });
  });

  // --- Reporte de ventas ------------------------------------------------------

  describe("reporte de ventas (CSV)", () => {
    let cachedAdmin: string | undefined;
    beforeEach(() => {
      cachedAdmin = undefined;
    });
    const adminCookie = async () => {
      if (!cachedAdmin) {
        const admin = await makeUser({ role: "admin", twoFactor: { enabledAt: new Date() } });
        cachedAdmin = await cookieFor(admin._id, { mfa: true });
      }
      return cachedAdmin;
    };
    const makeOrder = (over: Record<string, unknown> = {}) =>
      OrderModel.create({
        email: "cliente@correo.com",
        items: [{ sku: "CONC-1L", name: "Concentrado 1L", quantity: 1, unitPriceMxn: 399 }],
        totalAmount: 399,
        netAmount: 399,
        ...over,
      });
    const rows = async (query = "", cookie?: string) => {
      const response = await exportLoader(get(`https://stopee.test/admin/exports/sales${query}`, cookie ?? (await adminCookie())));
      expect(response.status).toBe(200);
      const [header, ...lines] = (await response.text()).split("\n");
      return { response, header: header.split(","), lines };
    };

    it("trae número de pedido, si pidió factura, si ya se facturó y los datos fiscales", async () => {
      const sin = await makeOrder();
      const pendiente = await makeOrder({ email: "ana@correo.com", requiresInvoice: true, billingInfo: FISCAL });
      const emitida = await makeOrder({ email: "luis@correo.com", requiresInvoice: true, billingInfo: FISCAL, invoiceIssuedAt: new Date() });

      const { header, lines } = await rows();
      expect(header).toEqual(
        expect.arrayContaining(["pedido", "factura", "facturada", "rfc", "razon_social", "regimen_fiscal", "cp_fiscal", "uso_cfdi"]),
      );
      // Las celdas de texto van entre comillas (ver csvCell); aquí se comparan sin ellas.
      const col = (line: string, name: string) => line.split(",")[header.indexOf(name)].replace(/^"|"$/g, "");
      const byNumber = (o: { _id: unknown }) => lines.find((l) => col(l, "pedido") === String(o._id).slice(-8).toUpperCase())!;

      expect(col(byNumber(sin), "factura")).toBe("No");
      expect(col(byNumber(sin), "facturada")).toBe("");
      expect(col(byNumber(sin), "rfc")).toBe("");

      expect(col(byNumber(pendiente), "factura")).toBe("Si");
      expect(col(byNumber(pendiente), "facturada")).toBe("No");
      expect(col(byNumber(pendiente), "rfc")).toBe(FISCAL.rfc);
      expect(col(byNumber(pendiente), "regimen_fiscal")).toBe("612");
      expect(col(byNumber(pendiente), "cp_fiscal")).toBe("03100");
      expect(col(byNumber(pendiente), "uso_cfdi")).toBe("G03");

      expect(col(byNumber(emitida), "facturada")).toBe("Si");
    });

    describe("lista de facturas por emitir (?factura=1)", () => {
      const col = (header: string[], line: string, name: string) => line.split(",")[header.indexOf(name)].replace(/^"|"$/g, "");

      it("trae SOLO los pendientes: sin ventas normales, sin las ya emitidas y sin cancelados ni reembolsados", async () => {
        await makeOrder();
        const pendiente = await makeOrder({ email: "ana@correo.com", requiresInvoice: true, billingInfo: FISCAL });
        await makeOrder({ email: "luis@correo.com", requiresInvoice: true, billingInfo: FISCAL, invoiceIssuedAt: new Date() });
        await makeOrder({ email: "cancelado@correo.com", requiresInvoice: true, billingInfo: FISCAL, status: "cancelled" });
        await makeOrder({ email: "reembolsado@correo.com", requiresInvoice: true, billingInfo: FISCAL, status: "refunded" });

        const all = await rows();
        const only = await rows("?factura=1");
        expect(all.lines).toHaveLength(5);
        expect(only.lines).toHaveLength(1);
        expect(col(only.header, only.lines[0], "pedido")).toBe(String(pendiente._id).slice(-8).toUpperCase());
        expect(only.response.headers.get("content-disposition")).toMatch(/facturas-por-emitir-\d{4}-\d{2}-\d{2}\.csv/);
      });

      it("trae únicamente lo necesario para facturar, con clave y nombre del régimen y del uso de CFDI", async () => {
        await makeOrder({ requiresInvoice: true, billingInfo: FISCAL, netAmount: 399, utm: "x" });
        const { header, lines } = await rows("?factura=1");
        expect(header).toEqual([
          "pedido", "fecha", "email", "rfc", "razon_social", "regimen_clave", "regimen_nombre", "cp_fiscal",
          "uso_cfdi_clave", "uso_cfdi_nombre", "conceptos", "subtotal", "iva", "total",
        ]);
        const line = lines[0];
        expect(col(header, line, "rfc")).toBe(FISCAL.rfc);
        expect(col(header, line, "regimen_clave")).toBe("612");
        expect(col(header, line, "regimen_nombre")).toMatch(/Personas Físicas con Actividades Empresariales/);
        expect(col(header, line, "uso_cfdi_clave")).toBe("G03");
        expect(col(header, line, "uso_cfdi_nombre")).toBe("Gastos en general");
        expect(col(header, line, "conceptos")).toBe("1x Concentrado 1L");
        // 399 con IVA incluido = 343.97 + 55.03
        expect([col(header, line, "subtotal"), col(header, line, "iva"), col(header, line, "total")]).toEqual(["343.97", "55.03", "399.00"]);
      });

      it("con «hasta» deja fuera lo que llegó después del corte", async () => {
        await makeOrder({ requiresInvoice: true, billingInfo: FISCAL });
        const corte = new Date().toISOString();
        await new Promise((r) => setTimeout(r, 20));
        await makeOrder({ email: "tarde@correo.com", requiresInvoice: true, billingInfo: FISCAL });
        expect((await rows(`?factura=1&hasta=${encodeURIComponent(corte)}`)).lines).toHaveLength(1);
        expect((await rows("?factura=1")).lines).toHaveLength(2);
      });

      it("sin nada pendiente baja solo los encabezados", async () => {
        const { lines } = await rows("?factura=1");
        expect(lines.filter(Boolean)).toHaveLength(0);
      });
    });

    it("solo un administrador puede descargarlo", async () => {
      await makeOrder({ requiresInvoice: true, billingInfo: FISCAL });
      const customer = await makeUser();
      const seen = await outcomeOf(() => exportLoader(get("https://stopee.test/admin/exports/sales", "")));
      expect((seen as Response).status).not.toBe(200);
      const customerCookie = await cookieFor(customer._id);
      const asCustomer = await outcomeOf(() => exportLoader(get("https://stopee.test/admin/exports/sales", customerCookie)));
      expect((asCustomer as Response).status).not.toBe(200);
    });
  });
});
