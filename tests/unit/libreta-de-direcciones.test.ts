import { describe, expect, it } from "vitest";
import {
  addressKey,
  addressOptionsFromProfile,
  defaultAddressLabel,
  isAddressEmpty,
  sameAddress,
} from "~/lib/addressBook";

describe("libreta de direcciones: qué es 'la misma dirección'", () => {
  it("ignora mayúsculas, acentos, puntuación y espacios", () => {
    expect(
      sameAddress(
        { line1: "Av. Insurgentes Sur #123", postalCode: "03100" },
        { line1: "av insurgentes sur 123", postalCode: "03100" },
      ),
    ).toBe(true);
    expect(sameAddress({ line1: "Calle Tláloc 5", postalCode: "01000" }, { line1: "calle tlaloc 5", postalCode: "01000" })).toBe(true);
  });

  it("el mismo número en otro código postal, o otra calle, es otra dirección", () => {
    expect(sameAddress({ line1: "Reforma 10", postalCode: "06600" }, { line1: "Reforma 10", postalCode: "11560" })).toBe(false);
    expect(sameAddress({ line1: "Reforma 10", postalCode: "06600" }, { line1: "Reforma 11", postalCode: "06600" })).toBe(false);
  });

  it("una dirección vacía nunca es igual a otra vacía", () => {
    expect(addressKey({})).toBe("");
    expect(sameAddress({}, {})).toBe(false);
    expect(isAddressEmpty({ line1: " ", postalCode: "" })).toBe(true);
    expect(isAddressEmpty({ line1: "Reforma 10", postalCode: "" })).toBe(false);
    expect(isAddressEmpty(null)).toBe(true);
  });
});

describe("libreta de direcciones: nombre automático", () => {
  it("si la recibe otra persona, se llama 'Entrega a' y su primer nombre", () => {
    expect(defaultAddressLabel("María López", "Christian Valderrama")).toBe("Entrega a María");
  });

  it("si la recibe la misma persona, o no hay datos, es 'Otra dirección'", () => {
    expect(defaultAddressLabel("christian valderrama", "Christian Valderrama")).toBe("Otra dirección");
    expect(defaultAddressLabel("", "Christian")).toBe("Otra dirección");
    expect(defaultAddressLabel("María", null)).toBe("Otra dirección");
  });
});

describe("libreta de direcciones: lo que se ofrece al pagar", () => {
  const user = {
    name: "Christian",
    phone: "5511111111",
    address: { line1: "Calle A 1", city: "Coyoacán", postalCode: "04000", label: "Casa", recipientName: "Christian" },
    savedAddresses: [
      { _id: "abc123", label: "Casa de mamá", name: "Rosa", phone: "5522222222", line1: "Calle B 2", city: "Miguel Hidalgo", postalCode: "11560" },
    ],
  };

  it("la principal va primero, con el teléfono de la cuenta, y luego las guardadas con sus propios datos", () => {
    const options = addressOptionsFromProfile(user);
    expect(options.map((o) => [o.id, o.label, o.isPrincipal])).toEqual([
      ["principal", "Casa", true],
      ["abc123", "Casa de mamá", false],
    ]);
    expect(options[0].fields).toMatchObject({ name: "Christian", phone: "5511111111", postalCode: "04000" });
    expect(options[1].fields).toMatchObject({ name: "Rosa", phone: "5522222222", postalCode: "11560" });
  });

  it("sin dirección principal ni guardadas, no ofrece nada; sin nombre usa uno por defecto", () => {
    expect(addressOptionsFromProfile({ name: "Ana", address: { line1: "", postalCode: "" } })).toEqual([]);
    expect(addressOptionsFromProfile(null)).toEqual([]);
    const [principal] = addressOptionsFromProfile({ name: "Ana", address: { line1: "X 1", postalCode: "01000" } });
    expect(principal.label).toBe("Principal");
    expect(principal.fields.name).toBe("Ana");
  });
});
