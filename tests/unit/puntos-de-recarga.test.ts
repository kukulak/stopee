import { describe, expect, it } from "vitest";
import { directionsUrl, filterByNeighborhood, mapsSearchUrl, neighborhoodOptions, normalizeMapsUrl, whatsappUrl } from "~/lib/refillPoints";

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

describe("puntos de recarga: enlace del mapa", () => {
  it("acepta enlaces de Google Maps y los cortos de Maps", () => {
    expect(normalizeMapsUrl("https://maps.app.goo.gl/AbC123")).toBe("https://maps.app.goo.gl/AbC123");
    expect(normalizeMapsUrl("https://www.google.com/maps/place/Veterinaria/@19.3,-99.1,17z")).toContain("google.com/maps/place");
    expect(normalizeMapsUrl("https://google.com.mx/maps?q=roma")).toContain("google.com.mx/maps");
    expect(normalizeMapsUrl("https://maps.google.com/maps?q=roma")).toContain("maps.google.com/maps");
    expect(normalizeMapsUrl("https://goo.gl/maps/xyz")).toBe("https://goo.gl/maps/xyz");
  });

  it("vacío es válido (sin enlace) y se devuelve vacío", () => {
    expect(normalizeMapsUrl("")).toBe("");
    expect(normalizeMapsUrl("   ")).toBe("");
    expect(normalizeMapsUrl(undefined)).toBe("");
    expect(normalizeMapsUrl(null)).toBe("");
  });

  it("rechaza todo lo que no sea Google Maps: otros sitios, http, javascript:, datos en la dirección", () => {
    for (const bad of [
      "http://maps.app.goo.gl/AbC123",
      "javascript:alert(1)",
      "https://malo.example/maps",
      "https://www.google.com/search?q=roma", // Google, pero no Maps
      "https://google.com.malo.example/maps",
      "https://maps.app.goo.gl.malo.example/x",
      "https://user:pass@www.google.com/maps",
      "https://goo.gl/otra-cosa",
      "https://www.google.com/maps/ con espacios",
      "data:text/html,<script>1</script>",
      "no es un enlace",
    ]) {
      expect(normalizeMapsUrl(bad), bad).toBeNull();
    }
    expect(normalizeMapsUrl({} as unknown)).toBeNull();
    expect(normalizeMapsUrl("https://www.google.com/maps/" + "a".repeat(600))).toBeNull();
  });

  const point = { businessName: "Pet Roma", address: "Calle Colima 123", neighborhood: "Roma Norte", city: "CDMX", mapsUrl: "" };

  it("sin enlace exacto, «Abrir mapa» busca la dirección del punto en Google Maps", () => {
    const url = directionsUrl(point);
    expect(url.startsWith("https://www.google.com/maps/search/?api=1&query=")).toBe(true);
    expect(decodeURIComponent(url.split("query=")[1])).toBe("Pet Roma, Calle Colima 123, Roma Norte, CDMX");
    expect(mapsSearchUrl(point)).toBe(url);
  });

  it("con enlace exacto usa ese; si el guardado no es válido, vuelve a la búsqueda (nunca un enlace raro)", () => {
    expect(directionsUrl({ ...point, mapsUrl: "https://maps.app.goo.gl/AbC123" })).toBe("https://maps.app.goo.gl/AbC123");
    expect(directionsUrl({ ...point, mapsUrl: "https://malo.example" }).startsWith("https://www.google.com/maps/search/")).toBe(true);
  });
});
