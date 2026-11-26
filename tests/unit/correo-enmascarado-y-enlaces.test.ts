import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maskEmail } from "~/lib/maskEmail";

vi.mock("~/lib/mail.server", () => ({
  sendEmail: vi.fn(async () => ({ ok: false, skipped: true, reason: "not-configured" })),
  isMailConfigured: () => false,
}));
vi.mock("~/lib/authTokens.server", () => ({ issueToken: vi.fn(async () => "T".repeat(43)) }));

describe("correo enmascarado", () => {
  it("deja la primera y la última letra del nombre y el dominio completo", () => {
    expect(maskEmail("valderrama.christian@gmail.com")).toBe("v***n@gmail.com");
    expect(maskEmail("ana.lopez@gmail.com")).toBe("a***z@gmail.com");
  });

  it("con un nombre muy corto solo deja la primera letra", () => {
    expect(maskEmail("ana@correo.com")).toBe("a***@correo.com");
    expect(maskEmail("a@correo.com")).toBe("a***@correo.com");
  });

  it("no inventa nada con algo que no es un correo", () => {
    expect(maskEmail("")).toBe("");
    expect(maskEmail("sin-arroba")).toBe("");
  });
});

describe("enlace de acceso en la terminal", () => {
  let info: ReturnType<typeof vi.spyOn>;
  const original = { ...process.env };

  beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    info.mockRestore();
    process.env = { ...original };
  });

  async function requestReset() {
    const { sendPasswordResetEmail } = await import("~/lib/accountEmails.server");
    await sendPasswordResetEmail({ _id: "u1", email: "a@b.com" });
    return info.mock.calls.flat().join("\n");
  }

  it("en desarrollo, sin correo configurado, sí se imprime (para poder probar)", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.K_SERVICE;
    expect(await requestReset()).toContain("/cuenta/restablecer?token=");
  });

  it.each([
    ["producción", { NODE_ENV: "production" }],
    ["Cloud Run aunque la variable de entorno se olvide", { NODE_ENV: "development", K_SERVICE: "stopee" }],
    ["un entorno sin nombre (se falla hacia el lado seguro)", { NODE_ENV: "" }],
    ["pruebas", { NODE_ENV: "test" }],
  ])("nunca se imprime en %s", async (_nombre, env) => {
    Object.assign(process.env, env);
    expect(await requestReset()).not.toContain("token=");
  });
});
