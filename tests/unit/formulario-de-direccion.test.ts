import { describe, expect, it } from "vitest";
import { validateAddressForm } from "~/lib/addressBook";

const FULL = { label: "Casa de mamá", name: "Rosa Pérez", phone: "5522222222", line1: "Calle Horacio 45", line2: "Polanco", city: "Miguel Hidalgo", state: "", postalCode: "11560" };

describe("formulario de dirección (Mis direcciones)", () => {
  it("acepta una dirección completa", () => {
    expect(validateAddressForm(FULL)).toEqual({ ok: true, value: FULL });
  });

  it("acepta el teléfono y el código postal escritos como cada quien quiera", () => {
    const result = validateAddressForm({ ...FULL, phone: "+52 (55) 2222-2222", postalCode: " 1560 " });
    expect(result).toMatchObject({ ok: true, value: { phone: "5522222222", postalCode: "01560" } });
  });

  it("dice campo por campo qué falta, en palabras de persona", () => {
    const result = validateAddressForm({ label: "", name: "Ro", phone: "123", line1: "", city: "", postalCode: "abc" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["city", "label", "line1", "name", "phone", "postalCode"]);
    expect(result.errors.label).toMatch(/nombre/i);
    expect(result.errors.phone).toMatch(/10 dígitos/);
  });

  it("la colonia y el estado son opcionales", () => {
    expect(validateAddressForm({ ...FULL, line2: "", state: "" }).ok).toBe(true);
  });

  it("limpia símbolos de etiquetas y espacios de más", () => {
    const result = validateAddressForm({ ...FULL, label: "  <b>Casa</b>   de   mamá ", line1: "  Calle   Horacio 45 " });
    expect(result).toMatchObject({ ok: true, value: { label: "bCasa/b de mamá", line1: "Calle Horacio 45" } });
  });
});
