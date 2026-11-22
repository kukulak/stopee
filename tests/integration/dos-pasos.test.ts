import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse, outcomeOf } from "../helpers/http";

type RouteArgs = { request: Request; params: object; context: object };
type Handler = (args: RouteArgs) => Promise<Response>;

const PASSWORD = "Perrito-Feliz-2031";
const PASSWORD_HASH = "$2a$12$767uVjA5wWsU31UJzLctX.bjMWdgYiAmxHlq8Xhu0GZNmUuzAA.z2"; // ver contrasenas-bcrypt.test.ts

/**
 * Verificación en dos pasos del panel, de punta a punta contra un Mongo desechable: activación,
 * entrada con código, códigos de recuperación, y que la contraseña sola (o una sesión de la tienda)
 * nunca abra el panel de quien la tiene activada.
 */
describe.skipIf(!hasTestDb)("verificación en dos pasos", () => {
  let adminLogin: { action: Handler; loader: Handler };
  let verificar: { action: Handler; loader: Handler };
  let seguridad: { action: Handler; loader: Handler };
  let customerLogin: Handler;
  let session: typeof import("~/lib/session.server");
  let totp: typeof import("~/lib/totp.server");
  let UserModel: typeof import("~/models/user.server").UserModel;
  let connectDB: typeof import("~/lib/db.server").connectDB;

  beforeAll(async () => {
    assertDisposableDb();
    const wrap = async (load: Promise<unknown>) => {
      const mod = (await load) as { action: Handler; loader: Handler };
      return { action: asResponse(mod.action), loader: asResponse(mod.loader) };
    };
    adminLogin = await wrap(import("~/routes/admin_.login"));
    verificar = await wrap(import("~/routes/admin_.verificar"));
    seguridad = await wrap(import("~/routes/admin_.seguridad"));
    customerLogin = (await wrap(import("~/routes/cuenta_.entrar"))).action;
    session = await import("~/lib/session.server");
    totp = await import("~/lib/totp.server");
    ({ UserModel } = await import("~/models/user.server"));
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
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Ayudas --------------------------------------------------------------

  let counter = 0;
  const freshIp = () => `192.168.${(++counter >> 8) & 255}.${counter & 255}`;
  const uniqueEmail = () => `admin${++counter}@correo.com`;

  function post(path: string, fields: Record<string, string>, cookie?: string) {
    const headers = new Headers({ "x-forwarded-for": freshIp() });
    if (cookie) headers.set("cookie", cookie);
    return new Request(`https://stopee.test${path}`, { method: "POST", headers, body: new URLSearchParams(fields) });
  }
  const get = (path: string, cookie?: string) =>
    new Request(`https://stopee.test${path}`, { headers: { "x-forwarded-for": freshIp(), ...(cookie ? { cookie } : {}) } });
  const args = (request: Request): RouteArgs => ({ request, params: {}, context: {} });

  /** Todas las cookies que fija una respuesta, como "nombre=valor". */
  const cookiesOf = (response: Response) => response.headers.getSetCookie().map((c) => c.split(";")[0]);
  const cookieNamed = (response: Response, name: string) => cookiesOf(response).find((c) => c.startsWith(`${name}=`));
  const joinCookies = (...cookies: (string | undefined)[]) => cookies.filter(Boolean).join("; ");

  /** Ejecuta algo que puede lanzar una Response (redirección o 403) y devuelve siempre la Response. */
  const outcome = outcomeOf;

  async function makeAdmin(opts: { enrolled?: boolean; role?: string; email?: string } = {}) {
    const secret = totp.generateTotpSecret();
    const recovery = totp.generateRecoveryCodes();
    const user = await UserModel.create({
      email: opts.email ?? uniqueEmail(),
      passwordHash: PASSWORD_HASH,
      emailVerifiedAt: new Date(),
      role: opts.role ?? "admin",
      ...(opts.enrolled === false
        ? {}
        : {
            twoFactor: {
              secretEnc: totp.encryptSecret(secret),
              enabledAt: new Date(),
              recoveryCodes: recovery.map((c) => ({ hash: totp.hashRecoveryCode(c) })),
            },
          }),
    });
    return { user, secret, recovery };
  }

  const codeNow = (secret: string, offset = 0) => totp.totpCode(secret, totp.timeStep() + offset);

  /** Contraseña correcta en /admin/login -> respuesta (redirección al desafío, o sesión directa). */
  const passwordStep = (email: string) => adminLogin.action(args(post("/admin/login", { email, password: PASSWORD })));

  /** Recorrido completo: contraseña + código. Devuelve la respuesta final y la cookie de sesión. */
  async function fullLogin(email: string, code: string) {
    const first = await passwordStep(email);
    const challenge = cookieNamed(first, "__stopee_2fa")!;
    const final = await verificar.action(args(post("/admin/verificar", { code }, challenge)));
    return { first, final, sessionCookie: cookieNamed(final, "__stopee_session") };
  }

  // --- Entrar con 2FA ------------------------------------------------------------

  describe("entrar al panel", () => {
    it("con la contraseña correcta NO hay sesión todavía: solo el paso intermedio hacia el código", async () => {
      const { user } = await makeAdmin();
      const response = await passwordStep(user.email);

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/verificar");
      expect(cookieNamed(response, "__stopee_2fa")).toBeTruthy();
      expect(cookieNamed(response, "__stopee_session")).toBeUndefined();
    });

    it("con el código correcto abre la sesión verificada y entra al panel", async () => {
      const { user, secret } = await makeAdmin();
      const { final, sessionCookie } = await fullLogin(user.email, codeNow(secret));

      expect(final.status).toBe(302);
      expect(final.headers.get("location")).toBe("/admin");
      expect(sessionCookie).toBeTruthy();
      // La cookie del paso intermedio se borra.
      expect(final.headers.getSetCookie().some((c) => c.startsWith("__stopee_2fa=;") || /__stopee_2fa=[^;]*;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(c))).toBe(true);

      const admin = await session.requireAdmin(get("/admin", sessionCookie));
      expect(admin.email).toBe(user.email);
    });

    it("respeta a dónde iba el administrador, sin permitir redirigir a otro sitio", async () => {
      const { user, secret } = await makeAdmin();
      const first = await adminLogin.action(args(post("/admin/login", { email: user.email, password: PASSWORD, redirectTo: "/admin/orders" })));
      const ok = await verificar.action(args(post("/admin/verificar", { code: codeNow(secret) }, cookieNamed(first, "__stopee_2fa"))));
      expect(ok.headers.get("location")).toBe("/admin/orders");

      const { user: otro, secret: s2 } = await makeAdmin();
      const first2 = await adminLogin.action(args(post("/admin/login", { email: otro.email, password: PASSWORD, redirectTo: "//sitio-falso.com" })));
      const ok2 = await verificar.action(args(post("/admin/verificar", { code: codeNow(s2) }, cookieNamed(first2, "__stopee_2fa"))));
      expect(ok2.headers.get("location")).toBe("/admin");
    });

    it("un código incorrecto no abre la sesión", async () => {
      const { user, secret } = await makeAdmin();
      const first = await passwordStep(user.email);
      const wrong = codeNow(secret) === "000000" ? "111111" : "000000";
      const response = await verificar.action(args(post("/admin/verificar", { code: wrong }, cookieNamed(first, "__stopee_2fa"))));

      expect(response.status).toBe(401);
      expect(cookieNamed(response, "__stopee_session")).toBeUndefined();
    });

    it("sin código escrito pide escribirlo, sin gastar un intento válido", async () => {
      const { user } = await makeAdmin();
      const first = await passwordStep(user.email);
      const response = await verificar.action(args(post("/admin/verificar", { code: "  " }, cookieNamed(first, "__stopee_2fa"))));
      expect(response.status).toBe(400);
    });

    it("el código funciona con el espacio que muchas apps muestran (123 456)", async () => {
      const { user, secret } = await makeAdmin();
      const code = codeNow(secret);
      const { final } = await fullLogin(user.email, `${code.slice(0, 3)} ${code.slice(3)}`);
      expect(final.status).toBe(302);
    });

    it("sin pasar antes por la contraseña, la pantalla del código no sirve", async () => {
      const loader = await verificar.loader(args(get("/admin/verificar")));
      expect(loader.status).toBe(302);
      expect(loader.headers.get("location")).toBe("/admin/login");

      const action = await verificar.action(args(post("/admin/verificar", { code: "123456" })));
      expect(action.status).toBe(302);
      expect(action.headers.get("location")).toBe("/admin/login");
    });

    it("una cookie del paso intermedio inventada o alterada no sirve", async () => {
      const { user } = await makeAdmin();
      const falsa = `__stopee_2fa=${Buffer.from(JSON.stringify({ userId: String(user._id) })).toString("base64")}`;
      const response = await verificar.action(args(post("/admin/verificar", { code: "123456" }, falsa)));
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/login");
    });

    it("la contraseña incorrecta ni siquiera llega al paso del código", async () => {
      const { user } = await makeAdmin();
      const response = await adminLogin.action(args(post("/admin/login", { email: user.email, password: "equivocada-123" })));
      expect(response.status).toBe(401);
      expect(cookieNamed(response, "__stopee_2fa")).toBeUndefined();
    });
  });

  // --- Un código vale una sola vez --------------------------------------------------

  describe("un código no se reutiliza", () => {
    it("el mismo código no sirve dos veces, ni siquiera desde otra sesión", async () => {
      const { user, secret } = await makeAdmin();
      const code = codeNow(secret);
      const primera = await fullLogin(user.email, code);
      expect(primera.final.status).toBe(302);

      const segunda = await fullLogin(user.email, code);
      expect(segunda.final.status).toBe(401); // alguien que lo viera por encima del hombro no puede usarlo
    });

    it("dos intentos simultáneos con el mismo código: solo uno entra", async () => {
      const { user, secret } = await makeAdmin();
      const code = codeNow(secret);
      const a = cookieNamed(await passwordStep(user.email), "__stopee_2fa");
      const b = cookieNamed(await passwordStep(user.email), "__stopee_2fa");
      const results = await Promise.all([
        verificar.action(args(post("/admin/verificar", { code }, a))),
        verificar.action(args(post("/admin/verificar", { code }, b))),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([302, 401]);
    });

    it("el código del siguiente periodo de 30 s sí sirve", async () => {
      const { user, secret } = await makeAdmin();
      expect((await fullLogin(user.email, codeNow(secret))).final.status).toBe(302);
      expect((await fullLogin(user.email, codeNow(secret, 1))).final.status).toBe(302);
    });
  });

  // --- Fuerza bruta -------------------------------------------------------------------------

  describe("límite de intentos", () => {
    it("después de 5 códigos equivocados bloquea, aunque el siguiente fuera el correcto", async () => {
      const { user, secret } = await makeAdmin();
      const first = await passwordStep(user.email);
      const challenge = cookieNamed(first, "__stopee_2fa");
      const right = codeNow(secret);
      const wrong = ["111111", "222222", "333333", "444444", "555555"].map((c) => (c === right ? "999999" : c));

      for (const code of wrong) {
        const r = await verificar.action(args(post("/admin/verificar", { code }, challenge)));
        expect(r.status).toBe(401);
      }
      const bloqueado = await verificar.action(args(post("/admin/verificar", { code: right }, challenge)));
      expect(bloqueado.status).toBe(429);
      expect(cookieNamed(bloqueado, "__stopee_session")).toBeUndefined();
    });
  });

  // --- Códigos de recuperación -----------------------------------------------------------------

  describe("códigos de recuperación", () => {
    it("sirven para entrar sin el celular, cada uno una sola vez", async () => {
      const { user, recovery } = await makeAdmin();
      const primera = await fullLogin(user.email, recovery[0]);
      expect(primera.final.status).toBe(302);
      expect(primera.sessionCookie).toBeTruthy();

      const repetido = await fullLogin(user.email, recovery[0]);
      expect(repetido.final.status).toBe(401);

      const otro = await fullLogin(user.email, recovery[1].toLowerCase().replace("-", " "));
      expect(otro.final.status).toBe(302); // minúsculas y espacio también valen
    });

    it("un código de recuperación inventado no entra", async () => {
      const { user } = await makeAdmin();
      expect((await fullLogin(user.email, "ABCDE-FGHJK")).final.status).toBe(401);
    });

    it("el código de recuperación de otra cuenta no sirve", async () => {
      const { user } = await makeAdmin();
      const { recovery } = await makeAdmin();
      expect((await fullLogin(user.email, recovery[0])).final.status).toBe(401);
    });
  });

  // --- Qué abre el panel --------------------------------------------------------------------------

  describe("el panel exige la verificación", () => {
    it("una sesión de solo contraseña no abre el panel de quien tiene 2FA activa", async () => {
      const { user } = await makeAdmin();
      // Entrando por el login de la tienda (sin código) se obtiene una sesión de cliente.
      const tienda = await customerLogin(args(post("/cuenta/entrar", { email: user.email, password: PASSWORD })));
      expect(tienda.status).toBe(302);
      const cookie = cookieNamed(tienda, "__stopee_session")!;

      const response = (await outcome(() => session.requireAdmin(get("/admin", cookie)))) as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("/admin/login");
    });

    it("esa sesión de solo contraseña tampoco rebota en bucle: /admin/login muestra el formulario", async () => {
      const { user } = await makeAdmin();
      const tienda = await customerLogin(args(post("/cuenta/entrar", { email: user.email, password: PASSWORD })));
      const cookie = cookieNamed(tienda, "__stopee_session")!;

      const loader = await adminLogin.loader(args(get("/admin/login", cookie)));
      expect(loader.status).toBe(200); // no redirige de vuelta a /admin
    });

    it("con sesión verificada, /admin/login manda directo al panel", async () => {
      const { user, secret } = await makeAdmin();
      const { sessionCookie } = await fullLogin(user.email, codeNow(secret));
      const loader = await adminLogin.loader(args(get("/admin/login", sessionCookie)));
      expect(loader.status).toBe(302);
      expect(loader.headers.get("location")).toBe("/admin");
    });

    it("un administrador SIN 2FA activa no entra al panel: se le manda a activarla", async () => {
      const { user } = await makeAdmin({ enrolled: false });
      const first = await passwordStep(user.email);
      expect(first.status).toBe(302);
      const cookie = cookieNamed(first, "__stopee_session")!; // sesión abierta solo para poder activarla

      const response = (await outcome(() => session.requireAdmin(get("/admin/orders", cookie)))) as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/seguridad");
    });

    it("lo mismo vale para super administradores", async () => {
      const { user } = await makeAdmin({ enrolled: false, role: "superadmin" });
      const cookie = cookieNamed(await passwordStep(user.email), "__stopee_session")!;
      const response = (await outcome(() => session.requireSuperAdmin(get("/admin/customers/new", cookie)))) as Response;
      expect(response.headers.get("location")).toBe("/admin/seguridad");
    });

    it("el resultado de requireAdmin no incluye secretos ni el hash de la contraseña", async () => {
      const { user, secret } = await makeAdmin();
      const { sessionCookie } = await fullLogin(user.email, codeNow(secret));
      const admin = await session.requireAdmin(get("/admin", sessionCookie));
      const json = JSON.stringify(admin);
      expect(json).not.toContain("secretEnc");
      expect(json).not.toContain("recoveryCodes\":[{");
      expect(json).not.toContain(PASSWORD_HASH);
      expect(admin.twoFactorEnabled).toBe(true);
    });

    it("si le quitan el rol mientras escribe el código, no entra", async () => {
      const { user, secret } = await makeAdmin();
      const first = await passwordStep(user.email);
      await UserModel.updateOne({ _id: user._id }, { role: "customer" });
      const response = await verificar.action(args(post("/admin/verificar", { code: codeNow(secret) }, cookieNamed(first, "__stopee_2fa"))));
      expect(response.headers.get("location")).toBe("/admin/login");
      expect(cookieNamed(response, "__stopee_session")).toBeUndefined();
    });
  });

  // --- Activación --------------------------------------------------------------------------------------

  describe("activación", () => {
    async function enrollingAdmin() {
      const { user } = await makeAdmin({ enrolled: false });
      const cookie = cookieNamed(await passwordStep(user.email), "__stopee_session")!;
      return { user, cookie };
    }

    const loaderData = async (cookie: string) => (await seguridad.loader(args(get("/admin/seguridad", cookie)))).json();

    it("muestra un QR y la clave para escribir a mano, y conserva el mismo secreto al recargar", async () => {
      const { cookie } = await enrollingAdmin();
      const a = await loaderData(cookie);
      const b = await loaderData(cookie);

      expect(a.enabled).toBe(false);
      expect(a.qr).toMatch(/^data:image\/png;base64,/);
      expect(a.secret).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
      expect(b.secret).toBe(a.secret); // recargar no invalida el QR que ya se escaneó
    });

    it("el secreto pendiente se guarda cifrado, nunca en claro", async () => {
      const { user, cookie } = await enrollingAdmin();
      const { secret } = await loaderData(cookie);
      const stored = await UserModel.findById(user._id).lean();
      expect(JSON.stringify(stored)).not.toContain(secret.replace(/ /g, ""));
      expect(totp.decryptSecret(stored!.twoFactor!.pendingSecretEnc)).toBe(secret.replace(/ /g, ""));
    });

    it("un código equivocado no activa nada", async () => {
      const { user, cookie } = await enrollingAdmin();
      await loaderData(cookie);
      const r = await seguridad.action(args(post("/admin/seguridad", { intent: "enable", code: "000000" }, cookie)));
      expect(r.status).toBe(400);
      expect((await UserModel.findById(user._id).lean())!.twoFactor?.enabledAt).toBeFalsy();
    });

    it("con el código correcto se activa, entrega 10 códigos de recuperación y deja la sesión verificada", async () => {
      const { user, cookie } = await enrollingAdmin();
      const { secret } = await loaderData(cookie);
      const code = totp.totpCode(secret.replace(/ /g, ""), totp.timeStep());

      const r = await seguridad.action(args(post("/admin/seguridad", { intent: "enable", code }, cookie)));
      expect(r.status).toBe(200);
      const { recoveryCodes } = await r.json();
      expect(recoveryCodes).toHaveLength(10);

      // En la base solo quedan huellas y el secreto cifrado; el pendiente se borra.
      const stored = await UserModel.findById(user._id).lean();
      expect(stored!.twoFactor!.enabledAt).toBeTruthy();
      expect(stored!.twoFactor!.pendingSecretEnc).toBeUndefined();
      expect(stored!.twoFactor!.recoveryCodes).toHaveLength(10);
      const raw = JSON.stringify(stored);
      for (const c of recoveryCodes) expect(raw).not.toContain(c);
      expect(raw).not.toContain(secret.replace(/ /g, ""));

      // La sesión que acaba de activarla ya cuenta como verificada: entra al panel sin repetir el código.
      const upgraded = cookieNamed(r, "__stopee_session")!;
      expect((await session.requireAdmin(get("/admin", upgraded))).email).toBe(user.email);
    });

    it("el código con el que se activa no se puede reutilizar para entrar enseguida", async () => {
      const { user, cookie } = await enrollingAdmin();
      const { secret } = await loaderData(cookie);
      const code = totp.totpCode(secret.replace(/ /g, ""), totp.timeStep());
      await seguridad.action(args(post("/admin/seguridad", { intent: "enable", code }, cookie)));
      expect((await fullLogin(user.email, code)).final.status).toBe(401);
    });

    it("los códigos de recuperación recién entregados sirven para entrar", async () => {
      const { user, cookie } = await enrollingAdmin();
      const { secret } = await loaderData(cookie);
      const code = totp.totpCode(secret.replace(/ /g, ""), totp.timeStep());
      const r = await seguridad.action(args(post("/admin/seguridad", { intent: "enable", code }, cookie)));
      const { recoveryCodes } = await r.json();
      expect((await fullLogin(user.email, recoveryCodes[3])).final.status).toBe(302);
    });

    it("una cuenta que ya la tiene activa no puede reemplazar el secreto desde la pantalla de activación", async () => {
      const { user, secret } = await makeAdmin();
      const { sessionCookie } = await fullLogin(user.email, codeNow(secret));
      const before = (await UserModel.findById(user._id).lean())!.twoFactor!.secretEnc;
      const r = await seguridad.action(args(post("/admin/seguridad", { intent: "enable", code: codeNow(secret, 1) }, sessionCookie)));
      expect(r.status).toBe(400);
      expect((await UserModel.findById(user._id).lean())!.twoFactor!.secretEnc).toBe(before);
    });

    it("quien no ha iniciado sesión no puede ver ni activar nada", async () => {
      const loader = (await outcome(() => seguridad.loader(args(get("/admin/seguridad"))))) as Response;
      expect(loader.status).toBe(302);
      expect(loader.headers.get("location")).toContain("/admin/login");
      const action = (await outcome(() => seguridad.action(args(post("/admin/seguridad", { intent: "enable", code: "123456" }))))) as Response;
      expect(action.status).toBe(302);
    });

    it("un cliente (no administrador) no puede usar la pantalla de activación", async () => {
      const user = await UserModel.create({ email: "cliente@correo.com", passwordHash: PASSWORD_HASH, emailVerifiedAt: new Date() });
      const s = await session.sessionStorage.getSession();
      s.set("userId", String(user._id));
      s.set("iat", Date.now());
      const cookie = (await session.sessionStorage.commitSession(s)).split(";")[0];
      const r = (await outcome(() => seguridad.loader(args(get("/admin/seguridad", cookie))))) as Response;
      expect(r.status).toBe(403);
    });
  });

  // --- Códigos nuevos ------------------------------------------------------------------------------------

  describe("generar códigos de recuperación nuevos", () => {
    it("pide un código vigente de la app, invalida los anteriores y entrega 10 nuevos", async () => {
      const { user, secret, recovery } = await makeAdmin();
      const { sessionCookie } = await fullLogin(user.email, codeNow(secret));

      const sinCodigo = await seguridad.action(args(post("/admin/seguridad", { intent: "regenerate", code: "000000" }, sessionCookie)));
      expect(sinCodigo.status).toBe(400);

      const ok = await seguridad.action(args(post("/admin/seguridad", { intent: "regenerate", code: codeNow(secret, 1) }, sessionCookie)));
      expect(ok.status).toBe(200);
      const { recoveryCodes } = await ok.json();
      expect(recoveryCodes).toHaveLength(10);

      expect((await fullLogin(user.email, recovery[0])).final.status).toBe(401); // un código viejo ya no entra
      expect((await fullLogin(user.email, recoveryCodes[0])).final.status).toBe(302); // uno nuevo sí
    });

    it("no basta una sesión abierta: un código de recuperación no sirve para generar otros", async () => {
      const { user, secret, recovery } = await makeAdmin();
      const { sessionCookie } = await fullLogin(user.email, codeNow(secret));
      const r = await seguridad.action(args(post("/admin/seguridad", { intent: "regenerate", code: recovery[0] }, sessionCookie)));
      expect(r.status).toBe(400);
    });

    it("la pantalla avisa cuántos códigos quedan", async () => {
      const { user, secret, recovery } = await makeAdmin();
      await fullLogin(user.email, recovery[0]);
      const { sessionCookie } = await fullLogin(user.email, codeNow(secret));
      const data = await (await seguridad.loader(args(get("/admin/seguridad", sessionCookie)))).json();
      expect(data).toMatchObject({ enabled: true, recoveryCodesLeft: 9 });
    });
  });

  // --- Si cambia la llave de cifrado -----------------------------------------------------------------------------

  describe("si SESSION_SECRET cambia", () => {
    it("los códigos del celular dejan de valer, pero los de recuperación siguen sirviendo", async () => {
      const { user, secret, recovery } = await makeAdmin();
      const original = process.env.SESSION_SECRET;
      process.env.SESSION_SECRET = "otro-secreto-completamente-distinto-9876543210";
      try {
        // Con otra llave la cookie de sesión tampoco valdría; aquí se prueba solo el secreto guardado.
        const r = await totpStillWorks(user._id, codeNow(secret));
        expect(r).toBe(false);
        const rec = await totpStillWorks(user._id, recovery[0]);
        expect(rec).toBe(true);
      } finally {
        process.env.SESSION_SECRET = original;
      }
    });

    async function totpStillWorks(userId: unknown, input: string) {
      const { verifySecondFactor } = await import("~/lib/twoFactor.server");
      return (await verifySecondFactor(userId, input)).ok;
    }
  });
});
