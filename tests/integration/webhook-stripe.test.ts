import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse, outcomeOf } from "../helpers/http";

// El correo no sale a ningún lado: se registra cada intento para poder contarlos.
const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/mail.server", () => ({ sendEmail, isMailConfigured: () => true }));

/**
 * El webhook es lo que convierte un pago de Stripe en un pedido. Estas pruebas lo ejecutan
 * de verdad (firma incluida) contra un Mongo desechable, y verifican lo que no se puede
 * dar por hecho: que un aviso repetido no duplique pedidos, existencias ni correos.
 */
describe.skipIf(!hasTestDb)("webhook de Stripe", () => {
  let action: (args: { request: Request; params: object; context: object }) => Promise<Response>;
  let stripe: typeof import("~/lib/stripe.server").stripe;
  let OrderModel: typeof import("~/models/order.server").OrderModel;
  let ProductModel: typeof import("~/models/product.server").ProductModel;
  let UserModel: typeof import("~/models/user.server").UserModel;
  let SubscriptionModel: typeof import("~/models/subscription.server").SubscriptionModel;
  let connectDB: typeof import("~/lib/db.server").connectDB;

  beforeAll(async () => {
    assertDisposableDb();
    action = asResponse(((await import("~/routes/webhooks.stripe")) as never as { action: typeof action }).action);
    ({ stripe } = await import("~/lib/stripe.server"));
    ({ OrderModel } = await import("~/models/order.server"));
    ({ ProductModel } = await import("~/models/product.server"));
    ({ UserModel } = await import("~/models/user.server"));
    ({ SubscriptionModel } = await import("~/models/subscription.server"));
    ({ connectDB } = await import("~/lib/db.server"));
    await connectDB();
  });

  afterAll(async () => {
    await dropDb();
  });

  beforeEach(async () => {
    await wipeDb();
    await ProductModel.create({ name: "Concentrado STOPee", sku: "TEST-1", price: 399, stock: 10 });
    // Primero se restauran los espías de la prueba anterior; si no, también borrarían la respuesta del correo falso.
    vi.restoreAllMocks();
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ ok: true });
    // Varios casos provocan errores a propósito (firma falsa, correo caído): se anotan en el log y aquí se silencian.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  // --- Ayudas --------------------------------------------------------------

  const SECRET = () => process.env.STRIPE_WEBHOOK_SECRET!;

  function signedRequest(event: object, { secret = SECRET(), sign = true } = {}) {
    const payload = JSON.stringify(event);
    const headers = new Headers({ "content-type": "application/json" });
    if (sign) headers.set("stripe-signature", stripe.webhooks.generateTestHeaderString({ payload, secret }));
    return new Request("https://stopee.test/webhooks/stripe", { method: "POST", headers, body: payload });
  }

  const send = (event: object, opts?: Parameters<typeof signedRequest>[1]) =>
    action({ request: signedRequest(event, opts), params: {}, context: {} });

  let eventCounter = 0;
  const makeEvent = (type: string, object: object) => ({
    id: `evt_test_${++eventCounter}`,
    object: "event",
    api_version: "2025-02-24.acacia",
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object },
  });

  const oneTimeSession = (overrides: Record<string, unknown> = {}, metadata: Record<string, string> = {}) => ({
    id: "cs_test_compra1",
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    payment_intent: "pi_test_1",
    amount_total: 84800, // 2 × $399 + $50 de envío
    customer_details: { email: "ana@correo.com", phone: "5551234567" },
    shipping_details: {
      name: "Ana López",
      address: { line1: "Calle 1", city: "Querétaro", state: "Querétaro", postal_code: "76000", country: "MX" },
    },
    metadata: {
      cartSkus: "TEST-1:2:399",
      shippingCost: "50",
      shippingMethod: "home",
      shippingMethodLabel: "Estándar",
      shippingFree: "false",
      userId: "guest",
      ...metadata,
    },
    ...overrides,
  });

  const completed = (session = oneTimeSession()) => makeEvent("checkout.session.completed", session);
  const stockOf = async (sku = "TEST-1") => (await ProductModel.findOne({ sku }).lean())!.stock;

  // --- Firma ---------------------------------------------------------------

  describe("firma de Stripe", () => {
    it("rechaza un aviso sin firma y no crea nada", async () => {
      const response = await send(completed(), { sign: false });
      expect(response.status).toBe(400);
      expect(await OrderModel.countDocuments()).toBe(0);
    });

    it("rechaza una firma hecha con otro secreto (alguien fingiendo ser Stripe)", async () => {
      const response = await send(completed(), { secret: "whsec_de_otra_persona" });
      expect(response.status).toBe(400);
      expect(await OrderModel.countDocuments()).toBe(0);
      expect(await stockOf()).toBe(10);
    });

    it("rechaza un cuerpo alterado después de firmarse", async () => {
      const original = JSON.stringify(completed());
      const signature = stripe.webhooks.generateTestHeaderString({ payload: original, secret: SECRET() });
      const tampered = original.replace("84800", "100");
      const response = await action({
        request: new Request("https://stopee.test/webhooks/stripe", {
          method: "POST",
          headers: { "stripe-signature": signature },
          body: tampered,
        }),
        params: {},
        context: {},
      });
      expect(response.status).toBe(400);
      expect(await OrderModel.countDocuments()).toBe(0);
    });

    it("un evento que no se usa se acepta sin tocar nada", async () => {
      const response = await send(makeEvent("customer.created", { id: "cus_1" }));
      expect(response.status).toBe(200);
      expect(await OrderModel.countDocuments()).toBe(0);
    });
  });

  // --- Compra única --------------------------------------------------------

  describe("compra única", () => {
    it("registra el pedido con lo que de verdad se cobró, baja existencias y manda el correo", async () => {
      const response = await send(completed());
      expect(response.status).toBe(200);

      const order = await OrderModel.findOne({ stripeCheckoutSessionId: "cs_test_compra1" }).lean();
      expect(order).toBeTruthy();
      expect(order!.status).toBe("paid");
      expect(order!.type).toBe("one_time");
      expect(order!.email).toBe("ana@correo.com");
      expect(order!.items).toHaveLength(1);
      expect(order!.items[0]).toMatchObject({ sku: "TEST-1", name: "Concentrado STOPee", quantity: 2, unitPriceMxn: 399 });
      expect(order!.netAmount).toBe(848); // lo cobrado, no un precio que mande el navegador
      expect(order!.shippingCost).toBe(50);
      expect(order!.shippingAddress).toMatchObject({ city: "Querétaro", postalCode: "76000" });

      expect(await stockOf()).toBe(8);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail.mock.calls[0][0].to.email).toBe("ana@correo.com");
      expect(sendEmail.mock.calls[0][0].subject).toBe("Recibimos tu pedido de STOPee");
    });

    describe("factura (CFDI)", () => {
      const invoiceMeta = {
        invoiceRequested: "true",
        invRfc: "PELJ800101AB1",
        invRazonSocial: "JUAN PÉREZ LÓPEZ",
        invRegimen: "612",
        invCp: "03100",
        invUso: "G03",
      };

      it("guarda los datos fiscales en el pedido, lo marca «requiere factura» y el correo lo confirma", async () => {
        await send(completed(oneTimeSession({}, invoiceMeta)));
        const order = await OrderModel.findOne({ stripeCheckoutSessionId: "cs_test_compra1" }).lean();
        expect(order!.requiresInvoice).toBe(true);
        expect(order!.billingInfo).toMatchObject({
          rfc: "PELJ800101AB1",
          razonSocial: "JUAN PÉREZ LÓPEZ",
          regimenFiscal: "612",
          codigoPostalFiscal: "03100",
          usoCfdi: "G03",
        });
        // El precio no cambia por pedir factura: lo cobrado es lo mismo.
        expect(order!.netAmount).toBe(848);

        const mail = sendEmail.mock.calls[0][0];
        expect(mail.text).toContain("PELJ800101AB1");
        expect(mail.text).toContain("El precio no cambia");
        expect(mail.text).not.toContain("¿Necesitas factura después?");
      });

      it("sin pedir factura: el pedido no lleva datos fiscales y el correo explica cómo pedirla después, con el número de pedido", async () => {
        const { updateLegalSettings } = await import("~/models/legalSettings.server");
        await updateLegalSettings({ correoFacturacion: "facturas@stopee.test" });
        await send(completed());
        const order = await OrderModel.findOne({ stripeCheckoutSessionId: "cs_test_compra1" }).lean();
        expect(order!.requiresInvoice).toBe(false);
        expect(order!.billingInfo).toBeUndefined();

        const text = sendEmail.mock.calls[0][0].text as string;
        expect(text).toMatch(/¿Necesitas factura después\? Puedes solicitarla dentro del mismo mes calendario/);
        expect(text).toContain("a facturas@stopee.test");
        expect(text).toContain(`Número de pedido: ${String(order!._id).slice(-8).toUpperCase()}`);
        expect(text).toMatch(/IVA incluido: \$116\.97/); // 848 / 1.16 = 731.03 → IVA 116.97
      });

      it("el correo de facturación cae al de contacto si no hay uno propio, y a Contacto si no hay ninguno", async () => {
        const { updateLegalSettings } = await import("~/models/legalSettings.server");
        await updateLegalSettings({ correoFacturacion: "", correoContacto: "hola@stopee.test" });
        await send(completed());
        expect(sendEmail.mock.calls[0][0].text).toContain("a hola@stopee.test");

        sendEmail.mockClear();
        await OrderModel.deleteMany({});
        await updateLegalSettings({ correoContacto: "" });
        await send(completed());
        expect(sendEmail.mock.calls[0][0].text).toContain("por la página de Contacto");
      });
    });

    it("la dirección que escribió en nuestro carrito (metadata) es la que queda en el pedido", async () => {
      const session = oneTimeSession(
        { shipping_details: null },
        {
          shipName: "Ana Pérez",
          shipPhone: "5512345678",
          shipLine1: "Av. Insurgentes Sur 123",
          shipLine2: "Col. Del Valle",
          shipCity: "Benito Juárez",
          shipState: "Ciudad de México",
          shipPostalCode: "03100",
        },
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await send(completed(session));

      const order = await OrderModel.findOne({ stripeCheckoutSessionId: "cs_test_compra1" }).lean();
      expect(order!.shippingAddress).toMatchObject({
        name: "Ana Pérez",
        phone: "5512345678",
        line1: "Av. Insurgentes Sur 123",
        city: "Benito Juárez",
        state: "Ciudad de México",
        postalCode: "03100",
      });
      // Dentro de la zona: sin alerta.
      expect(warn).not.toHaveBeenCalled();
    });

    it("un pedido ya cobrado con código postal fuera de la zona se guarda igual, pero deja una alerta en el log", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await send(completed(oneTimeSession({ shipping_details: null }, { shipPostalCode: "64000", shipName: "Luis" })));

      expect(await OrderModel.countDocuments()).toBe(1);
      const alerts = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("order.out-of-zone"));
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain("64000");
    });

    it("si Stripe repite el aviso, no duplica pedido, existencias ni correo", async () => {
      const event = completed();
      await send(event);
      await send(event);
      await send(event);

      expect(await OrderModel.countDocuments()).toBe(1);
      expect(await stockOf()).toBe(8); // se bajó una sola vez
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it("si dos avisos llegan exactamente a la vez, tampoco duplica", async () => {
      const event = completed();
      const responses = await Promise.all([send(event), send(event), send(event)]);
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);

      expect(await OrderModel.countDocuments()).toBe(1);
      expect(await stockOf()).toBe(8);
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it("si el correo falla, el pedido igual queda y el aviso a Stripe es exitoso", async () => {
      sendEmail.mockResolvedValue({ ok: false, skipped: false, reason: "brevo-500" });
      const response = await send(completed());

      expect(response.status).toBe(200); // un 500 aquí haría que Stripe termine desactivando el webhook
      expect(await OrderModel.countDocuments()).toBe(1);
      const order = await OrderModel.findOne().lean();
      expect(order!.effects?.confirmationEmail).toBe(false); // liberado: se puede reenviar
    });

    it("un reintento posterior de Stripe reenvía el correo que falló, sin repetir lo demás", async () => {
      const event = completed();
      sendEmail.mockResolvedValueOnce({ ok: false, skipped: false, reason: "network" });
      await send(event);
      expect(sendEmail).toHaveBeenCalledTimes(1);

      await send(event); // Stripe reintenta
      expect(sendEmail).toHaveBeenCalledTimes(2);
      expect(await OrderModel.countDocuments()).toBe(1);
      expect(await stockOf()).toBe(8);

      await send(event); // y ya no se vuelve a mandar
      expect(sendEmail).toHaveBeenCalledTimes(2);
    });

    it("no manda correo si Stripe no trae el correo del cliente", async () => {
      await send(completed(oneTimeSession({ customer_details: {}, customer_email: null })));
      expect(await OrderModel.countDocuments()).toBe(1);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("si se vendió más de lo que había, el pedido se registra y la existencia queda en 0, nunca negativa", async () => {
      await ProductModel.updateOne({ sku: "TEST-1" }, { stock: 1 });
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

      await send(completed()); // compra 2, había 1
      expect(await OrderModel.countDocuments()).toBe(1);
      expect(await stockOf()).toBe(0);
      expect(errors.mock.calls.some((c) => String(c[0]).includes("inventory-oversold"))).toBe(true);
    });

    it("liga el pedido a la cuenta y suma lo gastado cuando la compra es de alguien con sesión", async () => {
      const user = await UserModel.create({ email: "luis@correo.com", passwordHash: "x", name: "Luis" });
      await send(completed(oneTimeSession({}, { userId: String(user._id) })));

      const order = await OrderModel.findOne().lean();
      expect(String(order!.user)).toBe(String(user._id));
      const updated = await UserModel.findById(user._id).lean();
      expect(updated!.totalSpentLTV).toBe(848);
      expect(updated!.individualPurchaseCount).toBe(1);

      await send(completed(oneTimeSession({}, { userId: String(user._id) }))); // el mismo evento otra vez no suma de nuevo
      expect((await UserModel.findById(user._id).lean())!.totalSpentLTV).toBe(848);
    });
  });

  // --- Pagos diferidos (OXXO, transferencia) --------------------------------

  describe("pagos diferidos", () => {
    it("una ficha generada pero sin pagar no es un pedido", async () => {
      await send(completed(oneTimeSession({ payment_status: "unpaid" })));
      expect(await OrderModel.countDocuments()).toBe(0);
      expect(await stockOf()).toBe(10);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("cuando el dinero llega, ahí sí se registra", async () => {
      await send(completed(oneTimeSession({ payment_status: "unpaid" })));
      await send(makeEvent("checkout.session.async_payment_succeeded", oneTimeSession({ payment_status: "paid" })));

      expect(await OrderModel.countDocuments()).toBe(1);
      expect(await stockOf()).toBe(8);
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it("si la ficha vence sin pagarse, no se crea nada", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      await send(makeEvent("checkout.session.async_payment_failed", oneTimeSession({ payment_status: "unpaid" })));
      expect(await OrderModel.countDocuments()).toBe(0);
      expect(errors).toHaveBeenCalled(); // al menos queda en el registro
    });
  });

  // --- Auto-envío ----------------------------------------------------------

  describe("auto-envío", () => {
    const subscriptionSession = (userId: string) => ({
      id: "cs_test_suscripcion1",
      object: "checkout.session",
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      subscription: "sub_test_1",
      amount_total: 35910,
      customer_details: { email: "ana@correo.com" },
      metadata: { userId, frequency: "4-semanas", subscriptionItems: "TEST-1:1:399", discountPercent: "10" },
    });

    beforeEach(() => {
      vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue({
        id: "sub_test_1",
        customer: "cus_test_1",
        status: "active",
        current_period_end: Math.floor(Date.now() / 1000) + 28 * 24 * 3600,
      } as never);
    });

    it("crea la suscripción y su primer pedido una sola vez, aunque el aviso se repita", async () => {
      const user = await UserModel.create({ email: "ana@correo.com", passwordHash: "x" });
      const event = makeEvent("checkout.session.completed", subscriptionSession(String(user._id)));
      await send(event);
      await send(event);

      expect(await SubscriptionModel.countDocuments()).toBe(1);
      const subscription = await SubscriptionModel.findOne().lean();
      expect(subscription).toMatchObject({ frequency: "4-semanas", status: "active", discountPercent: 10 });
      expect(subscription!.totalOrdersGenerated).toBe(1);

      expect(await OrderModel.countDocuments()).toBe(1);
      expect((await OrderModel.findOne().lean())!.type).toBe("subscription_first");
      expect(await stockOf()).toBe(9);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail.mock.calls[0][0].subject).toBe("Tu suscripción de STOPee está activa");
      expect((await UserModel.findById(user._id).lean())!.stripeCustomerId).toBe("cus_test_1");
    });

    it("guarda a dónde llega la caja (en la suscripción y en el primer pedido) y la deja como dirección del perfil si no tenía", async () => {
      const user = await UserModel.create({ email: "ana@correo.com", passwordHash: "x" });
      const session = subscriptionSession(String(user._id));
      session.metadata = {
        ...session.metadata,
        shipName: "Ana Pérez",
        shipPhone: "5512345678",
        shipLine1: "Av. Insurgentes Sur 123",
        shipCity: "Benito Juárez",
        shipState: "Ciudad de México",
        shipPostalCode: "03100",
      } as typeof session.metadata;
      await send(makeEvent("checkout.session.completed", session));

      expect((await SubscriptionModel.findOne().lean())!.shippingAddress).toMatchObject({ line1: "Av. Insurgentes Sur 123", postalCode: "03100" });
      expect((await OrderModel.findOne().lean())!.shippingAddress).toMatchObject({ name: "Ana Pérez", postalCode: "03100" });
      expect((await UserModel.findById(user._id).lean())!.address).toMatchObject({ line1: "Av. Insurgentes Sur 123", postalCode: "03100" });
    });

    it("cada renovación sale con la misma dirección con la que contrató", async () => {
      const user = await UserModel.create({ email: "ana@correo.com", passwordHash: "x" });
      await SubscriptionModel.create({
        user: user._id,
        stripeSubscriptionId: "sub_test_1",
        stripeCustomerId: "cus_test_1",
        items: [{ sku: "TEST-1", name: "Concentrado STOPee", quantity: 1, unitPriceMxn: 399 }],
        frequency: "4-semanas",
        shippingAddress: { name: "Ana Pérez", line1: "Av. Insurgentes Sur 123", city: "Benito Juárez", state: "Ciudad de México", postalCode: "03100", country: "MX" },
      });
      await send(
        makeEvent("invoice.payment_succeeded", {
          id: "in_test_1",
          object: "invoice",
          subscription: "sub_test_1",
          billing_reason: "subscription_cycle",
          amount_paid: 35910,
          lines: { data: [] },
        }),
      );
      const renovacion = await OrderModel.findOne({ type: "subscription_recurring" }).lean();
      expect(renovacion!.shippingAddress).toMatchObject({ name: "Ana Pérez", postalCode: "03100" });
    });

    describe("factura en cada caja", () => {
      const FISCAL = { rfc: "PELJ800101AB1", razonSocial: "JUAN PÉREZ LÓPEZ", regimenFiscal: "612", codigoPostalFiscal: "03100", usoCfdi: "G03" };
      const renewalEvent = (id = "in_test_1") =>
        makeEvent("invoice.payment_succeeded", {
          id,
          object: "invoice",
          subscription: "sub_test_1",
          billing_reason: "subscription_cycle",
          amount_paid: 35910,
          lines: { data: [] },
        });
      const makeSubscription = (userId: unknown, extra: Record<string, unknown> = {}) =>
        SubscriptionModel.create({
          user: userId,
          stripeSubscriptionId: "sub_test_1",
          stripeCustomerId: "cus_test_1",
          items: [{ sku: "TEST-1", name: "Concentrado STOPee", quantity: 1, unitPriceMxn: 399 }],
          frequency: "4-semanas",
          shippingAddress: { name: "Ana Pérez", line1: "Av. Insurgentes Sur 123", city: "Benito Juárez", state: "Ciudad de México", postalCode: "03100", country: "MX" },
          ...extra,
        });

      it("al contratar con factura: la suscripción y el primer pedido la llevan, y el correo lo confirma", async () => {
        const user = await UserModel.create({ email: "ana@correo.com", passwordHash: "x" });
        const session = subscriptionSession(String(user._id));
        session.metadata = {
          ...session.metadata,
          invoiceRequested: "true",
          invRfc: FISCAL.rfc,
          invRazonSocial: FISCAL.razonSocial,
          invRegimen: FISCAL.regimenFiscal,
          invCp: FISCAL.codigoPostalFiscal,
          invUso: FISCAL.usoCfdi,
        } as typeof session.metadata;
        await send(makeEvent("checkout.session.completed", session));

        expect((await SubscriptionModel.findOne().lean())!.requiresInvoice).toBe(true);
        const first = await OrderModel.findOne({ type: "subscription_first" }).lean();
        expect(first).toMatchObject({ requiresInvoice: true, billingInfo: { rfc: FISCAL.rfc, usoCfdi: "G03" } });
        const text = sendEmail.mock.calls[0][0].text as string;
        expect(text).toContain(FISCAL.rfc);
        expect(text).toMatch(/cada caja/);
      });

      it("al contratar sin factura: nada se marca y el correo explica cómo pedirla", async () => {
        const user = await UserModel.create({ email: "ana@correo.com", passwordHash: "x" });
        await send(makeEvent("checkout.session.completed", subscriptionSession(String(user._id))));
        expect((await SubscriptionModel.findOne().lean())!.requiresInvoice).toBe(false);
        expect((await OrderModel.findOne().lean())!.requiresInvoice).toBe(false);
        expect(sendEmail.mock.calls[0][0].text).toMatch(/mismo mes calendario/);
      });

      it("cada renovación sale marcada «requiere factura» con los datos de la cuenta de ese momento", async () => {
        const user = await UserModel.create({ email: "ana@correo.com", passwordHash: "x", billingInfo: FISCAL });
        await makeSubscription(user._id, { requiresInvoice: true });
        await send(renewalEvent());

        const order = await OrderModel.findOne({ type: "subscription_recurring" }).lean();
        expect(order).toMatchObject({ requiresInvoice: true, billingInfo: { rfc: FISCAL.rfc, razonSocial: FISCAL.razonSocial } });

        // Si corrige sus datos, la siguiente caja sale con los nuevos y la anterior conserva los suyos.
        await UserModel.updateOne({ _id: user._id }, { $set: { "billingInfo.codigoPostalFiscal": "06700" } });
        await send(renewalEvent("in_test_2"));
        const all = await OrderModel.find({ type: "subscription_recurring" }).sort({ createdAt: 1 }).lean();
        expect(all.map((o) => o.billingInfo?.codigoPostalFiscal)).toEqual(["03100", "06700"]);
      });

      it("la renovación avisa por correo que la caja se está preparando, con número de pedido y la factura", async () => {
        const user = await UserModel.create({ email: "ana@correo.com", passwordHash: "x", billingInfo: FISCAL });
        await makeSubscription(user._id, { requiresInvoice: true });
        await send(renewalEvent());

        expect(sendEmail).toHaveBeenCalledTimes(1);
        const mail = sendEmail.mock.calls[0][0];
        expect(mail.to.email).toBe("ana@correo.com");
        expect(mail.subject).toMatch(/se está preparando/);
        const order = await OrderModel.findOne({ type: "subscription_recurring" }).lean();
        expect(mail.text).toContain(String(order!._id).slice(-8).toUpperCase());
        expect(mail.text).toContain("1 × Concentrado STOPee");
        expect(mail.text).not.toContain("(renovación)");
        expect(mail.text).toContain(FISCAL.rfc);
      });

      it("renovación sin factura: no se marca, y el correo dice cómo pedirla y cómo prender la automática", async () => {
        const user = await UserModel.create({ email: "ana@correo.com", passwordHash: "x", billingInfo: FISCAL });
        await makeSubscription(user._id); // requiresInvoice apagado aunque tenga datos guardados
        await send(renewalEvent());

        expect((await OrderModel.findOne({ type: "subscription_recurring" }).lean())!.requiresInvoice).toBe(false);
        const text = sendEmail.mock.calls[0][0].text as string;
        expect(text).toMatch(/mismo mes calendario/);
        expect(text).toMatch(/Factura en cada caja/);
      });

      it("si borró sus datos fiscales, la renovación sale sin factura (no se inventa nada)", async () => {
        const user = await UserModel.create({ email: "ana@correo.com", passwordHash: "x" });
        await makeSubscription(user._id, { requiresInvoice: true });
        await send(renewalEvent());
        const order = await OrderModel.findOne({ type: "subscription_recurring" }).lean();
        expect(order!.requiresInvoice).toBe(false);
        expect(order!.billingInfo?.rfc).toBeUndefined();
      });

      it("la renovación guarda la caja completa (sku, cantidad y precio) y descuenta las existencias", async () => {
        const user = await UserModel.create({ email: "ana@correo.com", passwordHash: "x" });
        await makeSubscription(user._id, {
          items: [{ sku: "TEST-1", name: "Concentrado STOPee", quantity: 3, unitPriceMxn: 399 }],
        });
        await send(renewalEvent());
        const order = await OrderModel.findOne({ type: "subscription_recurring" }).lean();
        expect(order!.items).toHaveLength(1);
        expect(order!.items[0]).toMatchObject({ sku: "TEST-1", quantity: 3, unitPriceMxn: 399, name: "Concentrado STOPee (renovación)" });
        expect(await stockOf()).toBe(7);
      });

      it("un aviso repetido no manda el correo de la caja dos veces", async () => {
        const user = await UserModel.create({ email: "ana@correo.com", passwordHash: "x" });
        await makeSubscription(user._id);
        const event = renewalEvent();
        await send(event);
        await send(event);
        expect(await OrderModel.countDocuments({ type: "subscription_recurring" })).toBe(1);
        expect(sendEmail).toHaveBeenCalledTimes(1);
      });
    });

    it("un aviso de suscripción sin usuario no crea nada ni falla", async () => {
      const session = subscriptionSession("");
      const response = await send(makeEvent("checkout.session.completed", session));
      expect(response.status).toBe(200);
      expect(await SubscriptionModel.countDocuments()).toBe(0);
      expect(await OrderModel.countDocuments()).toBe(0);
    });

    it("cuando Stripe cancela la suscripción, queda cancelada", async () => {
      const user = await UserModel.create({ email: "ana@correo.com", passwordHash: "x" });
      await send(makeEvent("checkout.session.completed", subscriptionSession(String(user._id))));
      await send(
        makeEvent("customer.subscription.deleted", {
          id: "sub_test_1",
          status: "canceled",
          current_period_end: Math.floor(Date.now() / 1000),
        }),
      );
      expect((await SubscriptionModel.findOne().lean())!.status).toBe("cancelled");
    });

    it("una renovación fallida deja la suscripción en 'past_due' y no la cancela", async () => {
      const user = await UserModel.create({ email: "ana@correo.com", passwordHash: "x" });
      await send(makeEvent("checkout.session.completed", subscriptionSession(String(user._id))));
      await send(
        makeEvent("customer.subscription.updated", {
          id: "sub_test_1",
          status: "past_due",
          current_period_end: Math.floor(Date.now() / 1000),
        }),
      );
      expect((await SubscriptionModel.findOne().lean())!.status).toBe("past_due");
    });
  });

  // --- Reembolsos ----------------------------------------------------------

  describe("reembolsos", () => {
    const refundEvent = (refunded: boolean) =>
      makeEvent("charge.refunded", {
        id: "ch_test_1",
        object: "charge",
        payment_intent: "pi_test_1",
        refunded,
        amount_refunded: refunded ? 84800 : 10000,
      });

    it("un reembolso total marca el pedido y resta lo gastado, una sola vez", async () => {
      const user = await UserModel.create({ email: "luis@correo.com", passwordHash: "x" });
      await send(completed(oneTimeSession({}, { userId: String(user._id) })));
      expect((await UserModel.findById(user._id).lean())!.totalSpentLTV).toBe(848);

      const event = refundEvent(true);
      await send(event);
      await send(event);

      expect((await OrderModel.findOne().lean())!.status).toBe("refunded");
      expect((await UserModel.findById(user._id).lean())!.totalSpentLTV).toBe(0);
    });

    it("un reembolso parcial no cambia el pedido (se revisa a mano)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      await send(completed());
      await send(refundEvent(false));
      expect((await OrderModel.findOne().lean())!.status).toBe("paid");
    });
  });
});
