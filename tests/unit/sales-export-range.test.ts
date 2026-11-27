import { describe, expect, it } from "vitest";
import { isDay, lastMonthRange, mexicoToday, salesExportQuery, thisMonthRange } from "~/lib/salesExport";

describe("periodos del exportador de ventas", () => {
  it("este mes va del día 1 a hoy", () => {
    expect(thisMonthRange("2026-11-27")).toEqual({ from: "2026-11-01", to: "2026-11-27" });
  });

  it("mes pasado cubre el mes anterior completo, también en febrero, año bisiesto y enero", () => {
    expect(lastMonthRange("2026-11-27")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(lastMonthRange("2026-03-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(lastMonthRange("2028-03-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(lastMonthRange("2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("hoy se cuenta en hora de México: a las 11 pm del 30 aún es 30", () => {
    expect(mexicoToday(new Date("2026-12-01T05:00:00Z"))).toBe("2026-11-30");
    expect(mexicoToday(new Date("2026-12-01T06:30:00Z"))).toBe("2026-12-01");
  });

  it("solo acepta días reales", () => {
    expect(isDay("2026-11-27")).toBe(true);
    expect(isDay("2026-13-40")).toBe(false);
    expect(isDay("ayer")).toBe(false);
  });

  it("arma la dirección con las opciones elegidas", () => {
    const query = salesExportQuery({ from: "2026-11-01", to: "2026-11-30", estado: "todas", facturacion: "sin", manuales: false });
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
      estado: "todas",
      facturacion: "sin",
      manuales: "0",
    });
  });
});
