import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse, outcomeOf } from "../helpers/http";

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/mail.server", () => ({ sendEmail, isMailConfigured: () => true }));

type Args = { request: Request; params: object; context: object };
type Handler = (args: Args) => Promise<Response>;

const PASSWORD = "clave-actual-segura";

/**
 * Cambiar el correo de una cuenta: lo hace el dueño con su contraseña y el correo nuevo confirmado; el correo anterior
 * recibe un «no fui yo» que devuelve la cuenta; y el equipo solo lo cambia con constancia de cómo comprobó a la persona.
 */
describe.skipIf(!hasTestDb)("cambio de correo", () => {
  let cuenta: Handler;
  let confirmar: { loader: Handler; action: Handler };
  let revertir: { loader: Handler; action: Handler };
  let adminCliente: Handler;
  let session: typeof import("~/lib/session.server");
  let UserModel: typeof import("~/models/user.server").UserModel;
  let verifyPassword: typeof import("~/models/user.server").verifyPassword;
  let hashPassword: typeof import("~/models/user.server").hashPassword;
  let AuthTokenModel: typeof import("~/models/authToken.server").AuthTokenModel;
  let AllyRequestModel: typeof import("~/models/allyRequest.server").AllyRequestModel;
  let userId: string;
  let cookie: string;
  let ip = 0;

  async function cookieFor(id: string, secondFactor = false, issuedAt = Date.now() - 5000) {
    const s = await session.sessionStorage.getSession();
    s.set("userId", id);
    s.set("iat", issuedAt);
    if (secondFactor) s.set("mfa", true);
    return (await session.sessionStorage.commitSession(s)).split(";")[0];
  }

  const request = (path: string, fields: Record<string, string> | null, withCookie = "") => {
    ip += 1;
    const headers: Record<string, string> = { "x-forwarded-for": `10.9.0.${ip}` };
    if (withCookie) headers.cookie = withCookie;
    return new Request(`http://localhost${path}`, fields ? { method: "POST", headers, body: new URLSearchParams(fields) } : { headers });
  };
  const call = (handler: Handler, path: string, fields: Record<string, string> | null, withCookie = "") =>
    handler({ request: request(path, fields, withCookie), params: {}, context: {} });

  const pedirCambio = (newEmail: string, currentPassword = PASSWORD, withCookie = cookie) =>
    call(cuenta, "/cuenta", { intent: "change-email", newEmail, currentPassword }, withCookie);

  /** El token del último enlace (`cambiar-correo` o `revertir-correo`) que se mandó a una dirección. */
  const linkTo = (address: string, kind: "cambiar-correo" | "revertir-correo") => {
    const mail = [...sendEmail.mock.calls].reverse().map((c) => c[0]).find((m) => m.to.email === address && new RegExp(`/cuenta/${kind}\\?token=`).test(m.text));
    const match = mail?.text.match(new RegExp(`/cuenta/${kind}\\?token=([\\w-]{43})`));
    return match?.[1] ?? null;
  };
  const sentTo = (address: string) => sendEmail.mock.calls.map((c) => c[0]).filter((m) => m.to.email === address);
  const load = async () => (await UserModel.findById(userId).lean())!;

  beforeAll(async () => {
    assertDisposableDb();
    cuenta = asResponse(((await import("~/routes/cuenta")) as never as { action: Handler }).action);
    const conf = (await import("~/routes/cuenta_.cambiar-correo")) as never as { loader: Handler; action: Handler };
    const rev = (await import("~/routes/cuenta_.revertir-correo")) as never as { loader: Handler; action: Handler };
    confirmar = { loader: asResponse(conf.loader), action: asResponse(conf.action) };
    revertir = { loader: asResponse(rev.loader), action: asResponse(rev.action) };
    adminCliente = asResponse(((await import("~/routes/admin.customers_.$id")) as never as { action: Handler }).action);
    session = await import("~/lib/session.server");
    ({ UserModel, verifyPassword, hashPassword } = await import("~/models/user.server"));
    ({ AuthTokenModel } = await import("~/models/authToken.server"));
    ({ AllyRequestModel } = await import("~/models/allyRequest.server"));
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
      email: "ana@viejo.com",
      name: "Ana Pérez",
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
      marketingOptInAt: new Date(),
    });
    userId = String(user._id);
    cookie = await cookieFor(userId);
  });

  describe("pedir el cambio", () => {
    it("con su contraseña manda el enlace al correo NUEVO y no cambia nada todavía", async () => {
      const response = await pedirCambio("Ana@Nuevo.com ");
      expect(response.status).toBe(200);
      expect(((await response.json()) as { maskedEmail: string }).maskedEmail).toBe("a***@nuevo.com");
      expect(linkTo("ana@nuevo.com", "cambiar-correo")).toBeTruthy();
      expect(sentTo("ana@viejo.com")).toHaveLength(0);
      expect((await load()).email).toBe("ana@viejo.com");
    });

    it("una contraseña equivocada no manda nada", async () => {
      const response = await pedirCambio("ana@nuevo.com", "no-es-esta");
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/contraseña actual/i);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(await AuthTokenModel.countDocuments({ purpose: "email-change" })).toBe(0);
    });

    it("rechaza un correo mal escrito o el mismo que ya tiene", async () => {
      expect((await pedirCambio("no-es-correo")).status).toBe(400);
      const same = await pedirCambio("ANA@viejo.com");
      expect(same.status).toBe(400);
      expect(((await same.json()) as { error: string }).error).toMatch(/ya es el correo/i);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("sin sesión no se puede", async () => {
      const outcome = await outcomeOf(() => pedirCambio("ana@nuevo.com", PASSWORD, ""));
      expect((outcome as Response).status).toBe(302);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("la respuesta es IGUAL si el correo nuevo ya tiene cuenta (no revela qué correos existen) y a ese correo solo le llega un aviso", async () => {
      await UserModel.create({ email: "otra@persona.com", passwordHash: "x", emailVerifiedAt: new Date() });
      const libre = await pedirCambio("libre@correo.com");
      const ocupado = await pedirCambio("otra@persona.com");
      expect(ocupado.status).toBe(libre.status);
      expect(Object.keys(await ocupado.json())).toEqual(Object.keys(await libre.clone().json()));

      expect(linkTo("otra@persona.com", "cambiar-correo")).toBeNull();
      expect(sentTo("otra@persona.com")).toHaveLength(1);
      expect(sentTo("otra@persona.com")[0].subject).toMatch(/ya tiene una cuenta/i);
      expect(await AuthTokenModel.countDocuments({ purpose: "email-change" })).toBe(1);
    });

    it("no se puede usar para llenar de mensajes la bandeja de un tercero", async () => {
      for (let i = 0; i < 5; i++) expect((await pedirCambio("victima@correo.com")).status).toBe(200);
      expect(sentTo("victima@correo.com")).toHaveLength(3);
    });

    it("limita los intentos de contraseña desde una sesión abierta", async () => {
      for (let i = 0; i < 5; i++) expect((await pedirCambio("ana@nuevo.com", `mal-${i}`)).status).toBe(400);
      expect((await pedirCambio("ana@nuevo.com")).status).toBe(429);
    });
  });

  describe("confirmar con el enlace del correo nuevo", () => {
    const pedirYTomarToken = async () => {
      await pedirCambio("ana@nuevo.com");
      return linkTo("ana@nuevo.com", "cambiar-correo")!;
    };

    it("abrir el enlace no cambia nada; el botón sí: cambia el correo, lo da por confirmado y avisa al anterior", async () => {
      const token = await pedirYTomarToken();
      const opened = await call(confirmar.loader, `/cuenta/cambiar-correo?token=${token}`, null);
      expect(((await opened.json()) as { valid: boolean }).valid).toBe(true);
      expect((await load()).email).toBe("ana@viejo.com");

      const done = await call(confirmar.action, "/cuenta/cambiar-correo", { token });
      expect(done.status).toBe(200);
      const user = await load();
      expect(user.email).toBe("ana@nuevo.com");
      expect(user.emailVerifiedAt).toBeTruthy();
      expect(user.marketingOptInAt).toBeTruthy(); // es la misma persona: su permiso sigue

      const aviso = sentTo("ana@viejo.com");
      expect(aviso).toHaveLength(1);
      expect(aviso[0].subject).toMatch(/cambió/i);
      expect(aviso[0].text).toMatch(/a\*\*\*@nuevo\.com/);
      expect(linkTo("ana@viejo.com", "revertir-correo")).toBeTruthy();
    });

    it("el enlace sirve una sola vez", async () => {
      const token = await pedirYTomarToken();
      expect((await call(confirmar.action, "/cuenta/cambiar-correo", { token })).status).toBe(200);
      expect((await call(confirmar.action, "/cuenta/cambiar-correo", { token })).status).toBe(400);
    });

    it("un token inventado, o de otra clase, no cambia nada", async () => {
      await pedirYTomarToken();
      expect((await call(confirmar.action, "/cuenta/cambiar-correo", { token: "x".repeat(43) })).status).toBe(400);
      expect((await load()).email).toBe("ana@viejo.com");
    });

    it("si mientras tanto alguien se registró con ese correo, no lo pisa", async () => {
      const token = await pedirYTomarToken();
      await UserModel.create({ email: "ana@nuevo.com", passwordHash: "x", emailVerifiedAt: new Date() });
      const response = await call(confirmar.action, "/cuenta/cambiar-correo", { token });
      expect(response.status).toBe(400);
      expect((await load()).email).toBe("ana@viejo.com");
    });

    it("lo que va ligado al correo lo sigue: las solicitudes de Punto de Recarga", async () => {
      await AllyRequestModel.create({ name: "Ana", email: "ana@viejo.com", businessName: "Veterinaria", neighborhood: "Roma", message: "hola", status: "pending" } as never).catch(() => undefined);
      const before = await AllyRequestModel.countDocuments({ email: "ana@viejo.com" });
      const token = await pedirYTomarToken();
      await call(confirmar.action, "/cuenta/cambiar-correo", { token });
      expect(await AllyRequestModel.countDocuments({ email: "ana@nuevo.com" })).toBe(before);
      expect(await AllyRequestModel.countDocuments({ email: "ana@viejo.com" })).toBe(0);
    });
  });

  describe("«no fui yo» desde el correo anterior", () => {
    const cambiarA = async (address: string) => {
      const owner = await load();
      await pedirCambio(address, PASSWORD, await cookieFor(userId));
      expect(owner).toBeTruthy();
      await call(confirmar.action, "/cuenta/cambiar-correo", { token: linkTo(address, "cambiar-correo")! });
    };

    it("devuelve el correo, cierra las sesiones, deja inservible la contraseña y manda el enlace para elegir otra", async () => {
      await cambiarA("ladron@correo.com");
      const revertToken = linkTo("ana@viejo.com", "revertir-correo")!;

      const opened = await call(revertir.loader, `/cuenta/revertir-correo?token=${revertToken}`, null);
      expect(((await opened.json()) as { valid: boolean }).valid).toBe(true);
      expect((await load()).email).toBe("ladron@correo.com"); // abrir no cambia nada

      const done = await call(revertir.action, "/cuenta/revertir-correo", { token: revertToken });
      expect(done.status).toBe(200);
      const user = await load();
      expect(user.email).toBe("ana@viejo.com");
      expect(await verifyPassword(PASSWORD, user.passwordHash)).toBe(false); // quien tomó la cuenta conoce la contraseña
      expect(user.passwordChangedAt).toBeInstanceOf(Date);
      expect(await session.getUser(new Request("http://localhost/cuenta", { headers: { cookie } }))).toBeNull();
      expect(linkTo("ana@viejo.com", "cambiar-correo")).toBeNull();
      expect(sentTo("ana@viejo.com").some((m) => /restablec/i.test(m.subject))).toBe(true);
    });

    it("sigue valiendo aunque quien tomó la cuenta lo cambie dos veces", async () => {
      await cambiarA("ladron@correo.com");
      const primerAviso = linkTo("ana@viejo.com", "revertir-correo")!;
      // Segundo cambio, ya con el correo del ladrón.
      const dueno = await UserModel.findOneAndUpdate({ email: "ladron@correo.com" }, { $set: { passwordHash: await hashPassword(PASSWORD) } });
      expect(dueno).toBeTruthy();
      await pedirCambio("otro@ladron.com", PASSWORD, await cookieFor(userId));
      await call(confirmar.action, "/cuenta/cambiar-correo", { token: linkTo("otro@ladron.com", "cambiar-correo")! });
      expect((await load()).email).toBe("otro@ladron.com");

      expect((await call(revertir.action, "/cuenta/revertir-correo", { token: primerAviso })).status).toBe(200);
      expect((await load()).email).toBe("ana@viejo.com");
    });

    it("el enlace sirve una vez, y no revierte si ese correo ya lo usa otra cuenta", async () => {
      await cambiarA("ladron@correo.com");
      const token = linkTo("ana@viejo.com", "revertir-correo")!;
      await UserModel.create({ email: "ana@viejo.com", passwordHash: "x", emailVerifiedAt: new Date() });
      const blocked = await call(revertir.action, "/cuenta/revertir-correo", { token });
      expect(blocked.status).toBe(400);
      expect((await load()).email).toBe("ladron@correo.com");
      expect((await call(revertir.action, "/cuenta/revertir-correo", { token })).status).toBe(400);
    });
  });

  describe("desde el panel, para quien perdió el acceso a su correo", () => {
    let superId: string;
    let superCookie: string;
    const cambiarDesdePanel = (fields: Record<string, string>, target = userId, withCookie = superCookie) =>
      adminCliente({ request: request(`/admin/customers/${target}`, { intent: "change-email", ...fields }, withCookie), params: { id: target }, context: {} });

    beforeEach(async () => {
      const superadmin = await UserModel.create({
        email: "jefa@stopee.test",
        passwordHash: "x",
        role: "superadmin",
        emailVerifiedAt: new Date(),
        twoFactor: { enabledAt: new Date(), secretEnc: "no-se-usa-aqui" },
      });
      superId = String(superadmin._id);
      superCookie = await cookieFor(superId, true);
    });

    it("exige anotar cómo se comprobó a la persona", async () => {
      const response = await outcomeOf(() => cambiarDesdePanel({ newEmail: "ana@nuevo.com", proof: "ok" }));
      expect((response as Response).status).toBe(400);
      expect((await load()).email).toBe("ana@viejo.com");
    });

    it("con constancia, cambia el correo: avisa al anterior y deja la cuenta sin confirmar hasta que la persona abra el enlace del nuevo", async () => {
      const response = await outcomeOf(() => cambiarDesdePanel({ newEmail: "ana@nuevo.com", proof: "Pedido 10A90977 y dirección de entrega coinciden" }));
      expect((response as Response).status).toBe(200);
      const user = await load();
      expect(user.email).toBe("ana@nuevo.com");
      expect(user.emailVerifiedAt).toBeFalsy();
      expect(linkTo("ana@viejo.com", "revertir-correo")).toBeTruthy();
      expect(sentTo("ana@nuevo.com").some((m) => /confirma tu correo/i.test(m.subject))).toBe(true);
    });

    it("solo un super administrador: un administrador común, no", async () => {
      const staff = await UserModel.create({
        email: "equipo@stopee.test",
        passwordHash: "x",
        role: "admin",
        emailVerifiedAt: new Date(),
        twoFactor: { enabledAt: new Date(), secretEnc: "no-se-usa-aqui" },
      });
      const staffCookie = await cookieFor(String(staff._id), true);
      const outcome = await outcomeOf(() => cambiarDesdePanel({ newEmail: "ana@nuevo.com", proof: "Pedido y dirección coinciden" }, userId, staffCookie));
      expect((outcome as Response).status).not.toBe(200);
      expect((await load()).email).toBe("ana@viejo.com");
    });

    it("nunca a una cuenta del equipo", async () => {
      const response = await outcomeOf(() => cambiarDesdePanel({ newEmail: "otro@stopee.test", proof: "Lo pidió por mensaje" }, superId));
      expect((response as Response).status).toBe(403);
      expect((await UserModel.findById(superId).lean())!.email).toBe("jefa@stopee.test");
    });
  });
});
