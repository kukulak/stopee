import { describe, expect, it } from "vitest";
import {
  billingCopyText,
  cleanRazonSocial,
  formatMxnCents,
  invoiceLaterNote,
  ivaBreakdown,
  normalizeRfc,
  orderNumber,
  rfcKind,
  validateBillingInfo,
} from "~/lib/fiscal";

const valid = {
  rfc: "xaxx010101000",
  razonSocial: "Juan Pérez López",
  regimenFiscal: "612",
  codigoPostalFiscal: "03100",
  usoCfdi: "G03",
};

describe("IVA incluido, desglosado hacia atrás", () => {
  it("separa un total de $116 en $100 de producto y $16 de IVA", () => {
    expect(ivaBreakdown(116)).toEqual({ subtotal: 100, iva: 16, total: 116 });
  });

  it("siempre suma el total exacto, con centavos", () => {
    for (const total of [69, 150, 249, 549, 563, 618, 1699, 3000.5, 0.99]) {
      const { subtotal, iva } = ivaBreakdown(total);
      expect(Math.round((subtotal + iva) * 100)).toBe(Math.round(total * 100));
    }
    expect(ivaBreakdown(618)).toEqual({ subtotal: 532.76, iva: 85.24, total: 618 });
  });

  it("un total en cero o inválido no truena", () => {
    expect(ivaBreakdown(0)).toEqual({ subtotal: 0, iva: 0, total: 0 });
    expect(ivaBreakdown(NaN).total).toBe(0);
  });

  it("formatea con centavos", () => {
    expect(formatMxnCents(85.2)).toBe("$85.20");
    expect(formatMxnCents(1699)).toBe("$1,699.00");
  });
});

describe("RFC", () => {
  it("acepta minúsculas, espacios y guiones", () => {
    expect(normalizeRfc(" xaxx-010101 000 ")).toBe("XAXX010101000");
  });

  it("distingue persona moral (12) de persona física (13)", () => {
    expect(rfcKind("ABC010203AB1")).toBe("moral");
    expect(rfcKind("XAXX010101000")).toBe("fisica");
    expect(rfcKind("PELJ800101AB1")).toBe("fisica");
  });

  it("rechaza largos, fechas y caracteres imposibles", () => {
    expect(rfcKind("ABC010203AB")).toBeNull(); // 11
    expect(rfcKind("ABC011303AB1")).toBeNull(); // mes 13
    expect(rfcKind("ABC010232AB1")).toBeNull(); // día 32
    expect(rfcKind("12C010203AB1")).toBeNull();
    expect(rfcKind("")).toBeNull();
  });

  it("acepta los RFC genéricos de público general y extranjero", () => {
    expect(rfcKind("XAXX010101000")).toBe("fisica");
    expect(rfcKind("XEXX010101000")).toBe("fisica");
  });
});

describe("razón social", () => {
  it("va en mayúsculas y sin espacios de más", () => {
    expect(cleanRazonSocial("  juan   pérez  lópez ", "fisica")).toBe("JUAN PÉREZ LÓPEZ");
  });

  it("a una empresa le quita el régimen de capital", () => {
    expect(cleanRazonSocial("Veterinaria Roma S.A. de C.V.", "moral")).toBe("VETERINARIA ROMA");
    expect(cleanRazonSocial("Veterinaria Roma, SA DE CV", "moral")).toBe("VETERINARIA ROMA");
    expect(cleanRazonSocial("Pet Shop del Valle S. de R.L. de C.V.", "moral")).toBe("PET SHOP DEL VALLE");
    expect(cleanRazonSocial("Comercial Norte SAPI de CV", "moral")).toBe("COMERCIAL NORTE");
  });

  it("a una persona física no se le recorta nada, aunque su apellido parezca sufijo", () => {
    expect(cleanRazonSocial("Rosa Sa", "fisica")).toBe("ROSA SA");
  });
});

