import { describe, expect, it } from "vitest";
import {
  DEFAULT_DELIVERY_ZONE,
  isPostalCodeInRanges,
  isPostalCodeInZone,
  normalizePostalCode,
  parsePostalRanges,
} from "~/lib/deliveryZone";
import {
  addressFromMetadata,
  addressToMetadata,
  normalizePhone,
  validateDeliveryAddress,
} from "~/lib/deliveryAddress";

const ZONE = DEFAULT_DELIVERY_ZONE;

const home = {
  name: "Ana Pérez",
  phone: "55 1234 5678",
  line1: "Av. Insurgentes Sur 123",
  line2: "Col. Del Valle",
  city: "Benito Juárez",
  postalCode: "03100",
};

describe("zona de entrega: códigos postales", () => {
  it("la Ciudad de México va de 01000 a 16999, con los extremos incluidos", () => {
    expect(isPostalCodeInZone("01000", ZONE)).toBe(true);
    expect(isPostalCodeInZone("03100", ZONE)).toBe(true);
    expect(isPostalCodeInZone("16999", ZONE)).toBe(true);
  });

  it("deja fuera lo de afuera: Estado de México, Monterrey, Guadalajara, Querétaro", () => {
    expect(isPostalCodeInZone("00999", ZONE)).toBe(false);
    expect(isPostalCodeInZone("17000", ZONE)).toBe(false);
    expect(isPostalCodeInZone("52000", ZONE)).toBe(false); // Metepec, Edomex
    expect(isPostalCodeInZone("64000", ZONE)).toBe(false); // Monterrey
    expect(isPostalCodeInZone("44100", ZONE)).toBe(false); // Guadalajara
    expect(isPostalCodeInZone("76000", ZONE)).toBe(false); // Querétaro
  });

  it("acepta 4 dígitos (se escribe '3100' por '03100') y rechaza lo que no es un código postal", () => {
    expect(normalizePostalCode("3100")).toBe("03100");
    expect(normalizePostalCode(" 03100 ")).toBe("03100");
    expect(normalizePostalCode("310")).toBeNull();
    expect(normalizePostalCode("031000")).toBeNull();
    expect(normalizePostalCode("03 100")).toBeNull();
    expect(normalizePostalCode("abcde")).toBeNull();
    expect(normalizePostalCode(31000 as unknown)).toBeNull();
    expect(isPostalCodeInZone("3100", ZONE)).toBe(true);
    expect(isPostalCodeInZone("", ZONE)).toBe(false);
  });

  it("una zona se puede ampliar con más rangos y códigos sueltos, sin tocar el código", () => {
    const zone = { name: "CDMX y Toluca", postalRanges: "01000-16999, 50000-50299; 52100" };
    expect(isPostalCodeInZone("50100", zone)).toBe(true);
    expect(isPostalCodeInZone("52100", zone)).toBe(true);
    expect(isPostalCodeInZone("52101", zone)).toBe(false);
    expect(isPostalCodeInZone("50300", zone)).toBe(false);
  });

  it("explica en español qué está mal escrito en el rango", () => {
    expect(parsePostalRanges("").error).toMatch(/al menos un código/i);
    expect(parsePostalRanges("hola").error).toMatch(/No entendí "hola"/);
    expect(parsePostalRanges("16999-01000").error).toMatch(/mayor/);
    expect(parsePostalRanges("01000-16999").error).toBeNull();
  });

  it("una zona ilegible no deja entregar a nadie (nunca abre la tienda a todo el país)", () => {
    expect(isPostalCodeInZone("03100", { name: "Rota", postalRanges: "basura" })).toBe(false);
    expect(isPostalCodeInRanges("03100", [])).toBe(false);
  });
});

describe("zona de entrega: dirección", () => {
  it("acepta teléfonos con las variaciones comunes y siempre devuelve 10 dígitos", () => {
    expect(normalizePhone("55 1234 5678")).toBe("5512345678");
    expect(normalizePhone("(55) 1234-5678")).toBe("5512345678");
    expect(normalizePhone("+52 55 1234 5678")).toBe("5512345678");
    expect(normalizePhone("+52 1 55 1234 5678")).toBe("5512345678");
    expect(normalizePhone("044 55 1234 5678")).toBe("5512345678");
    expect(normalizePhone("1234")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("a domicilio: con todo bien devuelve la dirección limpia y con el estado de la zona", () => {
    const result = validateDeliveryAddress(home, { mode: "home", zone: ZONE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.address).toEqual({
      name: "Ana Pérez",
      phone: "5512345678",
      line1: "Av. Insurgentes Sur 123",
      line2: "Col. Del Valle",
      city: "Benito Juárez",
      state: "Ciudad de México",
      postalCode: "03100",
      country: "MX",
    });
  });

  it("fuera de la zona no es válida, y lo dice con 'outOfZone' para ofrecer la lista de espera", () => {
    const result = validateDeliveryAddress({ ...home, postalCode: "64000" }, { mode: "home", zone: ZONE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outOfZone).toBe(true);
    expect(result.errors.postalCode).toMatch(/solo entregamos en Ciudad de México/);
  });

  it("a domicilio exige calle y alcaldía; el punto de entrega solo nombre, teléfono y código postal", () => {
    const sinCalle = validateDeliveryAddress({ ...home, line1: "", city: "" }, { mode: "home", zone: ZONE });
    expect(sinCalle.ok).toBe(false);
    if (!sinCalle.ok) {
      expect(sinCalle.errors.line1).toBeTruthy();
      expect(sinCalle.errors.city).toBeTruthy();
      expect(sinCalle.outOfZone).toBe(false);
    }

    const punto = validateDeliveryAddress(
      { name: "Ana Pérez", phone: "5512345678", postalCode: "03100" },
      { mode: "pickup", zone: ZONE },
    );
    expect(punto.ok).toBe(true);
  });

  it("marca cada campo faltante por separado", () => {
    const result = validateDeliveryAddress({}, { mode: "home", zone: ZONE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["city", "line1", "name", "phone", "postalCode"]);
  });

  it("limpia etiquetas HTML y espacios, y recorta lo larguísimo", () => {
    const result = validateDeliveryAddress(
      { ...home, name: "  Ana   <script>alert(1)</script> Pérez ", line1: "x".repeat(500) },
      { mode: "home", zone: ZONE },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.address.name).not.toMatch(/[<>]/);
    expect(result.address.line1.length).toBe(120);
  });

  it("ningún valor raro (objeto, arreglo, número) rompe la validación", () => {
    const result = validateDeliveryAddress(
      { name: { a: 1 }, phone: ["5512345678"], postalCode: 3100, line1: null, city: undefined },
      { mode: "home", zone: ZONE },
    );
    expect(result.ok).toBe(false);
  });

  it("la dirección viaja a Stripe en metadata y se recupera igual en el webhook", () => {
    const result = validateDeliveryAddress(home, { mode: "home", zone: ZONE });
    if (!result.ok) throw new Error("debió ser válida");
    const metadata = addressToMetadata(result.address);
    for (const value of Object.values(metadata)) expect(value.length).toBeLessThanOrEqual(500);
    expect(addressFromMetadata(metadata)).toMatchObject({
      name: "Ana Pérez",
      phone: "5512345678",
      line1: "Av. Insurgentes Sur 123",
      city: "Benito Juárez",
      state: "Ciudad de México",
      postalCode: "03100",
      country: "MX",
    });
    // Un pedido viejo (sin dirección en metadata) no inventa una.
    expect(addressFromMetadata({ cartSkus: "A:1:10" })).toBeUndefined();
  });
});
