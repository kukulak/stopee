import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse, outcomeOf } from "../helpers/http";

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/mail.server", () => ({ sendEmail, isMailConfigured: () => true }));

type Args = { request: Request; params: object; context: object };
type Action = (args: Args) => Promise<Response>;

/** Mi perfil (nombre y teléfono), Mis perritos y el cambio de contraseña desde Mi cuenta. */
describe.skipIf(!hasTestDb)("Mi perfil, Mis perritos y contraseña", () => {
  let cuenta: Action;
  let session: typeof import("~/lib/session.server");
  let UserModel: typeof import("~/models/user.server").UserModel;
  let verifyPassword: typeof import("~/models/user.server").verifyPassword;
  let hashPassword: typeof import("~/models/user.server").hashPassword;
  let userId: string;
  let cookie: string;

  async function cookieFor(id: string, issuedAt = Date.now()) {
    const s = await session.sessionStorage.getSession();
    s.set("userId", id);
    s.set("iat", issuedAt);
    return (await session.sessionStorage.commitSession(s)).split(";")[0];
  }

  const post = (fields: Record<string, string | string[]>, withCookie = cookie) => {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
    return cuenta({
      request: new Request("http://localhost/cuenta", { method: "POST", headers: { cookie: withCookie }, body }),
      params: {},
      context: {},
    });
  };
  const load = async () => (await UserModel.findById(userId).lean())!;

  beforeAll(async () => {
    assertDisposableDb();
    cuenta = asResponse(((await import("~/routes/cuenta")) as never as { action: Action }).action);
    session = await import("~/lib/session.server");
    ({ UserModel, verifyPassword, hashPassword } = await import("~/models/user.server"));
    await (await import("~/lib/db.server")).connectDB();
  });
  afterAll(async () => {
    await dropDb();
  });
  beforeEach(async () => {
    await wipeDb();
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ ok: true });
    const user = await UserModel.create({
      email: "ana@example.com",
      name: "Ana Pérez",
      phone: "5511111111",
      passwordHash: await hashPassword("clave-actual-segura"),
      emailVerifiedAt: new Date(),
      address: { line1: "Calle 1", postalCode: "03100", city: "CDMX", label: "Casa" },
      dogs: [{ name: "Luna" }],
    });
    userId = String(user._id);
    cookie = await cookieFor(userId, Date.now() - 5000);
  });

  describe("Mi perfil", () => {
    it("guarda el nombre y el teléfono sin tocar el correo, las direcciones ni los perritos", async () => {
      const response = await post({ intent: "update-profile", firstName: "  Ana María ", lastName: " Pérez   Gómez", phone: "55 9999 8888" });
      expect(response.status).toBe(200);
      const user = await load();
      expect(user).toMatchObject({ firstName: "Ana María", lastName: "Pérez Gómez", name: "Ana María Pérez Gómez", phone: "55 9999 8888", email: "ana@example.com" });
      expect(user.address).toMatchObject({ line1: "Calle 1", label: "Casa" });
      expect(user.dogs.map((d) => d.name)).toEqual(["Luna"]);
    });

    it("los apellidos son opcionales al editar: quien solo cambia su teléfono no tiene que llenarlos", async () => {
      expect((await post({ intent: "update-profile", firstName: "Ana", lastName: "", phone: "5500000001" })).status).toBe(200);
      expect(await load()).toMatchObject({ firstName: "Ana", lastName: "", name: "Ana", phone: "5500000001" });
    });

    it("sin nombre no guarda nada y lo dice en palabras de persona", async () => {
      const response = await post({ intent: "update-profile", firstName: " ", lastName: "Pérez", phone: "5500000000" });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/nombre/i);
      expect((await load()).phone).toBe("5511111111");
    });
  });

  describe("Mis perritos", () => {
    it("guarda los perritos con su cumpleaños y no toca el teléfono ni las direcciones", async () => {
      const response = await post({ intent: "update-dogs", mascota: ["Luna", " Max ", ""], dogBirthday: ["", "2022-03-12", ""] });
      expect(response.status).toBe(200);
      const user = await load();
      expect(user.dogs.map((d) => d.name)).toEqual(["Luna", "Max"]);
      expect(user.dogs[1].birthday?.toISOString().slice(0, 10)).toBe("2022-03-12");
      expect(user.phone).toBe("5511111111");
      expect(user.address).toMatchObject({ line1: "Calle 1" });
    });

    it("se pueden quitar todos y no pasa de 8", async () => {
      await post({ intent: "update-dogs", mascota: Array.from({ length: 12 }, (_, i) => `Perro ${i}`), dogBirthday: Array(12).fill("") });
      expect((await load()).dogs).toHaveLength(8);
      await post({ intent: "update-dogs" });
      expect((await load()).dogs).toHaveLength(0);
    });
  });

  describe("cambiar la contraseña", () => {
    const change = (over: Record<string, string> = {}, withCookie = cookie) =>
      post({ intent: "change-password", currentPassword: "clave-actual-segura", newPassword: "otra-clave-muy-segura", confirmPassword: "otra-clave-muy-segura", ...over }, withCookie);
    const error = async (response: Response) => ((await response.json()) as { error: string }).error;

    it("con la actual correcta la cambia, avisa por correo y deja entrar con la nueva", async () => {
      const response = await change();
      expect(response.status).toBe(200);
      const user = await load();
      expect(await verifyPassword("otra-clave-muy-segura", user.passwordHash)).toBe(true);
      expect(await verifyPassword("clave-actual-segura", user.passwordHash)).toBe(false);
      expect(user.passwordChangedAt).toBeInstanceOf(Date);
      expect(sendEmail.mock.calls.some((c) => c[0].to.email === "ana@example.com")).toBe(true);
    });

    it("quien la cambió sigue dentro (su sesión se renueva) y las demás sesiones dejan de valer", async () => {
      const response = await change();
      const renewed = response.headers.get("set-cookie")?.split(";")[0] ?? "";
      expect(renewed).toContain("__stopee_session=");
      const get = (c: string) => new Request("http://localhost/cuenta", { headers: { cookie: c } });
      expect(await session.getUser(get(renewed))).not.toBeNull();
      expect(await session.getUser(get(cookie))).toBeNull();
    });

    it("una contraseña actual equivocada no cambia nada", async () => {
      const response = await change({ currentPassword: "no-es-esta" });
      expect(response.status).toBe(400);
      expect(await error(response)).toMatch(/actual no es correcta/i);
      expect(await verifyPassword("clave-actual-segura", (await load()).passwordHash)).toBe(true);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("rechaza una nueva débil, que no coincida, o igual a la actual", async () => {
      expect(await error(await change({ newPassword: "corta", confirmPassword: "corta" }))).toMatch(/al menos 8/);
      expect(await error(await change({ newPassword: "password123", confirmPassword: "password123" }))).toMatch(/más usadas/);
      expect(await error(await change({ confirmPassword: "otra-distinta-clave" }))).toMatch(/no coinciden/i);
      expect(await error(await change({ newPassword: "clave-actual-segura", confirmPassword: "clave-actual-segura" }))).toMatch(/distinta/i);
      expect(await verifyPassword("clave-actual-segura", (await load()).passwordHash)).toBe(true);
    });

    it("limita los intentos: no se puede adivinar la contraseña actual desde una sesión abierta", async () => {
      for (let i = 0; i < 5; i++) expect((await change({ currentPassword: `intento-${i}-mal` })).status).toBe(400);
      const blocked = await change();
      expect(blocked.status).toBe(429);
      expect(await verifyPassword("clave-actual-segura", (await load()).passwordHash)).toBe(true);
    });

    it("sin sesión no se puede: manda a iniciar sesión y no cambia nada", async () => {
      const outcome = await outcomeOf(() => change({}, ""));
      expect(outcome).toBeInstanceOf(Response);
      expect((outcome as Response).status).toBe(302);
      expect(await verifyPassword("clave-actual-segura", (await load()).passwordHash)).toBe(true);
    });
  });
});
