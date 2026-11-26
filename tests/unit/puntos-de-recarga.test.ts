import { describe, expect, it } from "vitest";
import { filterByNeighborhood, neighborhoodOptions, whatsappUrl } from "~/lib/refillPoints";

describe("puntos de recarga: WhatsApp", () => {
  it("arma el enlace con el número de 10 dígitos y un mensaje ya escrito", () => {
    expect(whatsappUrl("55 1234 5678")).toBe("https://wa.me/525512345678");
    expect(whatsappUrl("(55) 1234-5678", "Hola, quiero recargar")).toBe(
      "https://wa.me/525512345678?text=Hola%2C%20quiero%20recargar",
    );
  });

  it("acepta el número con +52 y lo deja en 10 dígitos", () => {
    expect(whatsappUrl("+52 55 1234 5678")).toBe("https://wa.me/525512345678");
  });

  it("sin un número válido no hay enlace (nunca uno roto)", () => {
    expect(whatsappUrl("1234")).toBeNull();
    expect(whatsappUrl("")).toBeNull();
    expect(whatsappUrl(undefined)).toBeNull();
    expect(whatsappUrl({ a: 1 })).toBeNull();
  });

  it("el mensaje se codifica: no puede colar parámetros ni caracteres raros en el enlace", () => {
    const url = whatsappUrl("5512345678", "hola&text=otro#x")!;
    expect(url).toBe("https://wa.me/525512345678?text=hola%26text%3Dotro%23x");
  });
});

describe("puntos de recarga: colonias", () => {
  const points = [
    { neighborhood: "Roma Norte" },
    { neighborhood: "roma norte" },
    { neighborhood: "Coyoacán" },
    { neighborhood: "Del Valle" },
  ];

  it("lista cada colonia una vez, aunque cambie mayúsculas o acentos, en orden alfabético", () => {
    expect(neighborhoodOptions([...points, { neighborhood: "COYOACAN" }])).toEqual(["Coyoacán", "Del Valle", "Roma Norte"]);
  });

  it("filtra por colonia sin distinguir mayúsculas ni acentos, y sin colonia muestra todo", () => {
    expect(filterByNeighborhood(points, "coyoacan")).toEqual([{ neighborhood: "Coyoacán" }]);
    expect(filterByNeighborhood(points, "")).toHaveLength(4);
    expect(filterByNeighborhood(points, null)).toHaveLength(4);
    expect(filterByNeighborhood(points, "Narvarte")).toEqual([]);
  });
});
