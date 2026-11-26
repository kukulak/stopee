import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse } from "../helpers/http";

type Args = { request: Request; params: object; context: object };
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
 * Cada cupón es para clientes, para aliados (Puntos de Recarga) o para los dos. Se prueba en el carrito
 * (lo que ve la persona) y al pagar (lo que se cobra), con el mismo resultado, y en el formulario del admin.
 */
describe.skipIf(!hasTestDb)("cupones por público", () => {
  let carrito: Handler;
  let checkout: Handler;
  let stripe: typeof import("~/lib/stripe.server").stripe;
  let cartStorage: typeof import("~/lib/cart.server").cartStorage;
  let sessionStorage: typeof import("~/lib/session.server").sessionStorage;
  let ProductModel: typeof import("~/models/product.server").ProductModel;
  let PromotionModel: typeof import("~/models/promotion.server").PromotionModel;
  let UserModel: typeof import("~/models/user.server").UserModel;
  let SiteSettingsModel: typeof import("~/models/siteSettings.server").SiteSettingsModel;
  let build: typeof import("~/lib/promotionForm.server").buildPromotionDocFromFormData;
  let createSession: MockInstance;
  let createCoupon: MockInstance;

  beforeAll(async () => {
    assertDisposableDb();
    carrito = asResponse(((await import("~/routes/api.carrito")) as never as { loader: Handler }).loader);
    checkout = asResponse(((await import("~/routes/api.checkout")) as never as { action: Handler }).action);
    ({ stripe } = await import("~/lib/stripe.server"));
    ({ cartStorage } = await import("~/lib/cart.server"));
    ({ sessionStorage } = await import("~/lib/session.server"));
    ({ ProductModel } = await import("~/models/product.server"));
    ({ PromotionModel } = await import("~/models/promotion.server"));
    ({ UserModel } = await import("~/models/user.server"));
    ({ SiteSettingsModel } = await import("~/models/siteSettings.server"));
    ({ buildPromotionDocFromFormData: build } = await import("~/lib/promotionForm.server"));
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
    createCoupon = vi.spyOn(stripe.coupons, "create").mockResolvedValue({ id: "coupon_test_1" } as never);
    await SiteSettingsModel.create({ isStoreActive: true });
    await ProductModel.create({ name: "Concentrado 1L", sku: "CONC-1L", price: 400, stock: 20 });
  });

  let n = 0;
  const makeUser = (over: Record<string, unknown> = {}) =>
    UserModel.create({ email: `u${++n}@x.com`, passwordHash: "x", emailVerifiedAt: new Date(), ...over });
  const makeAlly = () => makeUser({ isRefillAlly: true, allyStation: { businessName: "Vet", neighborhood: "Roma" } });
  const coupon = (rules: Record<string, unknown>) =>
    PromotionModel.create({ name: "Cupón", type: "coupon", isActive: true, coupon: { code: "PRUEBA", percentage: 10, ...rules } });

  async function cookie(user?: { _id: unknown }) {
    const c = await cartStorage.getSession();
    c.set("items", [{ sku: "CONC-1L", quantity: 1 }]);
    c.set("couponCode", "PRUEBA");
    const parts = [(await cartStorage.commitSession(c)).split(";")[0]];
    if (user) {
      const s = await sessionStorage.getSession();
      s.set("userId", String(user._id));
      s.set("iat", Date.now());
      parts.push((await sessionStorage.commitSession(s)).split(";")[0]);
    }
    return parts.join("; ");
  }

  let ip = 0;
  async function cartFor(user?: { _id: unknown }) {
    const response = await carrito({
      request: new Request("https://stopee.test/api/carrito", { headers: { cookie: await cookie(user) } }),
      params: {},
      context: {},
    });
    return (await response.json()) as { coupon: { code: string } | null; discountPercent: number; couponNotice: { message: string; cta: string | null } | null };
  }
  async function pay(user?: { _id: unknown }) {
    return checkout({
      request: new Request("https://stopee.test/api/checkout", {
        method: "POST",
        headers: { cookie: await cookie(user), "x-forwarded-for": `172.30.0.${++ip}` },
        body: new URLSearchParams(VALID_ADDRESS),
      }),
      params: {},
      context: {},
    });
  }

  it("un cupón solo para clientes: el cliente lo recibe y el aliado no, en el carrito y al pagar", async () => {
    await coupon({ forCustomers: true, forAllies: false });
    const customer = await makeUser();
    const ally = await makeAlly();

    expect((await cartFor(customer)).discountPercent).toBe(10);
    expect((await cartFor()).discountPercent).toBe(10); // una visita cuenta como cliente

    const asAlly = await cartFor(ally);
    expect(asAlly.coupon).toBeNull();
    expect(asAlly.discountPercent).toBe(0);
    expect(asAlly.couponNotice?.message).toMatch(/para clientes/);

    expect((await pay(customer)).status).toBe(302);
    createSession.mockClear();
    const blocked = await pay(ally);
    expect(blocked.status).toBe(400);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/para clientes/);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("un cupón solo para aliados: el aliado lo recibe; el cliente, no; y la visita debe iniciar sesión", async () => {
    await coupon({ forCustomers: false, forAllies: true });
    const customer = await makeUser();
    const ally = await makeAlly();

    expect((await cartFor(ally)).discountPercent).toBe(10);

    const asCustomer = await cartFor(customer);
    expect(asCustomer.coupon).toBeNull();
    expect(asCustomer.couponNotice?.message).toMatch(/solo para Puntos de Recarga/);

    const asVisitor = await cartFor();
    expect(asVisitor.coupon).toBeNull();
    expect(asVisitor.couponNotice?.cta).toBe("login");

    expect((await pay(ally)).status).toBe(302);
    createSession.mockClear();
    expect((await pay(customer)).status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("un cupón para los dos lo recibe cualquiera", async () => {
    await coupon({ forCustomers: true, forAllies: true });
    for (const who of [undefined, await makeUser(), await makeAlly()]) {
      expect((await cartFor(who)).discountPercent).toBe(10);
    }
  });

  it("un cupón anterior a la opción (sin el dato) sigue funcionando para todos", async () => {
    await coupon({});
    for (const who of [undefined, await makeUser(), await makeAlly()]) {
      expect((await cartFor(who)).discountPercent).toBe(10);
    }
    expect((await pay(await makeAlly())).status).toBe(302);
    expect((createCoupon.mock.calls[0]?.[0] as { percent_off?: number }).percent_off).toBe(10);
  });

  it("al desactivar a un aliado, el cupón de aliados deja de valerle de inmediato", async () => {
    await coupon({ forCustomers: false, forAllies: true });
    const ally = await makeAlly();
    expect((await cartFor(ally)).discountPercent).toBe(10);
    await UserModel.updateOne({ _id: ally._id }, { $set: { isRefillAlly: false } });
    expect((await cartFor(ally)).discountPercent).toBe(0);
  });

  describe("formulario del admin", () => {
    const asFormData = (fields: Record<string, string>) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ name: "Cupón", type: "coupon", code: "NUEVO", percentage: "10", ...fields })) fd.set(k, v);
      return fd;
    };

    it("exige elegir al menos un público", async () => {
      const result = await build(asFormData({}));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.error).toMatch(/para quién es el cupón/);
      }
    });

    it("guarda solo clientes, solo aliados o los dos según las casillas", async () => {
      const onlyCustomers = await build(asFormData({ couponForCustomers: "on" }));
      const onlyAllies = await build(asFormData({ couponForAllies: "on", code: "ALIADOS" }));
      const both = await build(asFormData({ couponForCustomers: "on", couponForAllies: "on", code: "AMBOS" }));
      const coupons = [onlyCustomers, onlyAllies, both].map((r) => (r.ok ? (r.doc.coupon as { forCustomers: boolean; forAllies: boolean }) : null));
      expect(coupons.map((c) => [c?.forCustomers, c?.forAllies])).toEqual([
        [true, false],
        [false, true],
        [true, true],
      ]);
    });
  });
});
