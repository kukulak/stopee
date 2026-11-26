import { describe, expect, it } from "vitest";
import { couponAudienceAllows, couponNeedsAccount, describeCouponRules } from "~/lib/couponRules";

describe("cupones: para clientes, para aliados o para los dos", () => {
  it("un cupón solo para clientes lo usa un cliente y no un aliado", () => {
    const rules = { forCustomers: true, forAllies: false };
    expect(couponAudienceAllows(rules, false)).toBe(true);
    expect(couponAudienceAllows(rules, true)).toBe(false);
  });

  it("un cupón solo para aliados lo usa un aliado y no un cliente", () => {
    const rules = { forCustomers: false, forAllies: true };
    expect(couponAudienceAllows(rules, true)).toBe(true);
    expect(couponAudienceAllows(rules, false)).toBe(false);
  });

  it("con los dos marcados es para todos", () => {
    const rules = { forCustomers: true, forAllies: true };
    expect(couponAudienceAllows(rules, true)).toBe(true);
    expect(couponAudienceAllows(rules, false)).toBe(true);
  });

  it("los cupones anteriores a la opción (sin el dato) siguen valiendo para todos", () => {
    expect(couponAudienceAllows({}, true)).toBe(true);
    expect(couponAudienceAllows({}, false)).toBe(true);
    expect(couponAudienceAllows({ forCustomers: null, forAllies: null }, true)).toBe(true);
    expect(couponAudienceAllows(null, true)).toBe(true);
  });

  it("un cupón solo para aliados exige sesión (sin ella no se sabe quién compra); uno para clientes no", () => {
    expect(couponNeedsAccount({ forCustomers: false, forAllies: true })).toBe(true);
    expect(couponNeedsAccount({ forCustomers: true, forAllies: false })).toBe(false);
    expect(couponNeedsAccount({ forCustomers: true, forAllies: true })).toBe(false);
  });

  it("la lista del admin dice a quién va dirigido", () => {
    expect(describeCouponRules({ forCustomers: false, forAllies: true })).toContain("solo aliados");
    expect(describeCouponRules({ forCustomers: true, forAllies: false })).toContain("solo clientes");
    expect(describeCouponRules({ forCustomers: true, forAllies: true })).toEqual([]);
    expect(describeCouponRules({})).toEqual([]);
  });
});
