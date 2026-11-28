import { describe, expect, it } from "vitest";
import { ACCOUNT_SECTION_IDS } from "~/components/account/AccountHub";

describe("secciones de Mi cuenta", () => {
  it("cada sección tiene una ancla única y segura para la dirección (/cuenta#pedidos)", () => {
    expect(new Set(ACCOUNT_SECTION_IDS).size).toBe(ACCOUNT_SECTION_IDS.length);
    for (const id of ACCOUNT_SECTION_IDS) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("«menu» no se usa como sección: es el destino de «Volver al menú»", () => {
    expect(ACCOUNT_SECTION_IDS as readonly string[]).not.toContain("menu");
  });
});
