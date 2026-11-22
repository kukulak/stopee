import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "~/models/user.server";

/**
 * Los hashes de abajo se generaron con bcryptjs 2.4.3 (la versión con la que se crearon las
 * cuentas reales). Si una actualización de bcryptjs dejara de reconocerlos, NADIE podría
 * entrar: por eso son parte de las pruebas, y cualquier cambio de versión debe pasarlas.
 */
const HASHES_EXISTENTES = {
  costo12: { hash: "$2a$12$767uVjA5wWsU31UJzLctX.bjMWdgYiAmxHlq8Xhu0GZNmUuzAA.z2", password: "Perrito-Feliz-2031" },
  costo10: { hash: "$2a$10$W4Ns5pFSXF92lsit4h79B.Cn9tvvF6UeTBVYacjnuqo.LzrJoYxoK", password: "Perrito-Feliz-2031" },
  conAcentos: { hash: "$2a$12$vgl6pfxtB4m3VDjpawkx6OBOI9T3naFjZhFcT.yAAO2BLnDhp9Gqu", password: "Contraseña-ñandú-99" },
};

describe("contraseñas guardadas (bcrypt)", () => {
  it.each(Object.entries(HASHES_EXISTENTES))("reconoce un hash ya guardado: %s", async (_nombre, { hash, password }) => {
    expect(await verifyPassword(password, hash)).toBe(true);
  });

  it("rechaza la contraseña equivocada contra un hash ya guardado", async () => {
    expect(await verifyPassword("perrito-feliz-2031", HASHES_EXISTENTES.costo12.hash)).toBe(false); // otra mayúscula
    expect(await verifyPassword("Perrito-Feliz-2031 ", HASHES_EXISTENTES.costo12.hash)).toBe(false); // espacio al final
    expect(await verifyPassword("", HASHES_EXISTENTES.costo12.hash)).toBe(false);
  });

  it("un hash nuevo se verifica, no guarda la contraseña en claro y no se repite", async () => {
    const password = "Gato-Y-Perro-2044";
    const a = await hashPassword(password);
    const b = await hashPassword(password);
    expect(a).toMatch(/^\$2[aby]\$12\$/); // formato bcrypt con costo 12
    expect(a).not.toContain(password);
    expect(a).not.toBe(b); // cada hash lleva su propia sal
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword(password + "x", a)).toBe(false);
  });

  it("sin hash (la cuenta no existe) siempre es falso, sin lanzar error", async () => {
    expect(await verifyPassword("lo-que-sea", undefined)).toBe(false);
    expect(await verifyPassword("lo-que-sea", null)).toBe(false);
    expect(await verifyPassword("lo-que-sea", "")).toBe(false);
  });

  it("una cuenta inexistente tarda parecido a una existente (no revela qué correos hay)", async () => {
    const hash = HASHES_EXISTENTES.costo12.hash;
    const time = async (fn: () => Promise<unknown>) => {
      const start = performance.now();
      await fn();
      return performance.now() - start;
    };
    await verifyPassword("x", null); // calienta el hash de relleno
    const existente = await time(() => verifyPassword("mala-contraseña", hash));
    const inexistente = await time(() => verifyPassword("mala-contraseña", null));
    // Ambas hacen un bcrypt completo: la inexistente no puede ser ni de lejos más rápida.
    expect(inexistente).toBeGreaterThan(existente * 0.4);
  });
});
