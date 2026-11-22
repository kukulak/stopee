import { describe, expect, it } from "vitest";
import { computeBundlePrice } from "~/lib/pricing";
import { couponNeedsAccount, describeCouponRules, stackPercents } from "~/lib/couponRules";
import { resolveLoyaltyTier } from "~/lib/loyalty";
import { remainingToAdd, soldOutMessage, stockLimitMessage } from "~/lib/stock";

describe("precio de un paquete", () => {
  it("suma precio × cantidad menos el descuento de cada componente", () => {
    const total = computeBundlePrice([
      { price: 400, quantity: 2, discountPercentage: 10 }, // 720
      { price: 150, quantity: 1, discountPercentage: 0 }, // 150
    ]);
    expect(total).toBe(870);
  });

  it("redondea a centavos, sin arrastrar decimales flotantes", () => {
    expect(computeBundlePrice([{ price: 33.33, quantity: 3, discountPercentage: 15 }])).toBe(84.99);
  });

  it("un paquete vacío cuesta cero", () => {
    expect(computeBundlePrice([])).toBe(0);
  });
});

describe("descuentos que se suman", () => {
  it("10% y 15% encadenados no son 25%", () => {
    expect(stackPercents(10, 15)).toBe(24); // 23.5 redondeado
  });

  it("nunca pasa de 100%", () => {
    expect(stackPercents(100, 50)).toBe(100);
    expect(stackPercents(90, 90)).toBeLessThanOrEqual(100);
  });

  it("sin descuento en uno de los dos, queda el otro", () => {
    expect(stackPercents(0, 20)).toBe(20);
    expect(stackPercents(20, 0)).toBe(20);
  });
});

describe("reglas de cupón", () => {
  it("pide cuenta cuando el cupón es personal", () => {
    expect(couponNeedsAccount({ oncePerCustomer: true })).toBe(true);
    expect(couponNeedsAccount({ firstPurchaseOnly: true })).toBe(true);
    expect(couponNeedsAccount({ allowedEmails: ["ana@correo.com"] })).toBe(true);
  });

  it("no pide cuenta cuando no hay reglas de identidad", () => {
    expect(couponNeedsAccount(null)).toBe(false);
    expect(couponNeedsAccount({})).toBe(false);
    expect(couponNeedsAccount({ allowedEmails: [], minSpendMxn: 500 })).toBe(false);
  });

  it("resume las reglas para el panel de administración", () => {
    expect(describeCouponRules(null)).toEqual([]);
    expect(
      describeCouponRules({ oncePerCustomer: true, minSpendMxn: 1200, allowedEmails: ["a@a.com"], stackable: true }),
    ).toEqual(["1 uso por cliente", "1 correo", "mín. $1,200", "se suma a lealtad"]);
  });
});

describe("recompensa de lealtad", () => {
  const tiers = [
    { rewardType: "discount" as const, percentage: 10 },
    { rewardType: "gift" as const, giftDescription: "Atomizador" },
  ];

  it("entrega el nivel que toca según los ciclos completados", () => {
    expect(resolveLoyaltyTier(0, tiers)).toBe(tiers[0]);
    expect(resolveLoyaltyTier(1, tiers)).toBe(tiers[1]);
  });

  it("repite el último nivel cuando ya no hay más definidos", () => {
    expect(resolveLoyaltyTier(7, tiers)).toBe(tiers[1]);
  });

  it("un número negativo cuenta como el primer ciclo", () => {
    expect(resolveLoyaltyTier(-3, tiers)).toBe(tiers[0]);
  });

  it("sin niveles configurados, da 10% de descuento", () => {
    expect(resolveLoyaltyTier(0, [])).toEqual({ rewardType: "discount", percentage: 10 });
  });
});

describe("existencias", () => {
  it("calcula cuánto más puede agregar el cliente", () => {
    expect(remainingToAdd(5, 2)).toBe(3);
    expect(remainingToAdd(5, 5)).toBe(0);
  });

  it("nunca regresa negativos, ni cuenta carritos con cantidades raras", () => {
    expect(remainingToAdd(2, 10)).toBe(0);
    expect(remainingToAdd(3, -4)).toBe(3);
    expect(remainingToAdd(0, 0)).toBe(0);
  });

  it("redacta el aviso en singular y en plural", () => {
    expect(soldOutMessage("Concentrado")).toBe("Concentrado está agotado por ahora.");
    expect(stockLimitMessage(1, "Concentrado")).toBe("Solo queda 1 unidad de Concentrado.");
    expect(stockLimitMessage(4, "Concentrado")).toBe("Solo hay 4 unidades de Concentrado.");
  });
});
