import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse, outcomeOf } from "../helpers/http";

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/mail.server", () => ({ sendEmail, isMailConfigured: () => true }));

type RouteArgs = { request: Request; params: object; context: object };
type Action = (args: RouteArgs) => Promise<Response>;

const PASSWORD = "Perrito-Feliz-2031";
// Generado con bcryptjs 2.4.3 (ver contrasenas-bcrypt.test.ts): evita pagar un bcrypt por cada usuario de prueba.
const PASSWORD_HASH = "$2a$12$767uVjA5wWsU31UJzLctX.bjMWdgYiAmxHlq8Xhu0GZNmUuzAA.z2";

/**
 * Inicio de sesión, sesiones, enlaces de correo y roles, ejecutados de verdad contra un
 * Mongo desechable. Es la puerta de la tienda y del panel: si algo aquí se rompe, nadie entra
 * (o, peor, entra quien no debe).
 */
describe.skipIf(!hasTestDb)("cuentas y acceso", () => {
  let login: Action;
  let adminLogin: Action;
  let registro: Action;
  let restablecer: Action;
  let verificar: (args: RouteArgs) => Promise<Response>;
  let session: typeof import("~/lib/session.server");
  let tokens: typeof import("~/lib/authTokens.server");
  let UserModel: typeof import("~/models/user.server").UserModel;
  let AuthTokenModel: typeof import("~/models/authToken.server").AuthTokenModel;
  let connectDB: typeof import("~/lib/db.server").connectDB;

  beforeAll(async () => {
    assertDisposableDb();
    login = asResponse(((await import("~/routes/cuenta_.entrar")) as never as { action: Action }).action);
    adminLogin = asResponse(((await import("~/routes/admin_.login")) as never as { action: Action }).action);
    registro = asResponse(((await import("~/routes/cuenta_.registro")) as never as { action: Action }).action);
    restablecer = asResponse(((await import("~/routes/cuenta_.restablecer")) as never as { action: Action }).action);
    verificar = asResponse(((await import("~/routes/cuenta_.verificar")) as never as { loader: Action }).loader);
    session = await import("~/lib/session.server");
    tokens = await import("~/lib/authTokens.server");
    ({ UserModel } = await import("~/models/user.server"));
    ({ AuthTokenModel } = await import("~/models/authToken.server"));
    ({ connectDB } = await import("~/lib/db.server"));
    await connectDB();
  });

  afterAll(async () => {
    await dropDb();
  });

  beforeEach(async () => {
    (await import("~/lib/rateLimit.server")).resetRateLimits(); // los topes por correo no deben pasar de una prueba a otra
    await wipeDb();
    vi.restoreAllMocks();
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ ok: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  // --- Ayudas --------------------------------------------------------------

  // Cada petición sale de una IP distinta para que el límite por IP (en memoria) no se mezcle entre pruebas.
  let ipCounter = 0;
  const freshIp = () => `10.${(++ipCounter >> 8) & 255}.${ipCounter & 255}.1`;

  function post(path: string, fields: Record<string, string>, opts: { ip?: string; cookie?: string } = {}) {
    const headers = new Headers({ "x-forwarded-for": opts.ip ?? freshIp() });
    if (opts.cookie) headers.set("cookie", opts.cookie);
    return new Request(`https://stopee.test${path}`, { method: "POST", headers, body: new URLSearchParams(fields) });
  }

  const get = (path: string, cookie?: string, ip = freshIp()) =>
    new Request(`https://stopee.test${path}`, { headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) } });

  const args = (request: Request): RouteArgs => ({ request, params: {}, context: {} });

  /** "__stopee_session=abc; Path=/; ..." -> "__stopee_session=abc" */
  const cookieFrom = (response: Response) => (response.headers.get("set-cookie") ?? "").split(";")[0];

  async function makeUser(overrides: Record<string, unknown> = {}) {
    return UserModel.create({
      email: "ana@correo.com",
      passwordHash: PASSWORD_HASH,
      emailVerifiedAt: new Date(),
      ...overrides,
    });
  }

  /** Administrador con la verificación en dos pasos activa (el panel la exige; ver dos-pasos.test.ts). */
  const makeStaff = (overrides: Record<string, unknown> = {}) =>
    makeUser({ role: "admin", twoFactor: { enabledAt: new Date(), secretEnc: "no-se-usa-aqui" }, ...overrides });

  /** Cookie de sesión con el momento de inicio que se pida (por defecto, ahora). */
  async function sessionCookieFor(userId: unknown, issuedAt = Date.now(), secondFactor = false) {
    const s = await session.sessionStorage.getSession();
    s.set("userId", String(userId));
    s.set("iat", issuedAt);
    if (secondFactor) s.set("mfa", true);
    return (await session.sessionStorage.commitSession(s)).split(";")[0];
  }

  /** Respuesta o excepción (las rutas lanzan redirecciones y 403): se devuelve siempre la Response. */
  const outcome = outcomeOf;

  // --- Inicio de sesión de clientes ------------------------------------------

  describe("inicio de sesión", () => {
    it("con la contraseña correcta abre sesión y lleva a la cuenta", async () => {
      await makeUser();
      const response = await login(args(post("/cuenta/entrar", { email: "ana@correo.com", password: PASSWORD })));

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/cuenta");
      const cookie = cookieFrom(response);
      expect(cookie).toMatch(/^__stopee_session=/);
      expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
      expect(response.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);

      const user = await session.getUser(get("/cuenta", cookie));
      expect(user?.email).toBe("ana@correo.com");
    });

    it("el correo no distingue mayúsculas ni espacios", async () => {
      await makeUser();
      const response = await login(args(post("/cuenta/entrar", { email: "  ANA@Correo.COM ", password: PASSWORD })));
      expect(response.status).toBe(302);
    });

    it("contraseña equivocada y correo inexistente dan exactamente la misma respuesta", async () => {
      await makeUser();
      const mala = await login(args(post("/cuenta/entrar", { email: "ana@correo.com", password: "otra-cosa-123" })));
      const fantasma = await login(args(post("/cuenta/entrar", { email: "nadie@correo.com", password: PASSWORD })));

      expect(mala.status).toBe(401);
      expect(fantasma.status).toBe(401);
      expect(await mala.json()).toEqual(await fantasma.json()); // no revela qué correos tienen cuenta
      expect(mala.headers.get("set-cookie")).toBeNull();
    });

    it("sin correo o sin contraseña pide los datos", async () => {
      const a = await login(args(post("/cuenta/entrar", { email: "", password: PASSWORD })));
      const b = await login(args(post("/cuenta/entrar", { email: "ana@correo.com", password: "" })));
      expect(a.status).toBe(400);
      expect(b.status).toBe(400);
    });

    it("con la contraseña correcta pero el correo sin confirmar, no entra", async () => {
      await makeUser({ emailVerifiedAt: undefined });
      const response = await login(args(post("/cuenta/entrar", { email: "ana@correo.com", password: PASSWORD })));

      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
      const body = await response.json();
      expect(body.unverifiedEmail).toBe("ana@correo.com");
      expect(body.error).toMatch(/confirmar tu correo/);
    });

    it("no se puede usar para redirigir a otro sitio", async () => {
      await makeUser();
      for (const malo of ["//sitio-falso.com", "https://sitio-falso.com", "/\\sitio-falso.com", "javascript:alert(1)"]) {
        const response = await login(args(post("/cuenta/entrar", { email: "ana@correo.com", password: PASSWORD, redirectTo: malo })));
        expect(response.headers.get("location"), malo).toBe("/cuenta");
      }
      const bueno = await login(args(post("/cuenta/entrar", { email: "ana@correo.com", password: PASSWORD, redirectTo: "/tienda" })));
      expect(bueno.headers.get("location")).toBe("/tienda");
    });

    it("después de 8 intentos desde una misma IP, bloquea (aunque el siguiente fuera correcto)", async () => {
      await makeUser();
      const ip = freshIp();
      for (let i = 0; i < 8; i++) {
        const r = await login(args(post("/cuenta/entrar", { email: `x${i}@correo.com`, password: "mala-contraseña" }, { ip })));
        expect(r.status).toBe(401);
      }
      const bloqueado = await login(args(post("/cuenta/entrar", { email: "ana@correo.com", password: PASSWORD }, { ip })));
      expect(bloqueado.status).toBe(429);
      expect(bloqueado.headers.get("set-cookie")).toBeNull();
    });

    it("cambiar de IP no sirve para seguir probando contraseñas contra la misma cuenta", async () => {
      await makeUser({ email: "victima@correo.com" });
      let ultimo = 0;
      for (let i = 0; i < 12; i++) {
        const r = await login(args(post("/cuenta/entrar", { email: "victima@correo.com", password: `mala-${i}-xyz` })));
        ultimo = r.status;
      }
      expect(ultimo).toBe(429); // el tope por correo corta aunque cada intento venga de otra IP
      const correcta = await login(args(post("/cuenta/entrar", { email: "victima@correo.com", password: PASSWORD })));
      expect(correcta.status).toBe(429);
    });
  });

  // --- Inicio de sesión del panel ---------------------------------------------

  describe("acceso al panel de administración", () => {
    it("un cliente con contraseña correcta no entra", async () => {
      await makeUser({ role: "customer" });
      const response = await adminLogin(args(post("/admin/login", { email: "ana@correo.com", password: PASSWORD })));
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("un administrador con correo confirmado entra al panel", async () => {
      await makeUser({ role: "admin" });
      const response = await adminLogin(args(post("/admin/login", { email: "ana@correo.com", password: PASSWORD })));
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin");
      expect(cookieFrom(response)).toMatch(/^__stopee_session=/);
    });

    it("un administrador sin correo confirmado no entra", async () => {
      await makeUser({ role: "superadmin", emailVerifiedAt: undefined });
      const response = await adminLogin(args(post("/admin/login", { email: "ana@correo.com", password: PASSWORD })));
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("contraseña equivocada: mismo mensaje que cuenta inexistente", async () => {
      await makeUser({ role: "admin" });
      const mala = await adminLogin(args(post("/admin/login", { email: "ana@correo.com", password: "equivocada-123" })));
      const fantasma = await adminLogin(args(post("/admin/login", { email: "nadie@correo.com", password: PASSWORD })));
      expect(mala.status).toBe(401);
      expect(await mala.json()).toEqual(await fantasma.json());
    });
  });

  // --- Sesiones -----------------------------------------------------------------

  describe("sesiones", () => {
    it("sin cookie, o con una cookie alterada, no hay usuario", async () => {
      const user = await makeUser();
      expect(await session.getUser(get("/cuenta"))).toBeNull();

      const cookie = await sessionCookieFor(user._id);
      const alterada = cookie.slice(0, -4) + "AAAA";
      expect(await session.getUser(get("/cuenta", alterada))).toBeNull();
      expect(await session.getUser(get("/cuenta", "__stopee_session=" + Buffer.from(String(user._id)).toString("base64")))).toBeNull();
    });

    it("una sesión de una cuenta sin correo confirmado no vale", async () => {
      const user = await makeUser({ emailVerifiedAt: undefined });
      expect(await session.getUser(get("/cuenta", await sessionCookieFor(user._id)))).toBeNull();
    });

    it("si la cuenta se borró, la sesión deja de valer", async () => {
      const user = await makeUser();
      const cookie = await sessionCookieFor(user._id);
      await UserModel.deleteOne({ _id: user._id });
      expect(await session.getUser(get("/cuenta", cookie))).toBeNull();
    });

    it("cambiar la contraseña cierra las sesiones abiertas antes del cambio", async () => {
      const user = await makeUser();
      const vieja = await sessionCookieFor(user._id, Date.now() - 60_000);
      expect((await session.getUser(get("/cuenta", vieja)))?.email).toBe("ana@correo.com");

      await UserModel.updateOne({ _id: user._id }, { passwordChangedAt: new Date() });
      expect(await session.getUser(get("/cuenta", vieja))).toBeNull();

      const nueva = await sessionCookieFor(user._id, Date.now() + 1000);
      expect((await session.getUser(get("/cuenta", nueva)))?.email).toBe("ana@correo.com");
    });

    it("las páginas privadas mandan a iniciar sesión recordando a dónde iba", async () => {
      const response = await outcome(() => session.requireUserId(get("/cuenta/pedidos")));
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
      expect((response as Response).headers.get("location")).toBe("/cuenta/entrar?redirectTo=%2Fcuenta%2Fpedidos");
    });
  });

  // --- Roles --------------------------------------------------------------------

  describe("roles y panel", () => {
    it("sin sesión, el panel redirige al acceso de administrador", async () => {
      const response = (await outcome(() => session.requireAdmin(get("/admin/orders")))) as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/login?redirectTo=%2Fadmin%2Forders");
    });

    it("un cliente con sesión válida recibe 403, no el panel", async () => {
      const user = await makeUser({ role: "customer" });
      const cookie = await sessionCookieFor(user._id);
      const response = (await outcome(() => session.requireAdmin(get("/admin", cookie)))) as Response;
      expect(response.status).toBe(403);
    });

    it("un administrador con sesión reciente (verificada en dos pasos) entra", async () => {
      const user = await makeStaff();
      const result = await session.requireAdmin(get("/admin", await sessionCookieFor(user._id, Date.now(), true)));
      expect(result.email).toBe("ana@correo.com");
    });

    it("el acceso al panel caduca a las 8 horas aunque la cookie de cliente siga viva", async () => {
      const user = await makeStaff();
      const nueve = await sessionCookieFor(user._id, Date.now() - 9 * 3600_000, true);
      const response = (await outcome(() => session.requireAdmin(get("/admin", nueve)))) as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("/admin/login");

      const siete = await sessionCookieFor(user._id, Date.now() - 7 * 3600_000, true);
      expect((await session.requireAdmin(get("/admin", siete))).email).toBe("ana@correo.com");
    });

    it("quitarle el rol a un administrador le cierra el panel al instante", async () => {
      const user = await makeStaff();
      const cookie = await sessionCookieFor(user._id, Date.now(), true);
      await UserModel.updateOne({ _id: user._id }, { role: "customer" });
      const response = (await outcome(() => session.requireAdmin(get("/admin", cookie)))) as Response;
      expect(response.status).toBe(403);
    });

    it("solo un super administrador pasa lo reservado a super administradores", async () => {
      const admin = await makeStaff();
      const sup = await makeStaff({ email: "jefa@correo.com", role: "superadmin" });

      const cookieAdmin = await sessionCookieFor(admin._id, Date.now(), true);
      const cookieSuper = await sessionCookieFor(sup._id, Date.now(), true);
      const denegado = (await outcome(() => session.requireSuperAdmin(get("/admin/usuarios", cookieAdmin)))) as Response;
      expect(denegado.status).toBe(403);

      const permitido = await session.requireSuperAdmin(get("/admin/usuarios", cookieSuper));
      expect(permitido.email).toBe("jefa@correo.com");
    });
  });

  // --- Enlaces de un solo uso -----------------------------------------------------

  describe("enlaces de correo (confirmar y restablecer)", () => {
    it("se pueden usar una sola vez", async () => {
      const user = await makeUser();
      const token = await tokens.issueToken(user._id, "reset");
      expect(await tokens.peekToken(token, "reset")).toEqual({ userId: String(user._id) });
      expect(await tokens.consumeToken(token, "reset")).toEqual({ userId: String(user._id) });
      expect(await tokens.consumeToken(token, "reset")).toBeNull();
      expect(await tokens.peekToken(token, "reset")).toBeNull();
    });

    it("dos peticiones simultáneas con el mismo enlace: solo una gana", async () => {
      const user = await makeUser();
      const token = await tokens.issueToken(user._id, "reset");
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => tokens.consumeToken(token, "reset")));
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("un enlace vencido no sirve", async () => {
      const user = await makeUser();
      const token = await tokens.issueToken(user._id, "reset", -1000);
      expect(await tokens.peekToken(token, "reset")).toBeNull();
      expect(await tokens.consumeToken(token, "reset")).toBeNull();
    });

    it("un enlace de confirmar correo no sirve para restablecer contraseña, ni al revés", async () => {
      const user = await makeUser();
      const verify = await tokens.issueToken(user._id, "verify");
      expect(await tokens.consumeToken(verify, "reset")).toBeNull();
      expect(await tokens.consumeToken(verify, "verify")).not.toBeNull();
    });

    it("pedir un enlace nuevo invalida el anterior", async () => {
      const user = await makeUser();
      const viejo = await tokens.issueToken(user._id, "reset");
      const nuevo = await tokens.issueToken(user._id, "reset");
      expect(await tokens.peekToken(viejo, "reset")).toBeNull();
      expect(await tokens.peekToken(nuevo, "reset")).not.toBeNull();
    });

    it("en la base solo queda una huella del enlace, nunca el enlace mismo", async () => {
      const user = await makeUser();
      const token = await tokens.issueToken(user._id, "reset");
      const stored = await AuthTokenModel.findOne({ user: user._id }).lean();
      expect(JSON.stringify(stored)).not.toContain(token);
    });

    it("rechaza basura sin tocar la base", async () => {
      for (const basura of ["", "abc", "a".repeat(43) + "!", "' || '1'=='1", null, undefined]) {
        expect(await tokens.peekToken(basura as never, "reset")).toBeNull();
        expect(await tokens.consumeToken(basura as never, "verify")).toBeNull();
      }
    });
  });

  // --- Restablecer contraseña -------------------------------------------------------

  describe("restablecer la contraseña", () => {
    const NUEVA = "Mi-Nueva-Clave-2050";
    // Correo propio por prueba: el tope de intentos por correo vive en memoria y no se limpia entre pruebas.
    let n = 0;
    const correo = () => `reset${++n}@correo.com`;

    it("con un enlace válido cambia la contraseña, cierra sesiones viejas y avisa por correo", async () => {
      const email = correo();
      const user = await makeUser({ email });
      const sesionVieja = await sessionCookieFor(user._id, Date.now() - 60_000);
      const token = await tokens.issueToken(user._id, "reset");

      const response = await restablecer(args(post("/cuenta/restablecer", { token, password: NUEVA, confirmPassword: NUEVA })));
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/cuenta/entrar?restablecida=1");

      // La sesión abierta antes del cambio ya no vale.
      expect(await session.getUser(get("/cuenta", sesionVieja))).toBeNull();
      // La contraseña vieja ya no entra; la nueva sí.
      expect((await login(args(post("/cuenta/entrar", { email, password: PASSWORD })))).status).toBe(401);
      expect((await login(args(post("/cuenta/entrar", { email, password: NUEVA })))).status).toBe(302);
      // Se avisó de que la contraseña cambió.
      expect(sendEmail.mock.calls.some((c) => c[0].subject === "Tu contraseña de STOPee cambió")).toBe(true);
    });

    it("el enlace no se puede reutilizar", async () => {
      const email = correo();
      const user = await makeUser({ email });
      const token = await tokens.issueToken(user._id, "reset");
      await restablecer(args(post("/cuenta/restablecer", { token, password: NUEVA, confirmPassword: NUEVA })));
      const otra = await restablecer(args(post("/cuenta/restablecer", { token, password: "Otra-Clave-Mas-2051", confirmPassword: "Otra-Clave-Mas-2051" })));
      expect(otra.status).toBe(400);
      expect((await login(args(post("/cuenta/entrar", { email, password: "Otra-Clave-Mas-2051" })))).status).toBe(401);
    });

    it("una contraseña débil o que no coincide se rechaza SIN gastar el enlace", async () => {
      const email = correo();
      const user = await makeUser({ email });
      const token = await tokens.issueToken(user._id, "reset");

      const debil = await restablecer(args(post("/cuenta/restablecer", { token, password: "12345678", confirmPassword: "12345678" })));
      expect(debil.status).toBe(400);
      const distinta = await restablecer(args(post("/cuenta/restablecer", { token, password: NUEVA, confirmPassword: NUEVA + "x" })));
      expect(distinta.status).toBe(400);

      // El enlace sigue sirviendo para corregir el error.
      expect(await tokens.peekToken(token, "reset")).not.toBeNull();
      const bien = await restablecer(args(post("/cuenta/restablecer", { token, password: NUEVA, confirmPassword: NUEVA })));
      expect(bien.status).toBe(302);
    });

    it("un enlace falso o vencido no cambia nada", async () => {
      const email = correo();
      const user = await makeUser({ email });
      const vencido = await tokens.issueToken(user._id, "reset", -1000);
      for (const token of [vencido, "x".repeat(43), ""]) {
        const response = await restablecer(args(post("/cuenta/restablecer", { token, password: NUEVA, confirmPassword: NUEVA })));
        expect(response.status).toBe(400);
      }
      expect((await login(args(post("/cuenta/entrar", { email, password: PASSWORD })))).status).toBe(302);
    });

    it("quien restablece con el enlace de su correo queda con el correo confirmado", async () => {
      const user = await makeUser({ emailVerifiedAt: undefined });
      const token = await tokens.issueToken(user._id, "reset");
      await restablecer(args(post("/cuenta/restablecer", { token, password: NUEVA, confirmPassword: NUEVA })));
      expect((await UserModel.findById(user._id).lean())!.emailVerifiedAt).toBeTruthy();
    });
  });

  // --- Registro y confirmación de correo -----------------------------------------------

  describe("registro", () => {
    const datos = { email: "Luis@Correo.com", password: PASSWORD, confirmPassword: PASSWORD, name: "Luis", mascota: "Rocco" };

    it("crea la cuenta sin confirmar, con la contraseña cifrada, y manda el enlace; no abre sesión", async () => {
      const response = await registro(args(post("/cuenta/registro", datos)));
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();

      const user = await UserModel.findOne({ email: "luis@correo.com" }).lean();
      expect(user).toBeTruthy();
      expect(user!.emailVerifiedAt).toBeFalsy();
      expect(user!.role).toBe("customer"); // nadie se registra como administrador
      expect(user!.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(user!.passwordHash).not.toContain(PASSWORD);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail.mock.calls[0][0].to.email).toBe("luis@correo.com");
      expect(sendEmail.mock.calls[0][0].text).toMatch(/\/cuenta\/verificar\?token=[\w-]{43}/);
    });

    it("no permite elegir el rol desde el formulario", async () => {
      await registro(args(post("/cuenta/registro", { ...datos, role: "superadmin" })));
      expect((await UserModel.findOne({ email: "luis@correo.com" }).lean())!.role).toBe("customer");
    });

    it("rechaza contraseñas débiles, distintas, correos inválidos y duplicados", async () => {
      expect((await registro(args(post("/cuenta/registro", { ...datos, password: "12345678", confirmPassword: "12345678" })))).status).toBe(400);
      expect((await registro(args(post("/cuenta/registro", { ...datos, confirmPassword: "otra-distinta-1" })))).status).toBe(400);
      expect((await registro(args(post("/cuenta/registro", { ...datos, email: "no-es-correo" })))).status).toBe(400);
      expect(await UserModel.countDocuments()).toBe(0);

      await registro(args(post("/cuenta/registro", datos)));
      expect(await UserModel.countDocuments()).toBe(1);
    });

    it("registrarse con un correo que ya tiene cuenta se ve IGUAL que con uno nuevo (no revela qué correos existen)", async () => {
      const nuevo = await registro(args(post("/cuenta/registro", datos)));
      const repetido = await registro(args(post("/cuenta/registro", { ...datos, name: "Otra persona" })));

      expect(repetido.status).toBe(nuevo.status);
      const [a, b] = [await nuevo.json(), await repetido.json()];
      expect(b).toEqual(a);
      expect(JSON.stringify(b)).not.toMatch(/existe|registrad/i);
      // La respuesta no repite el correo completo: lo muestra enmascarado.
      expect(b.maskedEmail).toBe("l***s@correo.com");

      expect(await UserModel.countDocuments()).toBe(1);
      // La cuenta original no se toca: ni su nombre ni su contraseña.
      expect((await UserModel.findOne({ email: "luis@correo.com" }).lean())!.name).toBe("Luis");
    });

    it("a una cuenta ya confirmada le llega un aviso de que ya tiene cuenta (y ningún enlace para tomarla)", async () => {
      await UserModel.create({ email: "luis@correo.com", passwordHash: PASSWORD_HASH, name: "Luis", emailVerifiedAt: new Date() });
      await registro(args(post("/cuenta/registro", datos)));

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const correo = sendEmail.mock.calls[0][0];
      expect(correo.to.email).toBe("luis@correo.com");
      expect(correo.subject).toMatch(/ya tienes una cuenta/i);
      expect(correo.text).not.toMatch(/token=/);
    });

    it("a una cuenta sin confirmar le llega un enlace de confirmación nuevo", async () => {
      await UserModel.create({ email: "luis@correo.com", passwordHash: PASSWORD_HASH, name: "Luis" });
      await registro(args(post("/cuenta/registro", datos)));

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail.mock.calls[0][0].text).toMatch(/\/cuenta\/verificar\?token=[\w-]{43}/);
    });

    it("un correo no puede recibir mensajes sin fin: pasado el tope deja de enviar, con la misma respuesta", async () => {
      const respuestas: string[] = [];
      for (let i = 0; i < 5; i++) {
        respuestas.push(await (await registro(args(post("/cuenta/registro", datos)))).text());
      }
      expect(new Set(respuestas).size).toBe(1);
      expect(sendEmail.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it("recorrido completo: registrarse, no poder entrar, confirmar con el enlace del correo y entrar", async () => {
      await registro(args(post("/cuenta/registro", datos)));

      const antes = await login(args(post("/cuenta/entrar", { email: "luis@correo.com", password: PASSWORD })));
      expect(antes.status).toBe(403);

      const token = /token=([\w-]{43})/.exec(sendEmail.mock.calls[0][0].text)![1];
      const confirmacion = await verificar(args(get(`/cuenta/verificar?token=${token}`)));
      expect((await confirmacion.json()).status).toBe("verified");

      const despues = await login(args(post("/cuenta/entrar", { email: "luis@correo.com", password: PASSWORD })));
      expect(despues.status).toBe(302);

      // El enlace ya no sirve una segunda vez.
      const repetido = await verificar(args(get(`/cuenta/verificar?token=${token}`)));
      expect((await repetido.json()).status).toBe("invalid");
    });

    it("un enlace falso no confirma nada", async () => {
      await registro(args(post("/cuenta/registro", datos)));
      const response = await verificar(args(get(`/cuenta/verificar?token=${"z".repeat(43)}`)));
      expect((await response.json()).status).toBe("invalid");
      expect((await UserModel.findOne({ email: "luis@correo.com" }).lean())!.emailVerifiedAt).toBeFalsy();
    });
  });
});
