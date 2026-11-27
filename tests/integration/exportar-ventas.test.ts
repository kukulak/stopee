import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse, outcomeOf } from "../helpers/http";

type Args = { request: Request; params: Record<string, string>; context: object };
type Handler = (args: Args) => Promise<Response>;

const FISCAL = { rfc: "PELJ800101AB1", razonSocial: "JUAN PÉREZ LÓPEZ", regimenFiscal: "612", codigoPostalFiscal: "03100", usoCfdi: "G03" };

/** El exportador de ventas: periodo en hora de México, qué incluir y el resumen que se ve antes de descargar. */
describe.skipIf(!hasTestDb)("exportar ventas", () => {
  let exportLoader: Handler;
  let sessionStorage: typeof import("~/lib/session.server").sessionStorage;
  let UserModel: typeof import("~/models/user.server").UserModel;
  let OrderModel: typeof import("~/models/order.server").OrderModel;
  let cachedAdmin: string | undefined;

  beforeAll(async () => {
    assertDisposableDb();
    exportLoader = asResponse(((await import("~/routes/admin_.exports.sales")) as never as { loader: Handler }).loader);
    ({ sessionStorage } = await import("~/lib/session.server"));
    ({ UserModel } = await import("~/models/user.server"));
    ({ OrderModel } = await import("~/models/order.server"));
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
      const admin = await UserModel.create({ email: "admin@correo.com", passwordHash: "x", emailVerifiedAt: new Date(), role: "admin", twoFactor: { enabledAt: new Date() } });
      cachedAdmin = await cookieFor(admin._id, { mfa: true });
    }
    return cachedAdmin;
  };
  const makeOrder = (over: Record<string, unknown> = {}) =>
    OrderModel.create({
      email: "cliente@correo.com",
      items: [{ sku: "CONC-1L", name: "Concentrado 1L", quantity: 1, unitPriceMxn: 100 }],
      totalAmount: 100,
      netAmount: 100,
      ...over,
    });
  const call = async (query: string) =>
    exportLoader({ request: new Request(`https://stopee.test/admin/exports/sales?${query}`, { headers: { cookie: await adminCookie() } }), params: {}, context: {} });
  const rows = async (query: string) => {
    const response = await call(query);
    expect(response.status).toBe(200);
    const [header, ...lines] = (await response.text()).split("\n");
    return { response, header: header.split(","), lines: lines.filter(Boolean) };
  };
  const summary = async (query: string) =>
    (await (await call(`resumen=1&${query}`)).json()) as { count: number; validCount: number; revenue: number; cancelled: number; refunded: number };

  it("por defecto baja solo las ventas válidas; «todas» suma las canceladas y reembolsadas", async () => {
    await makeOrder();
    await makeOrder({ status: "delivered" });
    await makeOrder({ status: "cancelled" });
    await makeOrder({ status: "refunded" });
    expect((await rows("")).lines).toHaveLength(2);
    expect((await rows("estado=validas")).lines).toHaveLength(2);
    expect((await rows("estado=todas")).lines).toHaveLength(4);
  });

  it("el periodo se lee en hora de México: el 30 a las 9 pm sigue siendo del 30", async () => {
    await makeOrder({ email: "noche@correo.com", createdAt: new Date("2026-11-30T21:00:00-06:00") });
    await makeOrder({ email: "madrugada@correo.com", createdAt: new Date("2026-12-01T00:30:00-06:00") });
    await makeOrder({ email: "antes@correo.com", createdAt: new Date("2026-10-31T23:59:00-06:00") });
    const emails = async (query: string) => (await rows(query)).lines.map((l) => l.split(",")[2].replace(/"/g, "")).sort();
    expect(await emails("from=2026-11-01&to=2026-11-30")).toEqual(["noche@correo.com"]);
    expect(await emails("from=2026-12-01&to=2026-12-31")).toEqual(["madrugada@correo.com"]);
    expect(await emails("from=2026-11-01")).toEqual(["madrugada@correo.com", "noche@correo.com"]);
    expect(await emails("to=2026-10-31")).toEqual(["antes@correo.com"]);
  });

  it("filtra por factura: las que no la pidieron (para la global) o las que sí", async () => {
    await makeOrder({ email: "sin@correo.com" });
    await makeOrder({ email: "con@correo.com", requiresInvoice: true, billingInfo: FISCAL });
    const emails = async (query: string) => (await rows(query)).lines.map((l) => l.split(",")[2].replace(/"/g, ""));
    expect(await emails("facturacion=sin")).toEqual(["sin@correo.com"]);
    expect(await emails("facturacion=con")).toEqual(["con@correo.com"]);
    expect(await emails("facturacion=todas")).toHaveLength(2);
  });

  it("deja fuera las ventas manuales cuando se pide", async () => {
    await makeOrder({ email: "web@correo.com" });
    await makeOrder({ email: "", source: "manual", paymentMethod: "cash" });
    expect((await rows("manuales=1")).lines).toHaveLength(2);
    expect((await rows("manuales=0")).lines).toHaveLength(1);
    expect((await rows("")).lines).toHaveLength(2);
  });

  it("el resumen cuenta pedidos y dinero con los mismos filtros, sin sumar lo cancelado al dinero", async () => {
    await makeOrder({ netAmount: 100 });
    await makeOrder({ netAmount: 250.5, status: "shipped" });
    await makeOrder({ netAmount: 999, status: "cancelled" });
    await makeOrder({ netAmount: 888, status: "refunded" });
    await makeOrder({ netAmount: 50, createdAt: new Date("2026-01-10T12:00:00-06:00") });

    expect(await summary("from=2026-11-01&estado=validas")).toEqual({ count: 2, validCount: 2, revenue: 350.5, cancelled: 1, refunded: 1 });
    expect(await summary("from=2026-11-01&estado=todas")).toMatchObject({ count: 4, validCount: 2, revenue: 350.5 });
    expect(await summary("")).toMatchObject({ count: 3, revenue: 400.5 });
    expect(await summary("from=2030-01-01")).toEqual({ count: 0, validCount: 0, revenue: 0, cancelled: 0, refunded: 0 });
  });

  it("el nombre del archivo dice el periodo y lo que se filtró", async () => {
    await makeOrder();
    const named = async (query: string) => (await call(query)).headers.get("content-disposition");
    expect(await named("from=2026-11-01&to=2026-11-30")).toContain("ventas-stopee_2026-11-01_a_2026-11-30.csv");
    expect(await named("from=2026-11-01&to=2026-11-30&facturacion=sin&estado=todas&manuales=0")).toContain(
      "ventas-stopee_2026-11-01_a_2026-11-30_sin-factura_con-canceladas_sin-manuales.csv",
    );
    expect(await named("")).toContain("ventas-stopee_todo.csv");
  });

  it("rechaza fechas inventadas o al revés, sin descargar nada", async () => {
    for (const query of ["from=ayer", "to=2026-13-45", "from=2026-12-01&to=2026-11-01"]) {
      const response = await call(query);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/fecha/i);
    }
  });

  it("la lista de facturas por emitir (?factura=1) sigue igual y no se mezcla con estos filtros", async () => {
    await makeOrder({ email: "pendiente@correo.com", requiresInvoice: true, billingInfo: FISCAL });
    await makeOrder({ email: "otro@correo.com" });
    const { header, lines } = await rows("factura=1&from=2030-01-01");
    expect(header).toContain("regimen_clave");
    expect(lines).toHaveLength(1);
  });

  it("solo un administrador puede descargarlo o ver el resumen", async () => {
    const customer = await UserModel.create({ email: "cliente2@correo.com", passwordHash: "x", emailVerifiedAt: new Date() });
    const customerCookie = await cookieFor(customer._id);
    for (const cookie of ["", customerCookie]) {
      for (const query of ["", "resumen=1"]) {
        const seen = await outcomeOf(() => exportLoader({ request: new Request(`https://stopee.test/admin/exports/sales?${query}`, { headers: cookie ? { cookie } : {} }), params: {}, context: {} }));
        expect((seen as Response).status).not.toBe(200);
      }
    }
  });
});
