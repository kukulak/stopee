/**
 * IVA y datos de facturación (CFDI 4.0). Sin base de datos ni nada del servidor: lo usan igual el
 * carrito, el pago, la cuenta, los correos y el admin.
 *
 * Todos los precios de la tienda (productos y envío) YA incluyen el IVA de 16%: pedir factura no
 * cambia lo que se paga. El desglose es solo informativo y se calcula hacia atrás desde el total.
 */

export const IVA_RATE = 0.16;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Total con IVA incluido → lo que es producto y lo que es IVA (los dos redondeados a centavos y que suman el total). */
export function ivaBreakdown(totalMxn: number): { subtotal: number; iva: number; total: number } {
  const total = round2(Math.max(0, Number.isFinite(totalMxn) ? totalMxn : 0));
  const subtotal = round2(total / (1 + IVA_RATE));
  return { subtotal, iva: round2(total - subtotal), total };
}

/** "$85.24": para los renglones de IVA, que sí llevan centavos. */
export function formatMxnCents(n: number): string {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const PRICES_INCLUDE_IVA = "Precios en MXN con IVA incluido";

// --- Catálogos del SAT (los más comunes) ------------------------------------------------------

export type CatalogOption = { code: string; label: string };

export const REGIMENES_FISCALES: CatalogOption[] = [
  { code: "601", label: "General de Ley Personas Morales" },
  { code: "603", label: "Personas Morales con Fines no Lucrativos" },
  { code: "605", label: "Sueldos y Salarios e Ingresos Asimilados a Salarios" },
  { code: "606", label: "Arrendamiento" },
  { code: "612", label: "Personas Físicas con Actividades Empresariales y Profesionales" },
  { code: "616", label: "Sin obligaciones fiscales" },
  { code: "625", label: "Actividades Empresariales con ingresos a través de Plataformas Tecnológicas" },
  { code: "626", label: "Régimen Simplificado de Confianza (RESICO)" },
];

export const USOS_CFDI: CatalogOption[] = [
  { code: "G01", label: "Adquisición de mercancías" },
  { code: "G03", label: "Gastos en general" },
  { code: "S01", label: "Sin efectos fiscales" },
];

export const optionText = (o: CatalogOption) => `${o.code} - ${o.label}`;
export const regimenLabel = (code: string) => {
  const o = REGIMENES_FISCALES.find((r) => r.code === code);
  return o ? optionText(o) : code;
};
export const usoCfdiLabel = (code: string) => {
  const o = USOS_CFDI.find((u) => u.code === code);
  return o ? optionText(o) : code;
};

/** Regímenes que solo existen para personas morales (RFC de 12) y los que solo para personas físicas (RFC de 13). El 626 sirve a ambas. */
const MORAL_ONLY = new Set(["601", "603"]);
const FISICA_ONLY = new Set(["605", "606", "612", "616", "625"]);

// --- Validación ----------------------------------------------------------------------------

export type BillingInfo = {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostalFiscal: string;
  usoCfdi: string;
};

export type BillingField = keyof BillingInfo;
export type BillingErrors = Partial<Record<BillingField, string>>;

/** El RFC se acepta con minúsculas, espacios o guiones ("xaxx-010101 000"). */
export function normalizeRfc(input: unknown): string {
  return typeof input === "string" ? input.toUpperCase().replace(/[\s-]/g, "") : "";
}

const RFC_MORAL = /^[A-ZÑ&]{3}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z0-9]{3}$/;
const RFC_FISICA = /^[A-ZÑ&]{4}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z0-9]{3}$/;

export function rfcKind(rfc: string): "moral" | "fisica" | null {
  if (RFC_MORAL.test(rfc)) return "moral";
  if (RFC_FISICA.test(rfc)) return "fisica";
  return null;
}

/** Régimen de capital que va en el nombre comercial pero NO en el nombre del receptor del CFDI 4.0. */
const COMPANY_SUFFIX =
  /[\s,]+(?:S\.?\s?A\.?\s?P\.?\s?I\.?|S\.?\s?A\.?\s?B\.?|S\.?\s?A\.?\s?S\.?|S\.?\s?A\.?|S\.?\s?DE\s?R\.?\s?L\.?|S\.?\s?C\.?|A\.?\s?C\.?)(?:\s?DE\s?C\.?\s?V\.?)?\s*\.?$/i;

/** Mayúsculas, espacios limpios y, en personas morales, sin «S.A. de C.V.» y similares. */
export function cleanRazonSocial(input: unknown, kind: "moral" | "fisica" | null): string {
  let name = typeof input === "string" ? input.normalize("NFKC").replace(/[<>]/g, "").replace(/\s+/g, " ").trim() : "";
  name = name.toLocaleUpperCase("es-MX");
  if (kind === "moral") name = name.replace(COMPANY_SUFFIX, "").trim();
  return name.slice(0, 200);
}

