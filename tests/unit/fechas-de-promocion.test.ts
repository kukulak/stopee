import { describe, expect, it } from "vitest";
import { endOfDayMx, formatDayMx, isDayString, startOfDayMx, toDayInputValue } from "~/lib/promotionDates";

describe("fechas de una promoción (días completos, hora de México)", () => {
  it("«termina el 27» sigue valiendo toda la tarde y noche del 27, y deja de valer el 28", () => {
    const fin = endOfDayMx("2026-11-27");
    expect(fin.getTime()).toBeGreaterThan(new Date("2026-11-27T20:00:00-06:00").getTime());
    expect(fin.getTime()).toBeGreaterThan(new Date("2026-11-27T23:30:00-06:00").getTime());
    expect(fin.getTime()).toBeLessThan(new Date("2026-11-28T00:00:00-06:00").getTime());
  });

  it("«inicia el 26» ya vale desde las 00:00 del 26 en México", () => {
    expect(startOfDayMx("2026-11-26").getTime()).toBe(new Date("2026-11-26T00:00:00-06:00").getTime());
  });

  it("el formulario vuelve a mostrar el mismo día que se escribió", () => {
    expect(toDayInputValue(startOfDayMx("2026-11-26"))).toBe("2026-11-26");
    expect(toDayInputValue(endOfDayMx("2026-11-27"))).toBe("2026-11-27");
    expect(toDayInputValue(endOfDayMx("2026-12-31"))).toBe("2026-12-31");
    expect(formatDayMx(endOfDayMx("2026-11-27"))).toBe("27/11/2026");
  });

  it("las fechas guardadas antes (medianoche UTC) se muestran en su mismo día, sin recorrerse", () => {
    expect(toDayInputValue(new Date("2026-11-27T00:00:00.000Z"))).toBe("2026-11-27");
  });

  it("vacío o inválido no truena", () => {
    expect(toDayInputValue(null)).toBe("");
    expect(toDayInputValue("basura")).toBe("");
    expect(isDayString("2026-13-45")).toBe(false);
    expect(isDayString("27/11/2026")).toBe(false);
    expect(isDayString("2026-11-27")).toBe(true);
  });
});