describe("validar datos fiscales", () => {
  it("acepta datos buenos y los deja limpios", () => {
    const r = validateBillingInfo(valid);
    expect(r).toEqual({
      ok: true,
      info: {
        rfc: "XAXX010101000",
        razonSocial: "JUAN PÉREZ LÓPEZ",
        regimenFiscal: "612",
        codigoPostalFiscal: "03100",
        usoCfdi: "G03",
      },
    });
  });

  it("marca cada campo que falla, en español y con qué hacer", () => {
    const r = validateBillingInfo({ rfc: "123", razonSocial: "", regimenFiscal: "999", codigoPostalFiscal: "3100", usoCfdi: "X" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["codigoPostalFiscal", "razonSocial", "regimenFiscal", "rfc", "usoCfdi"]);
  });

  it("un régimen de empresa con RFC de persona (o al revés) no pasa: el SAT rechazaría la factura", () => {
    const moralConPersona = validateBillingInfo({ ...valid, regimenFiscal: "601" });
    expect(moralConPersona.ok).toBe(false);
    const personaConEmpresa = validateBillingInfo({ ...valid, rfc: "ABC010203AB1", regimenFiscal: "612" });
    expect(personaConEmpresa.ok).toBe(false);
    expect(validateBillingInfo({ ...valid, rfc: "ABC010203AB1", razonSocial: "Roma S.A. de C.V.", regimenFiscal: "601" }).ok).toBe(true);
    // RESICO sirve a las dos.
    expect(validateBillingInfo({ ...valid, regimenFiscal: "626" }).ok).toBe(true);
    expect(validateBillingInfo({ ...valid, rfc: "ABC010203AB1", regimenFiscal: "626" }).ok).toBe(true);
  });

  it("«Sin obligaciones fiscales» solo admite el uso S01", () => {
    expect(validateBillingInfo({ ...valid, regimenFiscal: "616", usoCfdi: "G03" }).ok).toBe(false);
    expect(validateBillingInfo({ ...valid, regimenFiscal: "616", usoCfdi: "S01" }).ok).toBe(true);
  });

  it("no acepta código postal con letras ni de otro largo", () => {
    expect(validateBillingInfo({ ...valid, codigoPostalFiscal: "0310a" }).ok).toBe(false);
    expect(validateBillingInfo({ ...valid, codigoPostalFiscal: "031000" }).ok).toBe(false);
  });

  it("tolera valores que no son texto sin truenar", () => {
    expect(validateBillingInfo({ rfc: 5, razonSocial: null, regimenFiscal: undefined }).ok).toBe(false);
  });
});

describe("textos compartidos", () => {
  it("el número de pedido son los últimos 8 caracteres del id", () => {
    expect(orderNumber("6b08f5bf7624548de32b937d")).toBe("DE32B937D".slice(1));
    expect(orderNumber("6b08f5bf7624548de32b937d")).toHaveLength(8);
  });

  it("la nota de factura posterior lleva el correo si existe y manda a Contacto si no", () => {
    expect(invoiceLaterNote("facturas@stopee.test")).toMatch(/mismo mes calendario.*a facturas@stopee\.test/);
    expect(invoiceLaterNote("")).toMatch(/por la página de Contacto/);
    expect(invoiceLaterNote(null)).toMatch(/Constancia de Situación Fiscal/);
  });

  it("el texto para copiar trae los cinco datos y el pedido", () => {
    const text = billingCopyText(
      { rfc: "XAXX010101000", razonSocial: "JUAN", regimenFiscal: "612", codigoPostalFiscal: "03100", usoCfdi: "G03" },
      { number: "ABC12345", total: 618 },
    );
    expect(text).toContain("Pedido: ABC12345");
    expect(text).toContain("Total (IVA incluido): $618.00 MXN");
    expect(text).toContain("Régimen fiscal: 612 - Personas Físicas con Actividades Empresariales y Profesionales");
    expect(text).toContain("Uso de CFDI: G03 - Gastos en general");
  });
});
