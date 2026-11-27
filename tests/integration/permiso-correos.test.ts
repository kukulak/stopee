import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse } from "../helpers/http";

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/mail.server", () => ({ sendEmail, isMailConfigured: () => true }));

type Args = { request: Request; params: object; context: object };
type Action = (args: Args) => Promise<Response>;

const VALID_ADDRESS: Record<string, string> = {
  shipName: "Ana Pérez",
  shipPhone: "55 1234 5678",
  shipLine1: "Av. Insurgentes Sur 123",
  shipLine2: "Col. Del Valle",
  shipCity: "Benito Juárez",
  shipPostalCode: "03100",
};

/** El permiso para mandar promociones por correo: dónde se pide, dónde se guarda y que nadie quede apuntado sin querer. */
describe.skipIf(!hasTestDb)("permiso para recibir correos", () => {
  let registro: Action;
  let cuenta: Action;
  let checkout: Action;
  let webhook: Action;
  let home: Action;
  let stripe: typeof import("~/lib/stripe.server").stripe;
  let cartStorage: typeof import("~/lib/cart.server").cartStorage;
  let sessionStorage: typeof import("~/lib/session.server").sessionStorage;
  let UserModel: typeof import("~/models/user.server").UserModel;
  let LeadModel: typeof import("~/models/lead.server").LeadModel;
  let ProductModel: typeof import("~/models/product.server").ProductModel;
  let SiteSettingsModel: typeof import("~/models/siteSettings.server").SiteSettingsModel;
  let createSession: MockInstance;
  let ip = 0;

  beforeAll(async () => {
    assertDisposableDb();
    registro = asResponse(((await import("~/routes/cuenta_.registro")) as never as { action: Action }).action);
    cuenta = asResponse(((await import("~/routes/cuenta")) as never as { action: Action }).action);
    checkout = asResponse(((await import("~/routes/api.checkout")) as never as { action: Action }).action);
    webhook = asResponse(((await import("~/routes/webhooks.stripe")) as never as { action: Action }).action);
    home = asResponse(((await import("~/routes/_index")) as never as { action: Action }).action);
    ({ stripe } = await import("~/lib/stripe.server"));
    ({ cartStorage } = await import("~/lib/cart.server"));
    ({ sessionStorage } = await import("~/lib/session.server"));
    ({ UserModel } = await import("~/models/user.server"));
    ({ LeadModel } = await import("~/models/lead.server"));
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
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ ok: true });
    createSession = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" } as never);
    await SiteSettingsModel.create({ isStoreActive: true });
    await ProductModel.create({ name: "Concentrado 1L", sku: "CONC-1L", price: 399, stock: 20 });
  });

  const freshIp = () => `10.20.${(++ip >> 8) & 255}.${ip & 255}`;
  const loginCookie = async (userId: unknown) => {
    const s = await sessionStorage.getSession();
    s.set("userId", String(userId));
    s.set("iat", Date.now());
    return (await sessionStorage.commitSession(s)).split(";")[0];
  };
  const makeUser = (over: Record<string, unknown> = {}) =>
    UserModel.create({ email: "ana@correo.com", passwordHash: "x", emailVerifiedAt: new Date(), ...over });
  const form = (url: string, fields: Record<string, string>, cookie = "") =>
    ({
      request: new Request(url, {
        method: "POST",
        headers: { cookie, origin: new URL(url).origin, "x-forwarded-for": freshIp() },
        body: new URLSearchParams(fields),
      }),
      params: {},
      context: {},
    }) satisfies Args;

  describe("al crear la cuenta", () => {
    const signUp = (email: string, extra: Record<string, string> = {}) =>
      registro(form("https://stopee.test/cuenta/registro", { email, password: "Perrito-Feliz-2031", confirmPassword: "Perrito-Feliz-2031", ...extra }));

    it("sin marcar la casilla no queda ningún permiso", async () => {
      await signUp("luis@correo.com");
      expect((await UserModel.findOne({ email: "luis@correo.com" }).lean())!.marketingOptInAt).toBeUndefined();
    });

    it("marcada, guarda la fecha en que lo aceptó", async () => {
      await signUp("luis@correo.com", { marketing: "on" });
      const user = (await UserModel.findOne({ email: "luis@correo.com" }).lean())!;
      expect(user.marketingOptInAt).toBeInstanceOf(Date);
      expect(user.emailVerifiedAt).toBeUndefined();
    });

    it("registrarse con el correo de alguien que ya tiene cuenta no cambia su permiso", async () => {
      await makeUser({ email: "ana@correo.com" });
      await signUp("ana@correo.com", { marketing: "on" });
      expect((await UserModel.findOne({ email: "ana@correo.com" }).lean())!.marketingOptInAt).toBeUndefined();
    });
  });

  describe("en Mi cuenta", () => {
    const toggle = async (userId: unknown, marketing: "on" | "off") =>
      cuenta(form("https://stopee.test/cuenta", { intent: "marketing-update", marketing }, await loginCookie(userId)));

    it("se puede aceptar y retirar, y al aceptar otra vez se conserva la fecha original", async () => {
      const user = await makeUser();
      await toggle(user._id, "on");
      const first = (await UserModel.findById(user._id).lean())!.marketingOptInAt!;
      expect(first).toBeInstanceOf(Date);

      await new Promise((r) => setTimeout(r, 15));
      await toggle(user._id, "on");
      expect((await UserModel.findById(user._id).lean())!.marketingOptInAt!.getTime()).toBe(first.getTime());

      await toggle(user._id, "off");
      expect((await UserModel.findById(user._id).lean())!.marketingOptInAt).toBeUndefined();
    });

    it("dejar de recibir también retira el permiso de la lista de espera con ese correo", async () => {
      const user = await makeUser({ email: "ana@correo.com", marketingOptInAt: new Date() });
      await LeadModel.create({ email: "ana@correo.com", marketingOptInAt: new Date() });
      await toggle(user._id, "off");
      expect((await LeadModel.findOne({ email: "ana@correo.com" }).lean())!.marketingOptInAt).toBeUndefined();
    });

    it("cada quien cambia solo lo suyo", async () => {
      const ana = await makeUser({ email: "ana@correo.com" });
      const luis = await makeUser({ email: "luis@correo.com", marketingOptInAt: new Date() });
      await toggle(ana._id, "on");
      expect((await UserModel.findById(luis._id).lean())!.marketingOptInAt).toBeInstanceOf(Date);
      await toggle(ana._id, "off");
      expect((await UserModel.findById(luis._id).lean())!.marketingOptInAt).toBeInstanceOf(Date);
    });
  });

  describe("al ir a pagar", () => {
    async function pay(fields: Record<string, string>, userId?: unknown) {
      const cart = await cartStorage.getSession();
      cart.set("items", [{ sku: "CONC-1L", quantity: 1 }]);
      const cookies = [(await cartStorage.commitSession(cart)).split(";")[0]];
      if (userId) cookies.push(await loginCookie(userId));
      return checkout(form("https://stopee.test/api/checkout", { ...VALID_ADDRESS, ...fields }, cookies.join("; ")));
    }

    it("con cuenta y la casilla marcada, queda el permiso en su cuenta", async () => {
      const user = await makeUser();
      await pay({ marketing: "on" }, user._id);
      expect((await UserModel.findById(user._id).lean())!.marketingOptInAt).toBeInstanceOf(Date);
    });

    it("con cuenta y sin marcar, no se guarda nada", async () => {
      const user = await makeUser();
      await pay({}, user._id);
      expect((await UserModel.findById(user._id).lean())!.marketingOptInAt).toBeUndefined();
    });

    it("sin cuenta, la elección viaja a Stripe en la metadata y todavía no apunta a nadie", async () => {
      await pay({ marketing: "on" });
      const metadata = (createSession.mock.calls[0][0] as { metadata: Record<string, string> }).metadata;
      expect(metadata.marketingOptIn).toBe("true");
      expect(await LeadModel.countDocuments()).toBe(0);
    });

    it("sin cuenta y sin marcar, la metadata no lleva permiso", async () => {
      await pay({});
      expect((createSession.mock.calls[0][0] as { metadata: Record<string, string> }).metadata.marketingOptIn).toBe("");
    });
  });

  describe("cuando se confirma el pago de alguien sin cuenta", () => {
    const pagado = (marketingOptIn: string, email = "visita@correo.com") => {
      const event = {
        id: `evt_${Math.random()}`,
        object: "event",
        api_version: "2025-02-24.acacia",
        created: Math.floor(Date.now() / 1000),
        type: "checkout.session.completed",
        data: {
          object: {
            id: `cs_${Math.random()}`,
            object: "checkout.session",
            mode: "payment",
            status: "complete",
            payment_status: "paid",
            payment_intent: "pi_test",
            amount_total: 39900,
            customer_details: { email },
            metadata: { cartSkus: "CONC-1L:1:399", shippingCost: "0", userId: "guest", marketingOptIn },
          },
        },
      };
      const payload = JSON.stringify(event);
      const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
      return webhook({
        request: new Request("https://stopee.test/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature }, body: payload }),
        params: {},
        context: {},
      });
    };

    it("si marcó la casilla queda en la lista con la fecha del permiso", async () => {
      await pagado("true");
      const lead = (await LeadModel.findOne({ email: "visita@correo.com" }).lean())!;
      expect(lead).toMatchObject({ status: "converted", source: "other" });
      expect(lead.marketingOptInAt).toBeInstanceOf(Date);
    });

    it("si no la marcó, no se guarda su correo en la lista", async () => {
      await pagado("");
      expect(await LeadModel.countDocuments()).toBe(0);
    });

    it("si ya estaba en la lista, solo se le agrega el permiso (conserva su fecha de registro)", async () => {
      const antes = new Date("2026-01-01T00:00:00Z");
      await LeadModel.create({ email: "visita@correo.com", registeredAt: antes });
      await pagado("true");
      const lead = (await LeadModel.findOne({ email: "visita@correo.com" }).lean())!;
      expect(lead.registeredAt.toISOString()).toBe(antes.toISOString());
      expect(lead.marketingOptInAt).toBeInstanceOf(Date);
    });
  });

  describe("en la lista de espera de la portada", () => {
    const join = (email: string) => home(form("https://stopee.test/", { email }));

    it("quien se apunta queda con el permiso (el formulario lo dice)", async () => {
      await join("nueva@correo.com");
      expect((await LeadModel.findOne({ email: "nueva@correo.com" }).lean())!.marketingOptInAt).toBeInstanceOf(Date);
    });

    it("quien ya estaba sin permiso y vuelve a apuntarse queda con permiso nuevo", async () => {
      await LeadModel.create({ email: "vieja@correo.com" });
      await join("vieja@correo.com");
      expect((await LeadModel.findOne({ email: "vieja@correo.com" }).lean())!.marketingOptInAt).toBeInstanceOf(Date);
    });
  });
});
