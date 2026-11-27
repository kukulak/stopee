import { describe, expect, it } from "vitest";
import { ACCOUNT_SECTIONS, parseAccountSection, sectionHref } from "~/components/account/AccountHub";

describe("secciones de Mi cuenta", () => {
  it("cada sección conocida se lee tal cual", () => {
    for (const section of ACCOUNT_SECTIONS) {
      expect(parseAccountSection(section, { hasPoint: true })).toBe(section);
    }
  });

  it("sin sección, o con una inventada, se queda en el tablero", () => {
    expect(parseAccountSection(null, { hasPoint: false })).toBeNull();
    expect(parseAccountSection("", { hasPoint: false })).toBeNull();
    expect(parseAccountSection("admin", { hasPoint: false })).toBeNull();
    expect(parseAccountSection("../../etc", { hasPoint: false })).toBeNull();
  });

  it("«punto» solo existe para quien es o pidió ser Punto de recarga", () => {
    expect(parseAccountSection("punto", { hasPoint: false })).toBeNull();
    expect(parseAccountSection("punto", { hasPoint: true })).toBe("punto");
  });

  it("el enlace de cada sección lleva a Mi cuenta", () => {
    expect(sectionHref("pedidos")).toBe("/cuenta?seccion=pedidos");
  });
});