export function validateBillingInfo(
  raw: Partial<Record<BillingField, unknown>>,
): { ok: true; info: BillingInfo } | { ok: false; errors: BillingErrors } {
  const errors: BillingErrors = {};

  const rfc = normalizeRfc(raw.rfc);
  const kind = rfcKind(rfc);
  if (!rfc) errors.rfc = "Escribe tu RFC.";
  else if (!kind) errors.rfc = "Revisa tu RFC: tiene 12 caracteres (empresa) o 13 (persona), por ejemplo XAXX010101000.";

  const razonSocial = cleanRazonSocial(raw.razonSocial, kind);
  if (razonSocial.length < 3) errors.razonSocial = "Escribe tu nombre o razón social tal como aparece en tu Constancia de Situación Fiscal.";

  const regimenFiscal = typeof raw.regimenFiscal === "string" ? raw.regimenFiscal.trim() : "";
  if (!REGIMENES_FISCALES.some((r) => r.code === regimenFiscal)) errors.regimenFiscal = "Elige tu régimen fiscal.";
  else if (kind === "fisica" && MORAL_ONLY.has(regimenFiscal)) {
    errors.regimenFiscal = "Ese régimen es de empresas y tu RFC es de persona física. Revisa tu Constancia.";
  } else if (kind === "moral" && FISICA_ONLY.has(regimenFiscal)) {
    errors.regimenFiscal = "Ese régimen es de personas físicas y tu RFC es de empresa. Revisa tu Constancia.";
  }

  const codigoPostalFiscal = typeof raw.codigoPostalFiscal === "string" ? raw.codigoPostalFiscal.replace(/\s/g, "") : "";
  if (!/^\d{5}$/.test(codigoPostalFiscal)) errors.codigoPostalFiscal = "Escribe el código postal de tu domicilio fiscal (5 dígitos).";

  const usoCfdi = typeof raw.usoCfdi === "string" ? raw.usoCfdi.trim() : "";
  if (!USOS_CFDI.some((u) => u.code === usoCfdi)) errors.usoCfdi = "Elige el uso del CFDI.";
  // Sin obligaciones fiscales no puede deducir nada: el SAT solo acepta «Sin efectos fiscales».
  else if (regimenFiscal === "616" && usoCfdi !== "S01") {
    errors.usoCfdi = "Con «Sin obligaciones fiscales» el único uso válido es S01 - Sin efectos fiscales.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, info: { rfc, razonSocial, regimenFiscal, codigoPostalFiscal, usoCfdi } };
}

// --- Textos compartidos (checkout, gracias, correo) --------------------------------------------

/** El número de pedido que ve el cliente: los últimos 8 caracteres del id, en mayúsculas. */
export function orderNumber(id: unknown): string {
  return String(id).slice(-8).toUpperCase();
}

/**
 * Nota para quien no pidió factura al pagar. El correo sale de «Datos del negocio» (admin); si el negocio
 * todavía no lo captura, se manda a la página de contacto.
 */
export function invoiceLaterNote(email?: string | null): string {
  const where = email?.trim() ? `a ${email.trim()}` : "por la página de Contacto";
  return `¿Necesitas factura después? Puedes solicitarla dentro del mismo mes calendario de tu compra enviando tu Constancia de Situación Fiscal, tu Uso de CFDI y tu número de pedido ${where}.`;
}

/** Los datos de una factura pedida, en texto plano para pegar en el sistema que emite el CFDI. */
export function billingCopyText(info: BillingInfo, order?: { number: string; total: number }): string {
  return [
    ...(order ? [`Pedido: ${order.number}`, `Total (IVA incluido): ${formatMxnCents(order.total)} MXN`] : []),
    `RFC: ${info.rfc}`,
    `Razón social: ${info.razonSocial}`,
    `Régimen fiscal: ${regimenLabel(info.regimenFiscal)}`,
    `Código postal fiscal: ${info.codigoPostalFiscal}`,
    `Uso de CFDI: ${usoCfdiLabel(info.usoCfdi)}`,
  ].join("\n");
}

// --- Formulario de pago y metadata de Stripe ----------------------------------------------------

/** Nombres de los campos en el formulario del carrito. */
export const INVOICE_FIELDS = {
  rfc: "invRfc",
  razonSocial: "invRazonSocial",
  regimenFiscal: "invRegimen",
  codigoPostalFiscal: "invCp",
  usoCfdi: "invUso",
} as const;

export type InvoiceRequest =
  | { requested: false }
  | { requested: true; saveToProfile: boolean; result: ReturnType<typeof validateBillingInfo> };

/** Lee «Requiero factura» y sus cinco campos. Sin la casilla marcada, lo demás se ignora. */
export function readInvoiceRequest(formData: FormData): InvoiceRequest {
  if (formData.get("invoiceRequested") !== "on") return { requested: false };
  const raw: Partial<Record<BillingField, unknown>> = {};
  for (const key of Object.keys(INVOICE_FIELDS) as BillingField[]) raw[key] = formData.get(INVOICE_FIELDS[key]);
  return { requested: true, saveToProfile: formData.get("invSave") === "on", result: validateBillingInfo(raw) };
}

/** Los datos viajan a Stripe en `metadata` (cada valor admite 500 caracteres) y el webhook los lee de ahí. */
export function billingToMetadata(info: BillingInfo): Record<string, string> {
  return {
    invoiceRequested: "true",
    invRfc: info.rfc,
    invRazonSocial: info.razonSocial,
    invRegimen: info.regimenFiscal,
    invCp: info.codigoPostalFiscal,
    invUso: info.usoCfdi,
  };
}

export function billingFromMetadata(metadata: Record<string, string> | null | undefined): BillingInfo | null {
  if (!metadata || metadata.invoiceRequested !== "true") return null;
  return {
    rfc: metadata.invRfc ?? "",
    razonSocial: metadata.invRazonSocial ?? "",
    regimenFiscal: metadata.invRegimen ?? "",
    codigoPostalFiscal: metadata.invCp ?? "",
    usoCfdi: metadata.invUso ?? "",
  };
}
