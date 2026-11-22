import { describe, expect, it } from "vitest";
import { safeRedirectTarget } from "~/lib/safeRedirect";
import { isValidGooglePixelId, isValidMetaPixelId, linkTargetOr, normalizeLinkTarget } from "~/lib/inputValidation";
import { csvCell } from "~/lib/csv";
import { passwordProblem } from "~/lib/password";
import { isStaff, isSuperAdmin } from "~/lib/roles";
import { slugify, slugifyLive } from "~/lib/slug";

describe("redirección tras iniciar sesión", () => {
  it("acepta rutas internas", () => {
    expect(safeRedirectTarget("/tienda")).toBe("/tienda");
    expect(safeRedirectTarget("/cuenta?tab=pedidos#x")).toBe("/cuenta?tab=pedidos#x");
  });

  it.each([
    "https://sitio-falso.com",
    "//sitio-falso.com",
    "/\\sitio-falso.com",
    "javascript:alert(1)",
    "tienda",
    "/ruta\nSet-Cookie: x=1",
    "/ruta\tcon-tabulador",
    "",
  ])("rechaza %j y usa el destino de respaldo", (raw) => {
    expect(safeRedirectTarget(raw)).toBe("/cuenta");
  });

  it("sin valor usa el respaldo indicado", () => {
    expect(safeRedirectTarget(null, "/inicio")).toBe("/inicio");
    expect(safeRedirectTarget(undefined)).toBe("/cuenta");
  });
});

describe("destinos de botones y banners", () => {
  it("acepta rutas del sitio, anclas y https", () => {
    expect(normalizeLinkTarget("/blog/mi-articulo#parte")).toBe("/blog/mi-articulo#parte");
    expect(normalizeLinkTarget("#contacto")).toBe("#contacto");
    expect(normalizeLinkTarget(" https://stopee.com.mx/tienda ")).toBe("https://stopee.com.mx/tienda");
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>1</script>", "http://inseguro.com", "//otro.com", "/\\otro.com", "/con espacio", "   ", null, undefined])(
    "rechaza %j",
    (raw) => {
      expect(normalizeLinkTarget(raw)).toBeNull();
    },
  );

  it("usa el destino de respaldo cuando el guardado no es válido", () => {
    expect(linkTargetOr("javascript:alert(1)")).toBe("/tienda");
    expect(linkTargetOr("/nosotros")).toBe("/nosotros");
  });
});

describe("identificadores de rastreo", () => {
  it("valida Google y Meta", () => {
    expect(isValidGooglePixelId("G-ABCD1234")).toBe(true);
    expect(isValidGooglePixelId("GTM-ABC1234")).toBe(true);
    expect(isValidGooglePixelId("G-1');alert(1);//")).toBe(false);
    expect(isValidMetaPixelId("123456789012345")).toBe(true);
    expect(isValidMetaPixelId("12345abc")).toBe(false);
    expect(isValidMetaPixelId("1234567")).toBe(false);
  });
});

describe("exportación a CSV", () => {
  it("encierra la celda y duplica las comillas", () => {
    expect(csvCell('Dijo "hola"')).toBe('"Dijo ""hola"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
  });

  it.each(["=HYPERLINK(\"http://x\")", "+52 55 1234", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"])(
    "neutraliza la fórmula %j para que no se ejecute en Excel",
    (value) => {
      expect(csvCell(value).startsWith(`"'`)).toBe(true);
    },
  );
});

describe("contraseñas nuevas", () => {
  it("acepta una contraseña razonable", () => {
    expect(passwordProblem("Perrito-Feliz-2031")).toBeNull();
  });

  it("rechaza las cortas", () => {
    expect(passwordProblem("abc123")).toMatch(/al menos 8/);
  });

  it("rechaza las demasiado largas para bcrypt (72 bytes), contando acentos como 2", () => {
    expect(passwordProblem("a".repeat(73))).toMatch(/demasiado larga/);
    expect(passwordProblem("ñ".repeat(37))).toMatch(/demasiado larga/); // 74 bytes
    expect(passwordProblem("aB3-".repeat(18))).toBeNull(); // exactamente 72 bytes: todavía cabe
  });

  it("rechaza las más usadas, aunque cambien mayúsculas o acentos", () => {
    expect(passwordProblem("Contraseña123")).toMatch(/más usadas/);
    expect(passwordProblem("PASSWORD123")).toMatch(/más usadas/);
    expect(passwordProblem("aaaaaaaaaa")).toMatch(/más usadas/);
  });

  it("rechaza una contraseña igual a la parte local del correo", () => {
    expect(passwordProblem("christian", "Christian@correo.com")).toMatch(/igual a tu correo/);
  });
});

describe("roles", () => {
  it("solo admin y superadmin entran al panel", () => {
    expect(isStaff("admin")).toBe(true);
    expect(isStaff("superadmin")).toBe(true);
    expect(isStaff("customer")).toBe(false);
    expect(isStaff(undefined)).toBe(false);
    expect(isStaff("ADMIN")).toBe(false);
  });

  it("solo superadmin es superadmin", () => {
    expect(isSuperAdmin("superadmin")).toBe(true);
    expect(isSuperAdmin("admin")).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
  });
});

describe("direcciones de artículos (slug)", () => {
  it("quita acentos, símbolos y espacios sobrantes", () => {
    expect(slugify("¡Cómo cuidar a tu perro en la CDMX!")).toBe("como-cuidar-a-tu-perro-en-la-cdmx");
    expect(slugify("  --Hola   mundo--  ")).toBe("hola-mundo");
  });

  it("corta en un guion para no dejar palabras a medias", () => {
    const slug = slugify("uno dos tres cuatro cinco seis siete", 20);
    expect(slug.length).toBeLessThanOrEqual(20);
    expect(slug).toBe("uno-dos-tres-cuatro");
  });

  it("al escribir conserva el guion final", () => {
    expect(slugifyLive("mi ")).toBe("mi-");
    expect(slugify("mi ")).toBe("mi");
  });
});
