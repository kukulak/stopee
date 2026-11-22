import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  formatSecretForHumans,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
  otpauthUri,
  timeStep,
  totpCode,
  verifyTotp,
} from "~/lib/totp.server";

// Secreto de los vectores de prueba del RFC 6238 (SHA-1): la cadena ASCII "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP (RFC 6238)", () => {
  it("el secreto de los vectores oficiales se codifica como esperan las apps", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  // El RFC publica 8 dígitos; los 6 que usan las apps son sus últimos 6.
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("el código del instante %i es %s", (seconds, expected) => {
    expect(totpCode(RFC_SECRET, timeStep(seconds * 1000))).toBe(expected);
  });

  it("base32 va y vuelve sin perder bytes, con o sin espacios y minúsculas", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7, 8, 9]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Decode("gezd gnbv-GY3T QOJQ====")).toEqual(Buffer.from("1234567890"));
    expect(() => base32Decode("ESTO NO ES 1 BASE32!")).toThrow();
  });

  it("un secreto nuevo tiene 160 bits y nunca se repite", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("verificar un código", () => {
  const now = 1_700_000_000_000;
  const step = timeStep(now);
  const at = (offset: number) => totpCode(RFC_SECRET, step + offset);

  it("acepta el código actual, el anterior y el siguiente (relojes desfasados)", () => {
    expect(verifyTotp(RFC_SECRET, at(0), { now })).toBe(step);
    expect(verifyTotp(RFC_SECRET, at(-1), { now })).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, at(1), { now })).toBe(step + 1);
  });

  it("rechaza códigos más viejos o más lejanos", () => {
    expect(verifyTotp(RFC_SECRET, at(-2), { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, at(2), { now })).toBeNull();
  });

  it("acepta el código como lo teclea la gente: con espacio o guion", () => {
    const code = at(0);
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { now })).toBe(step);
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)}-${code.slice(3)}`, { now })).toBe(step);
  });

  it("rechaza lo que no es un código de 6 dígitos", () => {
    for (const mal of ["", "12345", "1234567", "abcdef", "12 34 5a", "'; DROP TABLE users;--", "000000 "]) {
      expect(verifyTotp(RFC_SECRET, mal, { now }), mal).toBeNull();
    }
  });

  it("un código ya usado no se acepta otra vez, ni uno de un paso anterior al último usado", () => {
    expect(verifyTotp(RFC_SECRET, at(0), { now, afterStep: step - 1 })).toBe(step);
    expect(verifyTotp(RFC_SECRET, at(0), { now, afterStep: step })).toBeNull(); // el mismo
    expect(verifyTotp(RFC_SECRET, at(-1), { now, afterStep: step })).toBeNull(); // uno viejo
    expect(verifyTotp(RFC_SECRET, at(1), { now, afterStep: step })).toBe(step + 1); // el siguiente sí
  });

  it("un código de otro secreto no sirve", () => {
    const otro = generateTotpSecret();
    expect(verifyTotp(otro, at(0), { now })).toBeNull();
  });
});

describe("dirección para el QR", () => {
  it("lleva el secreto, la marca y el correo escapado", () => {
    const uri = otpauthUri("ABCDEFGH", "ana+admin@correo.com");
    expect(uri.startsWith("otpauth://totp/STOPee:ana%2Badmin%40correo.com?")).toBe(true);
    const params = new URL(uri).searchParams;
    expect(params.get("secret")).toBe("ABCDEFGH");
    expect(params.get("issuer")).toBe("STOPee");
    expect(params.get("digits")).toBe("6");
    expect(params.get("period")).toBe("30");
  });

  it("la clave para escribir a mano va en grupos de 4", () => {
    expect(formatSecretForHumans("ABCDEFGHIJKL")).toBe("ABCD EFGH IJKL");
  });
});

describe("secreto cifrado en la base", () => {
  it("se cifra, no contiene el secreto en claro y se recupera igual", () => {
    const secret = generateTotpSecret();
    const stored = encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptSecret(stored)).toBe(secret);
  });

  it("cada cifrado es distinto aunque el secreto sea el mismo", () => {
    expect(encryptSecret("ABC")).not.toBe(encryptSecret("ABC"));
  });

  it("un valor alterado, de otro formato o vacío se trata como 'sin secreto' (no lanza)", () => {
    const stored = encryptSecret("ABCDEFGH");
    const alterado = stored.slice(0, -3) + (stored.endsWith("AAA") ? "BBB" : "AAA");
    expect(decryptSecret(alterado)).toBeNull();
    expect(decryptSecret("v2.a.b.c")).toBeNull();
    expect(decryptSecret("basura")).toBeNull();
    expect(decryptSecret("")).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });

  it("si cambia SESSION_SECRET, lo guardado deja de poder leerse (de ahí el reset-2fa)", () => {
    const stored = encryptSecret("ABCDEFGH");
    const original = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "otro-secreto-completamente-distinto-9876543210";
    try {
      expect(decryptSecret(stored)).toBeNull();
    } finally {
      process.env.SESSION_SECRET = original;
    }
    expect(decryptSecret(stored)).toBe("ABCDEFGH");
  });
});

describe("códigos de recuperación", () => {
  it("son 10, con formato XXXXX-XXXXX, sin caracteres confusos y todos distintos", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
      expect(looksLikeRecoveryCode(code)).toBe(true);
    }
  });

  it("se reconocen escritos en minúsculas, con espacio o sin guion; la huella es la misma", () => {
    const code = "ABCDE-FGHJK";
    for (const variante of ["abcde-fghjk", "ABCDE FGHJK", "ABCDEFGHJK", " abcde-fghjk "]) {
      expect(normalizeRecoveryCode(variante)).toBe("ABCDEFGHJK");
      expect(hashRecoveryCode(variante)).toBe(hashRecoveryCode(code));
    }
  });

  it("la huella no deja ver el código y un código de 6 dígitos no se confunde con uno de recuperación", () => {
    expect(hashRecoveryCode("ABCDE-FGHJK")).toMatch(/^[0-9a-f]{64}$/);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
    expect(looksLikeRecoveryCode("ABCDE-FGHJ")).toBe(false);
    expect(looksLikeRecoveryCode("ABCDE-FGHJ0")).toBe(false); // el 0 no está en el alfabeto
  });
});
