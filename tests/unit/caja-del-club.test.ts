import { describe, expect, it } from "vitest";
import { buildBoxParam, parseBoxParam, subscriptionPageUrl } from "~/lib/subscriptionBox";

const SKUS = ["STOP-1L", "STOP-5L"];

describe("caja del Club: de /tienda a /suscripcion", () => {
  it("la caja armada viaja en la dirección y se lee igual al otro lado", () => {
    const url = subscriptionPageUrl({ "STOP-1L": 2, "STOP-5L": 1 }, "4-semanas");
    const params = new URL(url, "https://stopee.test").searchParams;
    expect(params.get("frecuencia")).toBe("4-semanas");
    expect(parseBoxParam(params.get("caja"), SKUS)).toEqual([
      { sku: "STOP-1L", quantity: 2 },
      { sku: "STOP-5L", quantity: 1 },
    ]);
  });

  it("no incluye productos con cantidad cero y, sin nada, la dirección queda limpia", () => {
    expect(buildBoxParam({ "STOP-1L": 0, "STOP-5L": 3 })).toBe("STOP-5L:3");
    expect(subscriptionPageUrl({}, "")).toBe("/suscripcion");
  });

  it("descarta lo que no es un producto apto para auto-envío", () => {
    expect(parseBoxParam("OTRO-SKU:2,STOP-1L:1", SKUS)).toEqual([{ sku: "STOP-1L", quantity: 1 }]);
  });

  it("cantidades raras (cero, negativas, decimales, texto) se ignoran y las enormes se topan en 99", () => {
    expect(parseBoxParam("STOP-1L:0", SKUS)).toEqual([]);
    expect(parseBoxParam("STOP-1L:-3", SKUS)).toEqual([]);
    expect(parseBoxParam("STOP-1L:1.5", SKUS)).toEqual([]);
    expect(parseBoxParam("STOP-1L:mucho", SKUS)).toEqual([]);
    expect(parseBoxParam("STOP-1L:5000", SKUS)).toEqual([{ sku: "STOP-1L", quantity: 99 }]);
  });

  it("no repite un producto aunque venga dos veces", () => {
    expect(parseBoxParam("STOP-1L:1,STOP-1L:5", SKUS)).toEqual([{ sku: "STOP-1L", quantity: 1 }]);
  });

  it("un parámetro vacío, roto o larguísimo da una caja vacía, sin error", () => {
    expect(parseBoxParam(null, SKUS)).toEqual([]);
    expect(parseBoxParam("", SKUS)).toEqual([]);
    expect(parseBoxParam(":::,,,", SKUS)).toEqual([]);
    expect(parseBoxParam("STOP-1L:1,".repeat(200), SKUS)).toEqual([]);
  });
});
