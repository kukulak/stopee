import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse, outcomeOf } from "../helpers/http";

type Handler = (args: { request: Request; params: object; context: object }) => Promise<Response>;

const NOW = () => new Date();

/** Las listas para campañas: solo sale quien aceptó recibir promociones, y el resto se cuenta aparte pero nunca entra. */
describe.skipIf(!hasTestDb)("listas para campañas", () => {
  let route: Handler;
  let sessionStorage: typeof import("~/lib/session.server").sessionStorage;
  let UserModel: typeof import("~/models/user.server").UserModel;
  let LeadModel: typeof import("~/models/lead.server").LeadModel;
  let OrderModel: typeof import("~/models/order.server").OrderModel;
  let SubscriptionModel: typeof import("~/models/subscription.server").SubscriptionModel;
  let AnalyticsEventModel: typeof import("~/models/analyticsEvent.server").AnalyticsEventModel;
  let cachedAdmin: string | undefined;

  beforeAll(async () => {
    assertDisposableDb();
    route = asResponse(((await import("~/routes/admin_.exports.campaigns")) as never as { loader: Handler }).loader);
    ({ sessionStorage } = await import("~/lib/session.server"));
    ({ UserModel } = await import("~/models/user.server"));
    ({ LeadModel } = await import("~/models/lead.server"));
    ({ OrderModel } = await import("~/models/order.server"));
    ({ SubscriptionModel } = await import("~/models/subscription.server"));
    ({ AnalyticsEventModel } = await import("~/models/analyticsEvent.server"));
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
      const admin = await UserModel.create({ email: "admin@correo.com", passwordHash: "x", emailVerifiedAt: NOW(), role: "admin", twoFactor: { enabledAt: NOW() } });
      cachedAdmin = await cookieFor(admin._id, { mfa: true });
    }
    return cachedAdmin;
  };
  const makeUser = (email: string, over: Record<string, unknown> = {}) =>
    UserModel.create({ email, name: email.split("@")[0], passwordHash: "x", emailVerifiedAt: NOW(), ...over });
  const makeOrder = (over: Record<string, unknown> = {}) =>
    OrderModel.create({ email: "x@correo.com", items: [{ sku: "A", name: "A", quantity: 1, unitPriceMxn: 100 }], totalAmount: 100, netAmount: 100, ...over });
  const call = async (query: string, cookie?: string) =>
    route({ request: new Request(`https://stopee.test/admin/exports/campaigns?${query}`, { headers: { cookie: cookie ?? (await adminCookie()) } }), params: {}, context: {} });
  const summary = async (lista: string) => (await (await call(`resumen=1&lista=${lista}`)).json()) as { count: number; excluded: number };
  const emails = async (lista: string) => {
    const text = await (await call(`lista=${lista}`)).text();
    return text.split("\n").slice(1).filter(Boolean).map((l) => l.split(",")[0].replace(/"/g, ""));
  };

  it("«ya compraron»: solo los que aceptaron; los demás se cuentan aparte", async () => {
    const acepto = await makeUser("acepto@correo.com", { marketingOptInAt: NOW() });
    const noAcepto = await makeUser("no@correo.com");
    await makeOrder({ user: acepto._id, email: acepto.email });
    await makeOrder({ user: noAcepto._id, email: noAcepto.email });
    expect(await emails("compraron")).toEqual(["acepto@correo.com"]);
    expect(await summary("compraron")).toEqual({ count: 1, excluded: 1 });
  });

  it("no cuenta como compra un pedido cancelado o reembolsado", async () => {
    const user = await makeUser("a@correo.com", { marketingOptInAt: NOW() });
    await makeOrder({ user: user._id, email: user.email, status: "cancelled" });
    await makeOrder({ user: user._id, email: user.email, status: "refunded" });
    expect(await emails("compraron")).toEqual([]);
    expect(await emails("sin-compra")).toEqual(["a@correo.com"]);
  });

  it("«se registraron y no han comprado»: cuentas y lista de espera sin pedidos", async () => {
    await makeUser("cuenta@correo.com", { marketingOptInAt: NOW() });
    await LeadModel.create({ email: "lista@correo.com", marketingOptInAt: NOW() });
    await LeadModel.create({ email: "sinpermiso@correo.com" });
    const comprador = await makeUser("compro@correo.com", { marketingOptInAt: NOW() });
    await makeOrder({ user: comprador._id, email: comprador.email });
    expect(await emails("sin-compra")).toEqual(["cuenta@correo.com", "lista@correo.com"]);
    expect(await summary("sin-compra")).toEqual({ count: 2, excluded: 1 });
  });

  it("una cuenta sin confirmar su correo no sale aunque haya marcado la casilla", async () => {
    await makeUser("pendiente@correo.com", { marketingOptInAt: NOW(), emailVerifiedAt: undefined });
    expect(await emails("sin-compra")).toEqual([]);
    expect(await summary("sin-compra")).toEqual({ count: 0, excluded: 1 });
  });

  it("el permiso dado en la lista de espera también vale para la cuenta con ese mismo correo", async () => {
    await makeUser("ana@correo.com");
    await LeadModel.create({ email: "ana@correo.com", marketingOptInAt: NOW() });
    expect(await emails("sin-compra")).toEqual(["ana@correo.com"]);
  });

  it("un comprador sin cuenta sale solo si dio su permiso; las ventas manuales sin correo nunca", async () => {
    await makeOrder({ email: "visita@correo.com" });
    await LeadModel.create({ email: "visita@correo.com", marketingOptInAt: NOW(), status: "converted" });
    await makeOrder({ email: "otra@correo.com" });
    await makeOrder({ email: "", source: "manual" });
    expect(await emails("compraron")).toEqual(["visita@correo.com"]);
    expect(await summary("compraron")).toEqual({ count: 1, excluded: 1 });
  });

  it("«dejaron el carrito»: iniciaron el pago hace poco y no compraron después", async () => {
    const dejo = await makeUser("dejo@correo.com", { marketingOptInAt: NOW() });
    const compro = await makeUser("compro@correo.com", { marketingOptInAt: NOW() });
    const viejo = await makeUser("viejo@correo.com", { marketingOptInAt: NOW() });
    const dayAgo = new Date(Date.now() - 86400000);
    await AnalyticsEventModel.create({ type: "begin_checkout", sessionId: "s1", userId: dejo._id, email: dejo.email, createdAt: dayAgo });
    await AnalyticsEventModel.create({ type: "begin_checkout", sessionId: "s2", userId: compro._id, email: compro.email, createdAt: dayAgo });
    await makeOrder({ user: compro._id, email: compro.email });
    await AnalyticsEventModel.create({ type: "begin_checkout", sessionId: "s3", userId: viejo._id, email: viejo.email, createdAt: new Date(Date.now() - 30 * 86400000) });
    expect(await emails("carrito")).toEqual(["dejo@correo.com"]);
  });

  it("«auto-envío activo»: solo suscripciones vigentes", async () => {
    const activa = await makeUser("activa@correo.com", { marketingOptInAt: NOW() });
    const cancelada = await makeUser("cancelada@correo.com", { marketingOptInAt: NOW() });
    const base = { stripeCustomerId: "cus_x", frequency: "4-semanas", items: [{ sku: "A", name: "A", quantity: 1, unitPriceMxn: 1 }], stripeSubscriptionId: "sub_x" };
    await SubscriptionModel.create({ ...base, user: activa._id, status: "active", stripeSubscriptionId: "sub_1" });
    await SubscriptionModel.create({ ...base, user: cancelada._id, status: "cancelled", stripeSubscriptionId: "sub_2" });
    expect(await emails("auto-envio")).toEqual(["activa@correo.com"]);
  });

  it("el equipo (administradores) nunca entra a una lista", async () => {
    await makeUser("jefe@correo.com", { role: "admin", marketingOptInAt: NOW() });
    expect(await emails("sin-compra")).toEqual([]);
  });

  it("el archivo trae correo, nombre, origen, registro, pedidos, última compra, total y cuándo aceptó", async () => {
    const user = await makeUser("ana@correo.com", { marketingOptInAt: new Date("2026-03-05T18:00:00Z") });
    await makeOrder({ user: user._id, email: user.email, netAmount: 250.5, createdAt: new Date("2026-04-10T18:00:00Z") });
    await makeOrder({ user: user._id, email: user.email, netAmount: 100, createdAt: new Date("2026-05-02T18:00:00Z") });
    const response = await call("lista=compraron");
    expect(response.headers.get("content-disposition")).toMatch(/campana-compraron_\d{4}-\d{2}-\d{2}\.csv/);
    const [header, line] = (await response.text()).split("\n");
    expect(header).toBe("email,nombre,origen,registro,pedidos,ultima_compra,total_gastado,acepto_el");
    const cells = line.split(",").map((c) => c.replace(/"/g, ""));
    expect(cells[0]).toBe("ana@correo.com");
    expect(cells[2]).toBe("Cuenta");
    expect(cells.slice(4)).toEqual(["2", "2026-05-02", "350.50", "2026-03-05"]);
  });

  it("una lista inventada se rechaza, y solo un administrador puede pedir cualquiera", async () => {
    expect((await call("lista=todos")).status).toBe(400);
    await makeUser("cliente@correo.com");
    const customer = await UserModel.findOne({ email: "cliente@correo.com" });
    const customerCookie = await cookieFor(customer!._id);
    for (const cookie of ["", customerCookie]) {
      const seen = await outcomeOf(() => call("lista=compraron", cookie));
      expect((seen as Response).status).not.toBe(200);
    }
  });
});
