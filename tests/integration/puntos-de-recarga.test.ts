import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse, outcomeOf } from "../helpers/http";

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/mail.server", () => ({ sendEmail, isMailConfigured: () => true }));

type Args = { request: Request; params: Record<string, string>; context: object };
type Handler = (args: Args) => Promise<Response>;

const SOLICITUD = {
  name: "Dra. Ana Torres",
  businessOrType: "Veterinaria",
  neighborhood: "Roma Norte",
  address: "Calle Colima 123, entre Orizaba y Cuauhtémoc",
  whatsapp: "55 1234 5678",
  email: "Ana@Veterinaria.com",
  privacy: "on",
};

/**
 * Puntos de Recarga contra un Mongo desechable: el directorio público (solo aliados activos y
 * autorizados, sin datos privados), el formulario para pedir ser punto (honeypot, topes, sin
 * pistas de si el correo ya existe) y el panel de administración (solo administradores).
 */
describe.skipIf(!hasTestDb)("puntos de recarga", () => {
  let publicLoader: Handler;
  let publicAction: Handler;
  let adminLoader: Handler;
  let adminAction: Handler;
  let customerAction: Handler;
  let cuentaLoader: Handler;
  let cuentaAction: Handler;
  let verificar: Handler;
  let UserModel: typeof import("~/models/user.server").UserModel;
  let AllyRequestModel: typeof import("~/models/allyRequest.server").AllyRequestModel;
  let sessionStorage: typeof import("~/lib/session.server").sessionStorage;

  beforeAll(async () => {
    assertDisposableDb();
    const pub = (await import("~/routes/puntos-de-recarga")) as never as { loader: Handler; action: Handler };
    publicLoader = asResponse(pub.loader);
    publicAction = asResponse(pub.action);
    const adm = (await import("~/routes/admin.aliados")) as never as { loader: Handler; action: Handler };
    adminLoader = adm.loader as Handler;
    adminAction = adm.action as Handler;
    customerAction = ((await import("~/routes/admin.customers_.$id")) as never as { action: Handler }).action;
    const cuenta = (await import("~/routes/cuenta")) as never as { loader: Handler; action: Handler };
    cuentaLoader = asResponse(cuenta.loader);
    cuentaAction = asResponse(cuenta.action);
    verificar = asResponse(((await import("~/routes/cuenta_.verificar")) as never as { loader: Handler }).loader);
    ({ UserModel } = await import("~/models/user.server"));
    ({ AllyRequestModel } = await import("~/models/allyRequest.server"));
    ({ sessionStorage } = await import("~/lib/session.server"));
    await (await import("~/lib/db.server")).connectDB();
  });

  afterAll(async () => {
    await dropDb();
  });

  beforeEach(async () => {
    (await import("~/lib/rateLimit.server")).resetRateLimits();
    await wipeDb();
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ ok: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  const station = (over: Record<string, unknown> = {}) => ({
    businessName: "Veterinaria San Ángel",
    neighborhood: "San Ángel",
    city: "CDMX",
    address: "Av. Revolución 1500",
    schedule: "Lunes a sábado, 10:00 a 18:00",
    whatsapp: "5511223344",
    isPublic: true,
    ...over,
  });

  async function user(email: string, over: Record<string, unknown> = {}) {
    return UserModel.create({ email, passwordHash: "x", emailVerifiedAt: new Date(), ...over });
  }

  /** Administrador con verificación en dos pasos y sesión abierta con el código: lo que pide el panel. */
  async function adminCookie(role: "admin" | "superadmin" | "customer" = "admin") {
    const u = (await UserModel.findOne({ email: `${role}@stopee.test` })) ?? (await user(`${role}@stopee.test`, { role, twoFactor: { enabledAt: new Date() } }));
    const session = await sessionStorage.getSession();
    session.set("userId", String(u._id));
    session.set("iat", Date.now());
    session.set("mfa", true);
    return { cookie: (await sessionStorage.commitSession(session)).split(";")[0], id: String(u._id) };
  }

  const post = (url: string, fields: Record<string, string>, cookie?: string, params: Record<string, string> = {}): Args => ({
    request: new Request(url, {
      method: "POST",
      headers: { ...(cookie ? { cookie } : {}), origin: new URL(url).origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    }),
    params,
    context: {},
  });
  const get = (url: string, cookie?: string): Args => ({
    request: new Request(url, { headers: cookie ? { cookie } : {} }),
    params: {},
    context: {},
  });

  describe("directorio público", () => {
    it("muestra solo aliados activos y publicados, con los datos del punto y nada de la cuenta", async () => {
      await user("a@x.com", { isRefillAlly: true, allyStation: station() });
      await user("b@x.com", { isRefillAlly: true, allyStation: station({ businessName: "Oculto", isPublic: false }) });
      await user("c@x.com", { isRefillAlly: false, allyStation: station({ businessName: "Desactivado" }) });
      await user("d@x.com", { allyStation: station({ businessName: "Nunca fue aliado" }) });

      const response = await publicLoader(get("https://stopee.test/puntos-de-recarga"));
      const body = (await response.json()) as { points: Record<string, string>[]; totalPoints: number };
      expect(body.points.map((p) => p.businessName)).toEqual(["Veterinaria San Ángel"]);
      expect(Object.keys(body.points[0]).sort()).toEqual(
        ["address", "businessName", "city", "id", "mapsUrl", "neighborhood", "schedule", "whatsapp"].sort(),
      );
      expect(JSON.stringify(body)).not.toMatch(/@x\.com/);
    });

    it("filtra por colonia y ignora una colonia que no existe", async () => {
      await user("a@x.com", { isRefillAlly: true, allyStation: station() });
      await user("b@x.com", { isRefillAlly: true, allyStation: station({ businessName: "Pet Roma", neighborhood: "Roma Norte" }) });

      const roma = (await (await publicLoader(get("https://stopee.test/puntos-de-recarga?colonia=Roma%20Norte"))).json()) as { points: { businessName: string }[]; selected: string };
      expect(roma.points.map((p) => p.businessName)).toEqual(["Pet Roma"]);
      expect(roma.selected).toBe("Roma Norte");

      const raro = (await (await publicLoader(get("https://stopee.test/puntos-de-recarga?colonia=%7B%22%24ne%22%3A%22%22%7D"))).json()) as { points: unknown[]; selected: string };
      expect(raro.selected).toBe("");
      expect(raro.points).toHaveLength(2);
    });

    it("sin aliados publicados no falla: lista vacía", async () => {
      const body = (await (await publicLoader(get("https://stopee.test/puntos-de-recarga"))).json()) as { points: unknown[]; totalPoints: number };
      expect(body.points).toEqual([]);
      expect(body.totalPoints).toBe(0);
    });
  });

  describe("solicitud para ser punto", () => {
    it("guarda la solicitud limpia y avisa al negocio por correo", async () => {
      vi.stubEnv("ADMIN_EMAIL", "negocio@stopee.test");
      const response = await publicAction(post("https://stopee.test/puntos-de-recarga", { ...SOLICITUD, name: "<b>Dra.</b> Ana <script>x()</script>Torres" }));
      expect(response.status).toBe(200);
      expect(((await response.json()) as { ok: boolean }).ok).toBe(true);

      const saved = await AllyRequestModel.findOne().lean();
      expect(saved).toMatchObject({
        name: "Dra. Ana Torres",
        businessOrType: "Veterinaria",
        neighborhood: "Roma Norte",
        whatsapp: "5512345678",
        email: "ana@veterinaria.com",
        status: "pending",
      });
      expect(saved!.privacyAcceptedAt).toBeTruthy();
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail.mock.calls[0][0].subject).toMatch(/Punto de Recarga/);
      vi.unstubAllEnvs();
    });

    it("sin aceptar el aviso de privacidad, con un teléfono inválido o un tipo inventado, no guarda nada", async () => {
      for (const bad of [
        { privacy: "" },
        { whatsapp: "1234" },
        { businessOrType: "Banco" },
        { email: "no-es-correo" },
        { name: "A" },
        { address: "x" },
      ]) {
        // Cada intento cuenta para el tope (que vive en Mongo); aquí se prueba otra cosa.
        await (await import("~/models/rateLimit.server")).RateLimitModel.deleteMany({});
        const response = await publicAction(post("https://stopee.test/puntos-de-recarga", { ...SOLICITUD, ...bad }));
        expect(response.status).toBe(400);
      }
      expect(await AllyRequestModel.countDocuments()).toBe(0);
    });

    it("el campo trampa lleno responde 'listo' sin guardar ni enviar correo", async () => {
      const response = await publicAction(post("https://stopee.test/puntos-de-recarga", { ...SOLICITUD, website: "http://spam.example" }));
      expect(response.status).toBe(200);
      expect(await AllyRequestModel.countDocuments()).toBe(0);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("el mismo correo con una solicitud pendiente recibe la misma respuesta y no crea otra ni otro correo", async () => {
      vi.stubEnv("ADMIN_EMAIL", "negocio@stopee.test");
      const first = await publicAction(post("https://stopee.test/puntos-de-recarga", SOLICITUD));
      const second = await publicAction(post("https://stopee.test/puntos-de-recarga", SOLICITUD));
      expect(second.status).toBe(first.status);
      expect(await second.json()).toEqual(await first.json());
      expect(await AllyRequestModel.countDocuments()).toBe(1);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      vi.unstubAllEnvs();
    });

    it("pone tope a las solicitudes desde una misma dirección", async () => {
      let last = 200;
      for (let i = 0; i < 7; i++) {
        last = (await publicAction(post("https://stopee.test/puntos-de-recarga", { ...SOLICITUD, email: `p${i}@x.com` }))).status;
      }
      expect(last).toBe(429);
    });

    it("rechaza un formulario enviado desde otro sitio", async () => {
      const args = post("https://stopee.test/puntos-de-recarga", SOLICITUD);
      const foreign = new Request(args.request.url, {
        method: "POST",
        headers: { origin: "https://malo.example", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(SOLICITUD),
      });
      const response = await publicAction({ ...args, request: foreign });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await AllyRequestModel.countDocuments()).toBe(0);
    });
  });

  describe("panel de administración", () => {
    it("las solicitudes solo las ve un administrador", async () => {
      const anon = (await outcomeOf(() => adminLoader(get("https://stopee.test/admin/aliados")))) as Response;
      expect(anon.status).toBe(302);
      const customer = await adminCookie("customer");
      const forbidden = (await outcomeOf(() => adminLoader(get("https://stopee.test/admin/aliados", customer.cookie)))) as Response;
      expect(forbidden.status).toBe(403);
      const admin = await adminCookie("admin");
      expect((await asResponse(adminLoader)(get("https://stopee.test/admin/aliados", admin.cookie))).status).toBe(200);
    });

    it("cambiar el estado o borrar una solicitud exige ser administrador", async () => {
      const req = await AllyRequestModel.create({ ...SOLICITUD, whatsapp: "5512345678", email: "ana@veterinaria.com" });
      const fields = { intent: "set-status", id: String(req._id), status: "approved" };

      const anon = (await outcomeOf(() => adminAction(post("https://stopee.test/admin/aliados", fields)))) as Response;
      expect([302, 403]).toContain(anon.status);
      const customer = await adminCookie("customer");
      const forbidden = (await outcomeOf(() => adminAction(post("https://stopee.test/admin/aliados", fields, customer.cookie)))) as Response;
      expect(forbidden.status).toBe(403);
      expect((await AllyRequestModel.findById(req._id).lean())!.status).toBe("pending");

      const admin = await adminCookie("admin");
      const ok = await asResponse(adminAction)(post("https://stopee.test/admin/aliados", fields, admin.cookie));
      expect(ok.status).toBe(200);
      expect((await AllyRequestModel.findById(req._id).lean())!.status).toBe("approved");

      const bad = await asResponse(adminAction)(post("https://stopee.test/admin/aliados", { ...fields, status: "dios" }, admin.cookie));
      expect(bad.status).toBe(400);
      const gone = await asResponse(adminAction)(post("https://stopee.test/admin/aliados", { intent: "delete", id: String(req._id) }, admin.cookie));
      expect(gone.status).toBe(200);
      expect(await AllyRequestModel.countDocuments()).toBe(0);
    });

    it("avisa si quien pidió ser punto ya tiene cuenta, para ir directo a su ficha", async () => {
      await AllyRequestModel.create({ ...SOLICITUD, whatsapp: "5512345678", email: "ana@veterinaria.com" });
      const cuenta = await user("ana@veterinaria.com");
      const admin = await adminCookie("admin");
      const body = (await (await asResponse(adminLoader)(get("https://stopee.test/admin/aliados", admin.cookie))).json()) as {
        requests: { account: { id: string } | null }[];
      };
      expect(body.requests[0].account?.id).toBe(String(cuenta._id));
    });
  });

  describe("activar un punto desde la ficha del cliente", () => {
    const run = async (cookie: string, id: string, fields: Record<string, string>) =>
      (await outcomeOf(() =>
        customerAction(post(`https://stopee.test/admin/customers/${id}`, { intent: "set-ally", ...fields }, cookie, { id })),
      )) as Response | { init?: { status?: number }; data?: { ok: boolean; error: string | null } };

    const statusOf = (result: Awaited<ReturnType<typeof run>>) =>
      result instanceof Response ? result.status : ((result as { init?: { status?: number } }).init?.status ?? 200);
    const dataOf = (result: Awaited<ReturnType<typeof run>>) => (result as { data: { ok: boolean; error: string | null } }).data;

    const form = (over: Record<string, string> = {}) => ({
      isRefillAlly: "on",
      businessName: "Veterinaria San Ángel",
      neighborhood: "San Ángel",
      city: "CDMX",
      address: "Av. Revolución 1500",
      schedule: "Lunes a sábado, 10:00 a 18:00",
      whatsapp: "55 1122 3344",
      isPublic: "on",
      ...over,
    });

    it("un cliente normal no puede activar puntos, ni siquiera el suyo", async () => {
      const customer = await adminCookie("customer");
      const result = await run(customer.cookie, customer.id, form());
      expect(statusOf(result)).toBe(403);
      expect((await UserModel.findById(customer.id).lean())!.isRefillAlly).toBeFalsy();
    });

    it("un administrador activa y publica un punto con todos sus datos", async () => {
      const admin = await adminCookie("admin");
      const target = await user("aliado@x.com");
      const result = await run(admin.cookie, String(target._id), form());
      expect(dataOf(result).ok).toBe(true);
      const saved = await UserModel.findById(target._id).lean();
      expect(saved!.isRefillAlly).toBe(true);
      expect(saved!.allyStation).toMatchObject({ businessName: "Veterinaria San Ángel", whatsapp: "5511223344", isPublic: true });
    });

    it("no se publica un punto incompleto: falta el horario", async () => {
      const admin = await adminCookie("admin");
      const target = await user("aliado@x.com");
      const result = await run(admin.cookie, String(target._id), form({ schedule: "" }));
      expect(statusOf(result)).toBe(400);
      expect(dataOf(result).error).toMatch(/horario/);
      expect((await UserModel.findById(target._id).lean())!.isRefillAlly).toBeFalsy();
    });

    it("desactivar un aliado lo saca del directorio aunque la casilla de publicar siga marcada, y conserva sus datos", async () => {
      const admin = await adminCookie("admin");
      const target = await user("aliado@x.com", { isRefillAlly: true, allyStation: station() });
      await run(admin.cookie, String(target._id), form({ isRefillAlly: "" }));
      const saved = await UserModel.findById(target._id).lean();
      expect(saved!.isRefillAlly).toBe(false);
      expect(saved!.allyStation).toMatchObject({ isPublic: false, businessName: "Veterinaria San Ángel" });
      const body = (await (await publicLoader(get("https://stopee.test/puntos-de-recarga"))).json()) as { points: unknown[] };
      expect(body.points).toEqual([]);
    });

    it("el texto del punto se limpia de etiquetas HTML", async () => {
      const admin = await adminCookie("admin");
      const target = await user("aliado@x.com");
      await run(admin.cookie, String(target._id), form({ businessName: "Pet <img src=x onerror=alert(1)> Roma" }));
      expect((await UserModel.findById(target._id).lean())!.allyStation!.businessName).toBe("Pet Roma");
    });

    it("cambiar el rol sigue siendo solo del super administrador", async () => {
      const admin = await adminCookie("admin");
      const target = await user("otro@x.com");
      const result = (await outcomeOf(() =>
        customerAction(post(`https://stopee.test/admin/customers/${target._id}`, { intent: "set-role", role: "admin" }, admin.cookie, { id: String(target._id) })),
      )) as Response;
      expect(result.status).toBe(403);
      expect((await UserModel.findById(target._id).lean())!.role).toBe("customer");

      const superAdmin = await adminCookie("superadmin");
      await customerAction(post(`https://stopee.test/admin/customers/${target._id}`, { intent: "set-role", role: "admin" }, superAdmin.cookie, { id: String(target._id) }));
      expect((await UserModel.findById(target._id).lean())!.role).toBe("admin");
    });

    it("un id inventado no rompe nada", async () => {
      const admin = await adminCookie("admin");
      const result = await run(admin.cookie, "no-es-un-id", form());
      expect(statusOf(result)).toBe(404);
    });
  });

  describe("aprobar activa al aliado", () => {
    const solicitud = (over: Record<string, unknown> = {}) =>
      AllyRequestModel.create({
        name: "Ana Torres",
        businessOrType: "Veterinaria",
        neighborhood: "Roma Norte",
        address: "Calle Colima 123",
        whatsapp: "5512345678",
        email: "ana@veterinaria.com",
        ...over,
      });
    const approve = async (id: unknown, status = "approved") => {
      const admin = await adminCookie("admin");
      const response = await asResponse(adminAction)(post("https://stopee.test/admin/aliados", { intent: "set-status", id: String(id), status }, admin.cookie));
      return (await response.json()) as { ok: boolean; activation: string | null; deactivated: boolean };
    };

    it("con cuenta que ya confirmó su correo: queda activa con los datos de su solicitud y SIN publicarse", async () => {
      const cuenta = await user("ana@veterinaria.com");
      const req = await solicitud({ businessName: "Veterinaria Roma" });
      expect((await approve(req._id)).activation).toBe("activated");

      const saved = await UserModel.findById(cuenta._id).lean();
      expect(saved!.isRefillAlly).toBe(true);
      expect(saved!.allyStation).toMatchObject({
        businessName: "Veterinaria Roma",
        neighborhood: "Roma Norte",
        address: "Calle Colima 123",
        whatsapp: "5512345678",
        city: "CDMX",
        isPublic: false,
      });
      expect(String((await AllyRequestModel.findById(req._id).lean())!.userId)).toBe(String(cuenta._id));
      // No aparece en el directorio hasta que un administrador lo publique.
      const body = (await (await publicLoader(get("https://stopee.test/puntos-de-recarga"))).json()) as { points: unknown[] };
      expect(body.points).toEqual([]);
    });

    it("sin nombre de negocio, el punto se llama «Punto de» y el primer nombre", async () => {
      const cuenta = await user("ana@veterinaria.com");
      await approve((await solicitud())._id);
      expect((await UserModel.findById(cuenta._id).lean())!.allyStation!.businessName).toBe("Punto de Ana");
    });

    it("si la cuenta ya tenía datos de su punto, se respetan (y su publicación no cambia)", async () => {
      const cuenta = await user("ana@veterinaria.com", { allyStation: station({ businessName: "Mi Vet", isPublic: true }) });
      await approve((await solicitud())._id);
      const saved = await UserModel.findById(cuenta._id).lean();
      expect(saved!.allyStation).toMatchObject({ businessName: "Mi Vet", neighborhood: "San Ángel", isPublic: true });
      expect(saved!.isRefillAlly).toBe(true);
    });

    it("sin cuenta: queda aprobada y avisa; cuando se registra y confirma su correo, se activa sola", async () => {
      const req = await solicitud();
      expect((await approve(req._id)).activation).toBe("no-account");

      const cuenta = await UserModel.create({ email: "ana@veterinaria.com", passwordHash: "x" }); // aún sin confirmar
      const tokens = await import("~/lib/authTokens.server");
      const token = await tokens.issueToken(cuenta._id, "verify");
      const response = await verificar(get(`https://stopee.test/cuenta/verificar?token=${encodeURIComponent(token)}`));
      expect(((await response.json()) as { status: string }).status).toBe("verified");

      const saved = await UserModel.findById(cuenta._id).lean();
      expect(saved!.isRefillAlly).toBe(true);
      expect(saved!.allyStation?.neighborhood).toBe("Roma Norte");
      expect(saved!.allyStation?.isPublic).toBe(false);
    });

    it("una cuenta que aún no confirma el correo NO se activa al aprobar (nadie puede adueñarse del lugar con un correo ajeno)", async () => {
      const cuenta = await UserModel.create({ email: "ana@veterinaria.com", passwordHash: "x" });
      const req = await solicitud();
      expect((await approve(req._id)).activation).toBe("unverified");
      expect((await UserModel.findById(cuenta._id).lean())!.isRefillAlly).toBeFalsy();
    });

    it("quitar la aprobación (rechazar o volver a pendiente) desactiva al aliado y lo saca del directorio", async () => {
      const cuenta = await user("ana@veterinaria.com", { allyStation: station({ isPublic: true }) });
      const req = await solicitud();
      await approve(req._id);
      expect((await UserModel.findById(cuenta._id).lean())!.isRefillAlly).toBe(true);

      const result = await approve(req._id, "rejected");
      expect(result.deactivated).toBe(true);
      const saved = await UserModel.findById(cuenta._id).lean();
      expect(saved!.isRefillAlly).toBe(false);
      expect(saved!.allyStation?.isPublic).toBe(false);
      expect(saved!.allyStation?.businessName).toBe("Veterinaria San Ángel"); // los datos se conservan
    });

    it("el formulario público guarda el nombre del negocio (opcional)", async () => {
      await publicAction(post("https://stopee.test/puntos-de-recarga", { ...SOLICITUD, businessName: "Veterinaria Roma" }));
      expect((await AllyRequestModel.findOne().lean())!.businessName).toBe("Veterinaria Roma");
    });
  });

  describe("mapa del punto", () => {
    it("el directorio entrega el enlace de mapa del punto", async () => {
      await user("a@x.com", { isRefillAlly: true, allyStation: station({ mapsUrl: "https://maps.app.goo.gl/AbC123" }) });
      const body = (await (await publicLoader(get("https://stopee.test/puntos-de-recarga"))).json()) as { points: { mapsUrl: string }[] };
      expect(body.points[0].mapsUrl).toBe("https://maps.app.goo.gl/AbC123");
    });

    it("el administrador guarda un enlace válido y rechaza uno que no sea de Google Maps", async () => {
      const admin = await adminCookie("admin");
      const target = await user("aliado@x.com");
      const fields = (mapsUrl: string) => ({
        intent: "set-ally", isRefillAlly: "on", businessName: "Vet", neighborhood: "Roma", city: "CDMX",
        address: "Colima 1", schedule: "9 a 5", whatsapp: "5511223344", mapsUrl,
      });
      const send = async (mapsUrl: string) =>
        (await outcomeOf(() => customerAction(post(`https://stopee.test/admin/customers/${target._id}`, fields(mapsUrl), admin.cookie, { id: String(target._id) })))) as { init?: { status?: number } };

      expect((await send("https://malo.example/maps")).init?.status).toBe(400);
      expect((await UserModel.findById(target._id).lean())!.isRefillAlly).toBeFalsy();
      await send("https://maps.app.goo.gl/AbC123");
      expect((await UserModel.findById(target._id).lean())!.allyStation!.mapsUrl).toBe("https://maps.app.goo.gl/AbC123");
    });
  });

  describe("el aliado en «Mi cuenta»", () => {
    const sessionFor = async (userDoc: { _id: unknown }) => {
      const s = await sessionStorage.getSession();
      s.set("userId", String(userDoc._id));
      s.set("iat", Date.now());
      return (await sessionStorage.commitSession(s)).split(";")[0];
    };
    const update = async (userDoc: { _id: unknown }, fields: Record<string, string>) => {
      const response = await cuentaAction(post("https://stopee.test/cuenta", { intent: "ally-update", ...fields }, await sessionFor(userDoc)));
      return { status: response.status, body: (await response.json()) as { ok: boolean; error: string | null } };
    };

    it("un aliado ve su punto, y quien no lo es no ve nada", async () => {
      const aliado = await user("a@x.com", { isRefillAlly: true, allyStation: station() });
      const normal = await user("n@x.com");
      const mine = (await (await cuentaLoader(get("https://stopee.test/cuenta", await sessionFor(aliado)))).json()) as { ally: { businessName: string } | null; allyRequestStatus: string | null };
      expect(mine.ally?.businessName).toBe("Veterinaria San Ángel");
      const theirs = (await (await cuentaLoader(get("https://stopee.test/cuenta", await sessionFor(normal)))).json()) as { ally: unknown; allyRequestStatus: string | null };
      expect(theirs.ally).toBeNull();
      expect(theirs.allyRequestStatus).toBeNull();
    });

    it("quien pidió ser punto ve el estado de su solicitud", async () => {
      const normal = await user("ana@veterinaria.com");
      await AllyRequestModel.create({ ...SOLICITUD, whatsapp: "5512345678", email: "ana@veterinaria.com" });
      const body = (await (await cuentaLoader(get("https://stopee.test/cuenta", await sessionFor(normal)))).json()) as { allyRequestStatus: string | null };
      expect(body.allyRequestStatus).toBe("pending");
    });

    it("el historial muestra solo sus pedidos de bidón", async () => {
      await ProductModelCreate();
      const aliado = await user("a@x.com", { isRefillAlly: true, allyStation: station() });
      const { OrderModel } = await import("~/models/order.server");
      const base = { user: aliado._id, email: "a@x.com", totalAmount: 3000, netAmount: 3000, status: "paid", type: "one_time" };
      await OrderModel.create({ ...base, items: [{ sku: "BIDON-20L", name: "Bidón 20L", quantity: 1, unitPriceMxn: 3000 }] });
      await OrderModel.create({ ...base, totalAmount: 400, netAmount: 400, items: [{ sku: "CONC-1L", name: "Concentrado 1L", quantity: 1, unitPriceMxn: 400 }] });
      const body = (await (await cuentaLoader(get("https://stopee.test/cuenta", await sessionFor(aliado)))).json()) as { allyOrders: { items: { name: string }[] }[] };
      expect(body.allyOrders).toHaveLength(1);
      expect(body.allyOrders[0].items[0].name).toBe("Bidón 20L");
    });

    it("un aliado actualiza su horario, WhatsApp y mapa; no puede cambiar su nombre, dirección ni publicarse", async () => {
      const aliado = await user("a@x.com", { isRefillAlly: true, allyStation: station({ isPublic: false }) });
      const result = await update(aliado, {
        schedule: "Lunes a viernes, 9:00 a 17:00",
        whatsapp: "55 9988 7766",
        mapsUrl: "https://maps.app.goo.gl/AbC123",
        businessName: "Otro nombre",
        address: "Otra calle",
        isPublic: "on",
      });
      expect(result.body.ok).toBe(true);
      const saved = await UserModel.findById(aliado._id).lean();
      expect(saved!.allyStation).toMatchObject({
        schedule: "Lunes a viernes, 9:00 a 17:00",
        whatsapp: "5599887766",
        mapsUrl: "https://maps.app.goo.gl/AbC123",
        businessName: "Veterinaria San Ángel",
        address: "Av. Revolución 1500",
        isPublic: false,
      });
    });

    it("rechaza un WhatsApp inválido y un enlace que no es de Google Maps", async () => {
      const aliado = await user("a@x.com", { isRefillAlly: true, allyStation: station() });
      expect((await update(aliado, { schedule: "9 a 5", whatsapp: "123" })).status).toBe(400);
      const bad = await update(aliado, { schedule: "9 a 5", whatsapp: "5511223344", mapsUrl: "https://malo.example/maps" });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatch(/Google Maps/);
    });

    it("un punto que ya está en el directorio no puede quedarse sin horario ni WhatsApp", async () => {
      const aliado = await user("a@x.com", { isRefillAlly: true, allyStation: station({ isPublic: true }) });
      expect((await update(aliado, { schedule: "", whatsapp: "5511223344" })).status).toBe(400);
      expect((await UserModel.findById(aliado._id).lean())!.allyStation!.schedule).toBe("Lunes a sábado, 10:00 a 18:00");
    });

    it("quien no es aliado no puede usar esta acción", async () => {
      const normal = await user("n@x.com");
      expect((await update(normal, { schedule: "9 a 5", whatsapp: "5511223344" })).status).toBe(400);
      expect((await UserModel.findById(normal._id).lean())!.allyStation).toBeUndefined();
    });

    async function ProductModelCreate() {
      const { ProductModel } = await import("~/models/product.server");
      await ProductModel.create({ name: "Bidón 20L", sku: "BIDON-20L", price: 3000, stock: 5, visibility: "ALLY_ONLY" });
      await ProductModel.create({ name: "Concentrado 1L", sku: "CONC-1L", price: 400, stock: 5 });
    }
  });
});
