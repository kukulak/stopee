import { describe, expect, it } from "vitest";
import { pickBestDiscount, type DiscountSource } from "~/lib/discountChoice";

const c = (source: DiscountSource, percent: number) => ({ source, percent });

describe("elegir el mejor descuento", () => {
  it("sin descuentos no hay ganador", () => {
    expect(pickBestDiscount([])).toBeNull();
    expect(pickBestDiscount([c("coupon", 0), c("auto", NaN)])).toBeNull();
  });

  it("gana el de mayor porcentaje, venga de donde venga", () => {
    expect(pickBestDiscount([c("coupon", 5), c("auto", 10), c("loyalty", 7)])).toEqual(c("auto", 10));
    expect(pickBestDiscount([c("coupon", 20), c("requirement", 30)])).toEqual(c("requirement", 30));
  });

  it("en un empate: primero el cupón escrito, luego el automático, el de requisito y al final lealtad", () => {
    expect(pickBestDiscount([c("loyalty", 10), c("requirement", 10), c("auto", 10), c("coupon", 10)])?.source).toBe("coupon");
    expect(pickBestDiscount([c("loyalty", 10), c("requirement", 10), c("auto", 10)])?.source).toBe("auto");
    expect(pickBestDiscount([c("loyalty", 10), c("requirement", 10)])?.source).toBe("requirement");
  });

  it("no modifica la lista que recibe", () => {
    const list = [c("loyalty", 1), c("coupon", 9)];
    pickBestDiscount(list);
    expect(list[0].source).toBe("loyalty");
  });
});
