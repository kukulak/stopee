import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse, outcomeOf } from "../helpers/http";

type Action = (args: { request: Request; params: object; context: object }) => Promise<Response>;

/**
 * "Ir a pagar" es donde se decide cuánto se cobra. Estas pruebas ejecutan la ruta de verdad contra
 * un Mongo desechable y solo sustituyen a Stripe (se registra qué se le pide cobrar), para verificar
 * que todo se recalcula en el servidor: el navegador nunca decide un precio, un descuento ni un envío.
 */
describe.skipIf(!hasTestDb)("ir a pagar", () => {
  let checkout: Action;
  let stripe: typeof import("~/lib/stripe.server").stripe;
  let cartStorage: typeof import("~/lib/cart.server").cartStorage;
  let sessionStorage: typeof import("~/lib/session.server").sessionStorage;
  let saveShippingConfig: typeof import("~/models/shipping.server").saveShippingConfig;
  let DEFAULT_SHIPPING_CONFIG: typeof import("~/models/shipping.server").DEFAULT_SHIPPING_CONFIG;
  let SiteSettingsModel: typeof import("~/models/siteSettings.server").SiteSettingsModel;
  let ProductModel: typeof import("~/models/product.server").ProductModel;
  let BundleModel: typeof import("~/models/bundle.server").BundleModel;
  let PromotionModel: typeof import("~/models/promotion.server").PromotionModel;
  let UserModel: typeof import("~/models/user.server").UserModel;
  let OrderModel: typeof import("~/models/order.server").OrderModel;
  let connectDB: typeof import("~/lib/db.server").connectDB;
  let createSession: MockInstance;
  let createCoupon: MockInstance;

  beforeAll(async () => {
    assertDisposableDb();
    checkout = asResponse(((await import("~/routes/api.checkout")) as never as { action: Action }).action);
    ({ stripe } = await import("~/lib/stripe.server"));
    ({ cartStorage } = await import("~/lib/cart.server"));
    ({ sessionStorage } = await import("~/lib/session.server"));
    ({ saveShippingConfig, DEFAULT_SHIPPING_CONFIG } = await import("~/models/shipping.server"));
    ({ SiteSettingsModel } = await import("~/models/siteSettings.server"));
    ({ ProductModel } = await import("~/models/product.server"));
    ({ BundleModel } = await import("~/models/bundle.server"));
    ({ PromotionModel } = await import("~/models/promotion.server"));
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
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    createSession = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" } as never);
    createCoupon = vi.spyOn(stripe.coupons, "create").mockResolvedValue({ id: "coupon_test_1" } as never);

    await SiteSettingsModel.create({ isStoreActive: true });
    await ProductModel.create({ name: "Concentrado 1L", sku: "CONC-1L", price: 399, stock: 20 });
    await ProductModel.create({ name: "Atomizador", sku: "ATOM", price: 99, stock: 20 });
  });

  // --- Ayudas --------------------------------------------------------------

  let ipCounter = 0;
  const freshIp = () => `172.16.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

  type Cart = { items?: { sku: string; quantity: number }[]; couponCode?: string; shippingMethod?: string };

  async function cartCookie({ items, couponCode, shippingMethod }: Cart) {
    const s = await cartStorage.getSession();
    if (items) s.set("items", items);
    if (couponCode) s.set("couponCode", couponCode);
    if (shippingMethod) s.set("shippingMethod", shippingMethod);
    return (await cartStorage.commitSession(s)).split(";")[0];
  }

  async function loginCookie(userId: unknown) {
    const s = await sessionStorage.getSession();
    s.set("userId", String(userId));
    s.set("iat", Date.now());
    return (await sessionStorage.commitSession(s)).split(";")[0];
  }

  /** Dirección válida (Benito Juárez, CDMX): se manda en todos los pagos salvo que una prueba la cambie. */
  const VALID_ADDRESS: Record<string, string> = {
    shipName: "Ana Pérez",
    shipPhone: "55 1234 5678",
    shipLine1: "Av. Insurgentes Sur 123",
    shipLine2: "Col. Del Valle",
    shipCity: "Benito Juárez",
    shipPostalCode: "03100",
  };

  async function pay(cart: Cart, opts: { user?: unknown; ip?: string; body?: Record<string, string> } = {}) {
    const cookies = [await cartCookie(cart)];
    if (opts.user) cookies.push(await loginCookie(opts.user));
    const request = new Request("https://stopee.test/api/checkout", {
      method: "POST",
      headers: { cookie: cookies.join("; "), "x-forwarded-for": opts.ip ?? freshIp() },
      body: new URLSearchParams({ ...VALID_ADDRESS, ...(opts.body ?? {}) }),
    });
    return checkout({ request, params: {}, context: {} });
  }

  /** Respuesta o excepción: la ruta lanza el 403 de "tienda no disponible" en vez de devolverlo. */
  async function payOutcome(...args: Parameters<typeof pay>) {
    return outcomeOf(() => pay(...args));
  }

  /** Lo que se le pidió cobrar a Stripe en la única llamada que debió hacerse. */
  function charged() {
    expect(createSession).toHaveBeenCalledTimes(1);
    return createSession.mock.calls[0][0] as {
      mode: string;
      customer_email?: string;
      line_items: { price_data: { unit_amount: number; currency: string; product_data: { name: string } }; quantity: number }[];
      shipping_options?: { shipping_rate_data: { fixed_amount: { amount: number }; display_name: string } }[];
      discounts?: { coupon: string }[];
      metadata: Record<string, string>;
    };
  }

  const percentOff = () => (createCoupon.mock.calls[0]?.[0] as { percent_off?: number } | undefined)?.percent_off;

  const makeCoupon = (rules: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    PromotionModel.create({
      name: "Cupón de prueba",
      type: "coupon",
      isActive: true,
      coupon: { code: "VERANO10", percentage: 10, ...rules },
      ...extra,
    });

  const makeUser = (overrides: Record<string, unknown> = {}) =>
    UserModel.create({ email: "ana@correo.com", passwordHash: "x", emailVerifiedAt: new Date(), ...overrides });

  // --- Zona de entrega y dirección ----------------------------------------------

  describe("zona de entrega y dirección", () => {
    const oneItem = { items: [{ sku: "CONC-1L", quantity: 1 }] };
    const errorsOf = async (response: Response) => (await response.json()) as { error?: string; fieldErrors?: Record<string, string> };

    it("un código postal fuera de la Ciudad de México no puede pagar: 400 y Stripe ni se entera", async () => {
      const response = await pay(oneItem, { body: { shipPostalCode: "64000" } });
      expect(response.status).toBe(400);
      const body = await errorsOf(response);
      expect(body.error).toMatch(/solo entregamos en Ciudad de México/);
      expect(body.fieldErrors?.postalCode).toBeTruthy();
      expect(createSession).not.toHaveBeenCalled();
      expect(createCoupon).not.toHaveBeenCalled();
    });

    it("el estado que diga el navegador no importa: manda el código postal (no se puede disfrazar Monterrey de CDMX)", async () => {
      const response = await pay(oneItem, { body: { shipPostalCode: "64000", shipState: "Ciudad de México", shipCity: "Benito Juárez" } });
      expect(response.status).toBe(400);
      expect(createSession).not.toHaveBeenCalled();
    });

    it("sin dirección (alguien que se salta el formulario) tampoco paga", async () => {
      const request = new Request("https://stopee.test/api/checkout", {
        method: "POST",
        headers: { cookie: await cartCookie({ ...oneItem, shippingMethod: "home" }), "x-forwarded-for": freshIp() },
        body: new URLSearchParams({}),
      });
      const response = await checkout({ request, params: {}, context: {} });
      expect(response.status).toBe(400);
      const body = await errorsOf(response);
      expect(Object.keys(body.fieldErrors ?? {})).toEqual(expect.arrayContaining(["name", "phone", "postalCode", "line1", "city"]));
      expect(createSession).not.toHaveBeenCalled();
    });

    it("en la zona, la dirección va a Stripe: anotada en el pago, en metadata, y Stripe ya no la vuelve a pedir", async () => {
      const response = await pay(oneItem);
      expect(response.status).toBe(302);
      const call = charged() as unknown as {
        shipping_address_collection?: unknown;
        phone_number_collection?: unknown;
        payment_intent_data?: { shipping: { name: string; phone: string; address: Record<string, string> } };
        metadata: Record<string, string>;
      };
      expect(call.shipping_address_collection).toBeUndefined();
      expect(call.phone_number_collection).toBeUndefined();
      expect(call.payment_intent_data?.shipping).toMatchObject({
        name: "Ana Pérez",
        phone: "5512345678",
        address: { line1: "Av. Insurgentes Sur 123", city: "Benito Juárez", state: "Ciudad de México", postal_code: "03100", country: "MX" },
      });
      expect(call.metadata).toMatchObject({
        shipName: "Ana Pérez",
        shipPhone: "5512345678",
        shipLine1: "Av. Insurgentes Sur 123",
        shipCity: "Benito Juárez",
        shipState: "Ciudad de México",
        shipPostalCode: "03100",
      });
    });

    it("acepta el código postal escrito con 4 dígitos y lo guarda con 5", async () => {
      const response = await pay(oneItem, { body: { shipPostalCode: "3100" } });
      expect(response.status).toBe(302);
      expect(charged().metadata.shipPostalCode).toBe("03100");
    });

    it("punto de entrega: basta nombre, teléfono y código postal (sin calle)", async () => {
      const response = await pay(
        { ...oneItem, shippingMethod: "pickup" },
        { body: { shipLine1: "", shipLine2: "", shipCity: "" } },
      );
      expect(response.status).toBe(302);
      expect(charged().metadata.shippingMethod).toBe("pickup");
    });

    it("a domicilio sí exige calle y alcaldía", async () => {
      const response = await pay({ ...oneItem, shippingMethod: "home" }, { body: { shipLine1: "", shipCity: "" } });
      expect(response.status).toBe(400);
      expect((await errorsOf(response)).fieldErrors).toMatchObject({ line1: expect.any(String), city: expect.any(String) });
      expect(createSession).not.toHaveBeenCalled();
    });

    it("la zona se cambia desde el panel, sin tocar el código: con 76000-76999 Querétaro entra y la CDMX sale", async () => {
      await saveShippingConfig({
        ...DEFAULT_SHIPPING_CONFIG,
        zone: { name: "Querétaro", postalRanges: "76000-76999" },
      });
      const fuera = await pay(oneItem, { body: { shipPostalCode: "03100" } });
      expect(fuera.status).toBe(400);
      expect((await errorsOf(fuera)).error).toMatch(/solo entregamos en Querétaro/);
      expect(createSession).not.toHaveBeenCalled();

      const dentro = await pay(oneItem, { body: { shipPostalCode: "76000" } });
      expect(dentro.status).toBe(302);
      expect(charged().metadata.shipState).toBe("Querétaro");
    });

    it("la primera dirección se guarda en el perfil; si ya tenía una, no se pisa", async () => {
      const nueva = await makeUser({ email: "nueva@correo.com" });
      await pay(oneItem, { user: nueva._id });
      const guardada = await UserModel.findById(nueva._id).lean();
      expect(guardada!.address).toMatchObject({ line1: "Av. Insurgentes Sur 123", postalCode: "03100", state: "Ciudad de México" });
      expect(guardada!.phone).toBe("5512345678");

      createSession.mockClear();
      const conDireccion = await makeUser({
        email: "vieja@correo.com",
        phone: "5500000000",
        address: { line1: "Calle Vieja 9", postalCode: "06600", city: "Cuauhtémoc", state: "Ciudad de México" },
      });
      await pay(oneItem, { user: conDireccion._id, body: { shipLine1: "Calle de un regalo 1", shipPostalCode: "03100" } });
      const intacta = await UserModel.findById(conDireccion._id).lean();
      expect(intacta!.address).toMatchObject({ line1: "Calle Vieja 9", postalCode: "06600" });
      expect(intacta!.phone).toBe("5500000000");
      // La dirección del regalo no se pierde: queda guardada como secundaria, para elegirla la próxima vez.
      expect(intacta!.savedAddresses).toHaveLength(1);
      expect(intacta!.savedAddresses[0]).toMatchObject({ line1: "Calle de un regalo 1", postalCode: "03100" });

      // Pagar otra vez a la misma dirección no la duplica.
      await pay(oneItem, { user: conDireccion._id, body: { shipLine1: "Calle de un regalo 1", shipPostalCode: "03100" } });
      expect((await UserModel.findById(conDireccion._id).lean())!.savedAddresses).toHaveLength(1);
    });

    it("si guardar el perfil falla, el pago sigue adelante", async () => {
      const user = await makeUser({ email: "fallo@correo.com" });
      vi.spyOn(UserModel, "updateOne").mockRejectedValueOnce(new Error("mongo caído"));
      const response = await pay(oneItem, { user: user._id });
      expect(response.status).toBe(302);
    });
  });

  // --- Quién puede pagar -------------------------------------------------------

  describe("acceso", () => {
    it("con la tienda inactiva responde 403 y no le pide nada a Stripe", async () => {
      await SiteSettingsModel.updateMany({}, { isStoreActive: false });
      const response = await payOutcome({ items: [{ sku: "CONC-1L", quantity: 1 }] });
      expect(response.status).toBe(403);
      expect(createSession).not.toHaveBeenCalled();
    });

    it("limita a 20 intentos cada 10 minutos por IP: no se pueden fabricar sesiones de pago sin fin", async () => {
      const ip = freshIp();
      for (let i = 0; i < 20; i++) {
        const r = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] }, { ip });
        expect(r.status).toBe(302);
      }
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] }, { ip });
      expect(r.status).toBe(429);
      expect(createSession).toHaveBeenCalledTimes(20);
    });
  });

  // --- Carrito vacío o inválido -----------------------------------------------------

  describe("carrito", () => {
    it("vacío, sin carrito o con productos que ya no existen: 400 y nada se cobra", async () => {
      for (const cart of [{}, { items: [] }, { items: [{ sku: "FANTASMA", quantity: 2 }] }]) {
        const r = await pay(cart);
        expect(r.status).toBe(400);
        expect((await r.json()).error).toBe("Tu carrito está vacío.");
      }
      expect(createSession).not.toHaveBeenCalled();
    });

    it("una cookie de carrito inventada (sin la firma del servidor) cuenta como carrito vacío", async () => {
      const falsa = "__stopee_cart=" + Buffer.from(JSON.stringify({ items: [{ sku: "CONC-1L", quantity: 1, price: 1 }] })).toString("base64");
      const request = new Request("https://stopee.test/api/checkout", {
        method: "POST",
        headers: { cookie: falsa, "x-forwarded-for": freshIp() },
      });
      const r = await checkout({ request, params: {}, context: {} });
      expect(r.status).toBe(400);
      expect(createSession).not.toHaveBeenCalled();
    });

    it("un producto pausado en el catálogo ya no se puede pagar", async () => {
      await ProductModel.updateOne({ sku: "CONC-1L" }, { isAvailable: false });
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] });
      expect(r.status).toBe(400);
      expect(createSession).not.toHaveBeenCalled();
    });
  });

  // --- Precios: los manda el servidor ------------------------------------------------

  describe("precios", () => {
    it("cobra el precio del catálogo, en centavos y en pesos mexicanos, y redirige a Stripe", async () => {
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 2 }, { sku: "ATOM", quantity: 1 }] });
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_test_1");

      const sent = charged();
      expect(sent.mode).toBe("payment");
      expect(sent.line_items).toHaveLength(2);
      expect(sent.line_items[0]).toMatchObject({ quantity: 2, price_data: { currency: "mxn", unit_amount: 39900, product_data: { name: "Concentrado 1L" } } });
      expect(sent.line_items[1]).toMatchObject({ quantity: 1, price_data: { unit_amount: 9900 } });
      expect(sent.metadata.cartSkus).toBe("CONC-1L:2:399,ATOM:1:99");
    });

    it("si el precio cambia en el catálogo, se cobra el nuevo (nunca uno guardado en el carrito)", async () => {
      await ProductModel.updateOne({ sku: "CONC-1L" }, { price: 450 });
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] });
      expect(charged().line_items[0].price_data.unit_amount).toBe(45000);
    });

    it("ignora cualquier precio, monto, descuento o envío que el navegador intente mandar en el formulario", async () => {
      await pay(
        { items: [{ sku: "CONC-1L", quantity: 1 }] },
        { body: { price: "1", amount: "1", unitPriceMxn: "1", unit_amount: "1", discountPercent: "100", shippingCost: "0", total: "1" } },
      );
      const sent = charged();
      expect(sent.line_items[0].price_data.unit_amount).toBe(39900);
      expect(sent.discounts).toBeUndefined();
      expect(sent.shipping_options![0].shipping_rate_data.fixed_amount.amount).toBe(6900);
    });

    it("un paquete se cobra a su precio de paquete", async () => {
      const [a, b] = await Promise.all([ProductModel.findOne({ sku: "CONC-1L" }), ProductModel.findOne({ sku: "ATOM" })]);
      await BundleModel.create({
        name: "Kit inicial",
        sku: "kit-inicial",
        bundlePrice: 420,
        products: [
          { product: a!._id, quantity: 1 },
          { product: b!._id, quantity: 1 },
        ],
      });
      await pay({ items: [{ sku: "kit-inicial", quantity: 1 }] });
      expect(charged().line_items[0].price_data.unit_amount).toBe(42000);
    });
  });

  // --- Existencias --------------------------------------------------------------------

  describe("existencias", () => {
    it("un producto agotado no se cobra", async () => {
      await ProductModel.updateOne({ sku: "CONC-1L" }, { stock: 0 });
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/agotado/);
      expect(createSession).not.toHaveBeenCalled();
    });

    it("no deja pagar más de lo que hay", async () => {
      await ProductModel.updateOne({ sku: "CONC-1L" }, { stock: 3 });
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 4 }] });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/Solo hay 3 unidades/);
      expect(createSession).not.toHaveBeenCalled();
    });

    it("pagar exactamente lo que hay sí se permite", async () => {
      await ProductModel.updateOne({ sku: "CONC-1L" }, { stock: 3 });
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 3 }] });
      expect(r.status).toBe(302);
    });

    it("un paquete alcanza según el componente que menos rinde", async () => {
      const a = await ProductModel.findOne({ sku: "CONC-1L" });
      await ProductModel.updateOne({ sku: "CONC-1L" }, { stock: 5 });
      await BundleModel.create({ name: "Doble", sku: "doble", bundlePrice: 700, products: [{ product: a!._id, quantity: 2 }] });

      expect((await pay({ items: [{ sku: "doble", quantity: 3 }] })).status).toBe(400); // 5 piezas / 2 por paquete = 2 paquetes
      expect((await pay({ items: [{ sku: "doble", quantity: 2 }] })).status).toBe(302);
    });
  });

  // --- Cupones --------------------------------------------------------------------------

  describe("cupones", () => {
    it("aplica el porcentaje del cupón, sin importar mayúsculas en el código guardado", async () => {
      await makeCoupon();
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: "verano10" });
      expect(percentOff()).toBe(10);
      expect(charged().discounts).toEqual([{ coupon: "coupon_test_1" }]);
      expect(charged().metadata.promotionType).toBe("coupon");
    });

    it("un código que no existe, vencido, apagado o agotado no descuenta nada (y no impide pagar)", async () => {
      const dia = 24 * 3600 * 1000;
      await makeCoupon({ code: "VENCIDO" }, { endsAt: new Date(Date.now() - dia) });
      await makeCoupon({ code: "FUTURO" }, { startsAt: new Date(Date.now() + dia) });
      await makeCoupon({ code: "APAGADO" }, { isActive: false });
      await makeCoupon({ code: "AGOTADO" }, { usageLimit: 5, timesUsed: 5 });

      for (const code of ["NOEXISTE", "VENCIDO", "FUTURO", "APAGADO", "AGOTADO"]) {
        createSession.mockClear();
        createCoupon.mockClear();
        const r = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: code });
        expect(r.status, code).toBe(302);
        expect(createCoupon, code).not.toHaveBeenCalled();
        expect(charged().discounts, code).toBeUndefined();
      }
    });

    it("las reglas se vuelven a revisar al pagar: compra mínima", async () => {
      await makeCoupon({ minSpendMxn: 1000 });
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: "VERANO10" });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/compra mínima/);
      expect(createSession).not.toHaveBeenCalled();
    });

    it("las reglas se vuelven a revisar al pagar: producto requerido y piezas mínimas", async () => {
      await makeCoupon({ requiredSkus: ["ATOM"] });
      const sinProducto = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: "VERANO10" });
      expect(sinProducto.status).toBe(400);
      expect((await sinProducto.json()).error).toMatch(/Atomizador/);

      await PromotionModel.updateMany({}, { "coupon.requiredSkus": [], "coupon.minQuantity": 3 });
      const pocas = await pay({ items: [{ sku: "CONC-1L", quantity: 2 }], couponCode: "VERANO10" });
      expect(pocas.status).toBe(400);
      expect((await pocas.json()).error).toMatch(/1 pieza más/);
      expect(createSession).not.toHaveBeenCalled();
    });

    it("un cupón personal pide sesión: sin ella no se aplica", async () => {
      await makeCoupon({ oncePerCustomer: true });
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: "VERANO10" });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/Inicia sesión/);
    });

    it("un cupón de un solo uso por cliente no se puede repetir", async () => {
      const promo = await makeCoupon({ oncePerCustomer: true });
      const user = await makeUser();
      await OrderModel.create({
        user: user._id,
        email: "ana@correo.com",
        items: [{ sku: "CONC-1L", name: "x", quantity: 1, unitPriceMxn: 399 }],
        totalAmount: 399,
        netAmount: 359,
        status: "paid",
        promotion: { id: String(promo._id), name: promo.name, type: "coupon" },
      });
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: "VERANO10" }, { user: user._id });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/Ya usaste este cupón/);
    });

    it("un cupón solo para ciertos correos rechaza a los demás, y exige el correo confirmado", async () => {
      await makeCoupon({ allowedEmails: ["amiga@correo.com"] });
      const otra = await makeUser();
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: "VERANO10" }, { user: otra._id });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/no está disponible para tu cuenta/);

      const amiga = await makeUser({ email: "amiga@correo.com" });
      const ok = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: "VERANO10" }, { user: amiga._id });
      expect(ok.status).toBe(302);
    });

    it("un cupón de primera compra no sirve a quien ya compró", async () => {
      await makeCoupon({ firstPurchaseOnly: true });
      const cliente = await makeUser({ individualPurchaseCount: 2 });
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: "VERANO10" }, { user: cliente._id });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/primera compra/);

      const nuevo = await makeUser({ email: "nuevo@correo.com", individualPurchaseCount: 0 });
      expect((await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: "VERANO10" }, { user: nuevo._id })).status).toBe(302);
    });
  });

  // --- Promociones automáticas y lealtad ------------------------------------------------

  describe("promociones por requisito", () => {
    const makeRequirement = (byRequirement: Record<string, unknown>) =>
      PromotionModel.create({ name: "Promo automática", type: "by_requirement", isActive: true, byRequirement });

    it("descuento al llevar suficientes piezas de un producto", async () => {
      await makeRequirement({ condition: "product_in_cart", targetSku: "CONC-1L", minQuantity: 2, rewardDiscountPercentage: 15 });

      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] });
      expect(createCoupon).not.toHaveBeenCalled();

      createSession.mockClear();
      await pay({ items: [{ sku: "CONC-1L", quantity: 2 }] });
      expect(percentOff()).toBe(15);
      expect(charged().metadata.promotionType).toBe("by_requirement");
    });

    it("regalo por gasto en un producto: va como renglón de $0 y se anota en el pedido", async () => {
      await makeRequirement({ condition: "product_spend", targetSku: "CONC-1L", minSpendMxn: 700, rewardGiftSku: "ATOM" });
      await pay({ items: [{ sku: "CONC-1L", quantity: 2 }] }); // $798 >= $700

      const sent = charged();
      const regalo = sent.line_items.find((l) => l.price_data.product_data.name === "Regalo: Atomizador");
      expect(regalo).toMatchObject({ quantity: 1, price_data: { unit_amount: 0 } });
      expect(sent.metadata.giftSku).toBe("ATOM");
    });

    it("el cupón del cliente gana sobre la promoción automática (no se suman)", async () => {
      await makeCoupon({}, {});
      await makeRequirement({ condition: "product_in_cart", targetSku: "CONC-1L", minQuantity: 1, rewardDiscountPercentage: 30 });
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: "VERANO10" });
      expect(percentOff()).toBe(10);
    });

    it("la promoción de primera compra solo aplica a quien tiene cuenta y no ha comprado", async () => {
      await makeRequirement({ condition: "first_purchase", rewardDiscountPercentage: 20 });

      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] }); // invitado
      expect(createCoupon).not.toHaveBeenCalled();

      const veterano = await makeUser({ individualPurchaseCount: 3 });
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] }, { user: veterano._id });
      expect(createCoupon).not.toHaveBeenCalled();

      const nuevo = await makeUser({ email: "nuevo@correo.com", individualPurchaseCount: 0 });
      createSession.mockClear();
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] }, { user: nuevo._id });
      expect(percentOff()).toBe(20);
    });
  });

  describe("lealtad", () => {
    it("el descuento ganado se aplica a la siguiente compra y se marca como usado", async () => {
      const user = await makeUser({ loyaltyPendingReward: { rewardType: "discount", percentage: 12 } });
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] }, { user: user._id });
      expect(percentOff()).toBe(12);
      expect(charged().metadata.usedLoyaltyReward).toBe("true");
    });

    it("un premio en regalo se agrega como renglón de $0", async () => {
      const user = await makeUser({ loyaltyPendingReward: { rewardType: "gift", giftDescription: "Bandana STOPee" } });
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] }, { user: user._id });
      const regalo = charged().line_items.find((l) => l.price_data.product_data.name === "Regalo: Bandana STOPee");
      expect(regalo?.price_data.unit_amount).toBe(0);
      expect(charged().metadata.loyaltyGiftDescription).toBe("Bandana STOPee");
      expect(charged().metadata.usedLoyaltyReward).toBe("true");
    });

    it("un cupón normal no se combina con el premio de lealtad (el premio se conserva)", async () => {
      await makeCoupon();
      const user = await makeUser({ loyaltyPendingReward: { rewardType: "discount", percentage: 12 } });
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: "VERANO10" }, { user: user._id });
      expect(percentOff()).toBe(10);
      expect(charged().metadata.usedLoyaltyReward).toBe("false");
    });

    it("un cupón marcado como acumulable sí se suma, con descuentos encadenados (10% y 12% = 21%)", async () => {
      await makeCoupon({ stackable: true });
      const user = await makeUser({ loyaltyPendingReward: { rewardType: "discount", percentage: 12 } });
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: "VERANO10" }, { user: user._id });
      expect(percentOff()).toBe(21);
      expect(charged().metadata.usedLoyaltyReward).toBe("true");
    });
  });

  // --- Envío ---------------------------------------------------------------------------------

  describe("envío", () => {
    const shipping = (changes: Record<string, unknown> = {}) =>
      saveShippingConfig({ ...DEFAULT_SHIPPING_CONFIG, ...changes } as never);
    const shippingAmount = () => charged().shipping_options?.[0].shipping_rate_data.fixed_amount.amount;

    it("sin elegir método, cobra el primero activo; la elección del cliente se respeta", async () => {
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] });
      expect(shippingAmount()).toBe(6900);
      expect(charged().metadata.shippingMethod).toBe("pickup");

      createSession.mockClear();
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], shippingMethod: "home" });
      expect(shippingAmount()).toBe(15000);
      expect(charged().metadata.shippingMethod).toBe("home");
    });

    it("un método inventado cae al primero activo en vez de abaratar el envío", async () => {
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], shippingMethod: "gratis-total" });
      expect(shippingAmount()).toBe(6900);
    });

    it("si el método elegido se apagó, usa el que sigue activo", async () => {
      const base = DEFAULT_SHIPPING_CONFIG;
      await shipping({ methods: { ...base.methods, pickup: { ...base.methods.pickup, isActive: false } } });
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], shippingMethod: "pickup" });
      expect(charged().metadata.shippingMethod).toBe("home");
    });

    it("envío gratis desde cierto monto: se calcula sobre el subtotal YA con descuento", async () => {
      await shipping({ freeShippingEnabled: true, freeShippingThreshold: 700 });

      await pay({ items: [{ sku: "CONC-1L", quantity: 2 }] }); // $798, sin cupón
      expect(shippingAmount()).toBe(0);
      expect(charged().shipping_options![0].shipping_rate_data.display_name).toMatch(/gratis/);

      // Con 20% de descuento el subtotal baja a $638, por debajo del umbral: el envío se cobra.
      createSession.mockClear();
      await makeCoupon({}, {});
      await PromotionModel.updateMany({}, { "coupon.percentage": 20 });
      await pay({ items: [{ sku: "CONC-1L", quantity: 2 }], couponCode: "VERANO10" });
      expect(shippingAmount()).toBe(6900);
    });

    it("el envío se cobra aparte: no entra en los renglones ni lo descuenta un cupón", async () => {
      await makeCoupon();
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }], couponCode: "VERANO10" });
      const sent = charged();
      expect(sent.line_items.every((l) => !/env[ií]o/i.test(l.price_data.product_data.name))).toBe(true);
      expect(shippingAmount()).toBe(6900);
    });

    it("con el envío desactivado en el negocio, no se cobra envío", async () => {
      await shipping({ isEnabled: false });
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] });
      expect(charged().shipping_options).toBeUndefined();
      expect(charged().metadata.shippingCost).toBe("0");
    });

    it("si el envío está encendido pero no queda ningún método activo, avisa en vez de cobrar mal", async () => {
      const base = DEFAULT_SHIPPING_CONFIG;
      await shipping({
        methods: { pickup: { ...base.methods.pickup, isActive: false }, home: { ...base.methods.home, isActive: false } },
      });
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/opciones de envío/);
      expect(createSession).not.toHaveBeenCalled();
    });
  });

  // --- Cliente y fallos --------------------------------------------------------------------------

  describe("cliente y fallos", () => {
    it("quien tiene sesión paga con su correo y queda ligado a su cuenta; el invitado, como invitado", async () => {
      const user = await makeUser();
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] }, { user: user._id });
      expect(charged().customer_email).toBe("ana@correo.com");
      expect(charged().metadata.userId).toBe(String(user._id));

      createSession.mockClear();
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] });
      expect(charged().customer_email).toBeUndefined();
      expect(charged().metadata.userId).toBe("guest");
    });

    it("una sesión de cuenta sin correo confirmado paga como invitado", async () => {
      const user = await makeUser({ emailVerifiedAt: undefined });
      await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] }, { user: user._id });
      expect(charged().metadata.userId).toBe("guest");
    });

    it("si Stripe falla, el cliente recibe un mensaje claro (502) y su carrito no se toca", async () => {
      createSession.mockRejectedValueOnce(new Error("Stripe caído"));
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] });
      expect(r.status).toBe(502);
      const body = await r.json();
      expect(body.error).toMatch(/Tu carrito sigue guardado/);
      expect(r.headers.get("set-cookie")).toBeNull(); // nada de vaciar el carrito
    });

    it("si Stripe no devuelve dirección de pago, también avisa", async () => {
      createSession.mockResolvedValueOnce({ id: "cs_x", url: null } as never);
      const r = await pay({ items: [{ sku: "CONC-1L", quantity: 1 }] });
      expect(r.status).toBe(502);
    });

    it("un carrito con demasiados productos distintos avisa antes de que Stripe lo rechace", async () => {
      const skus = Array.from({ length: 45 }, (_, i) => `PROD-${String(i).padStart(3, "0")}`);
      await ProductModel.insertMany(skus.map((sku) => ({ name: sku, sku, price: 100, stock: 5 })));
      const r = await pay({ items: skus.map((sku) => ({ sku, quantity: 1 })) });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/demasiados productos distintos/);
      expect(createSession).not.toHaveBeenCalled();
    });
  });
});
