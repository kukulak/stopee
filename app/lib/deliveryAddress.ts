import { isPostalCodeInZone, normalizePostalCode, type DeliveryZone } from "~/lib/deliveryZone";

/**
 * La dirección de entrega que el cliente escribe en nuestro carrito (ya no en la
 * pantalla de Stripe). Una sola función la valida, para que el navegador, el
 * pago de una compra, la suscripción y las pruebas coincidan.
 */

/** Cómo se llaman los campos en el formulario del carrito y de la suscripción. */
export const ADDRESS_FIELDS = {
  name: "shipName",
  phone: "shipPhone",
  line1: "shipLine1",
  line2: "shipLine2",
  city: "shipCity",
  postalCode: "shipPostalCode",
} as const;

export type AddressFieldKey = keyof typeof ADDRESS_FIELDS;

export type DeliveryAddress = {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: "MX";
};

/**
 * "pickup" (punto de entrega) solo necesita saber a quién y dónde de forma
 * aproximada: nombre, teléfono y código postal. "home" necesita la dirección
 * completa. Sin envío cobrado o en suscripción se trata como "home".
 */
export type AddressMode = "pickup" | "home";

export type AddressErrors = Partial<Record<AddressFieldKey, string>>;

export type AddressResult =
  | { ok: true; address: DeliveryAddress }
  | { ok: false; errors: AddressErrors; outOfZone: boolean };

/** Mensaje único para "este código postal no está en la zona", en el navegador y en el servidor. */
export function outOfZoneMessage(zone: DeliveryZone): string {
  return `Por ahora solo entregamos en ${zone.name}. Ese código postal está fuera de nuestra zona.`;
}

/** Quita lo que no es texto de dirección y recorta el largo; el HTML no tiene lugar en un domicilio. */
function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Teléfono mexicano con las variaciones comunes: "55 1234 5678", "(55) 1234-5678",
 * "+52 55 1234 5678", "044 55…". Devuelve los 10 dígitos o null.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let digits = input.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("521")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("52")) digits = digits.slice(2);
  else if (digits.length === 13 && digits.startsWith("044")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("045")) digits = digits.slice(3);
  return digits.length === 10 ? digits : null;
}

export function validateDeliveryAddress(
  raw: Partial<Record<AddressFieldKey, unknown>>,
  options: { mode: AddressMode; zone: DeliveryZone },
): AddressResult {
  const { mode, zone } = options;
  const errors: AddressErrors = {};

  const name = clean(raw.name, 100);
  const line1 = clean(raw.line1, 120);
  const line2 = clean(raw.line2, 120);
  const city = clean(raw.city, 80);
  const phone = normalizePhone(raw.phone);
  const postalCode = normalizePostalCode(typeof raw.postalCode === "string" ? raw.postalCode : "");

  if (name.length < 3) errors.name = "Escribe el nombre de quien recibe.";
  if (!phone) errors.phone = "Escribe un teléfono de 10 dígitos para la paquetería.";
  if (!postalCode) errors.postalCode = "Escribe tu código postal de 5 dígitos.";
  if (mode === "home") {
    if (line1.length < 3) errors.line1 = "Escribe tu calle y número.";
    if (city.length < 2) errors.city = "Escribe tu alcaldía o municipio.";
  }

  let outOfZone = false;
  if (postalCode && !isPostalCodeInZone(postalCode, zone)) {
    outOfZone = true;
    errors.postalCode = outOfZoneMessage(zone);
  }

  if (Object.keys(errors).length > 0 || !postalCode || !phone) {
    return { ok: false, errors, outOfZone };
  }

  return {
    ok: true,
    address: { name, phone, line1, line2, city, state: zone.name, postalCode, country: "MX" },
  };
}

/** Lee los campos de un formulario (`FormData`) con los nombres de ADDRESS_FIELDS. */
export function readAddressFields(formData: FormData): Partial<Record<AddressFieldKey, unknown>> {
  const fields: Partial<Record<AddressFieldKey, unknown>> = {};
  for (const key of Object.keys(ADDRESS_FIELDS) as AddressFieldKey[]) {
    fields[key] = formData.get(ADDRESS_FIELDS[key]);
  }
  return fields;
}

/**
 * La dirección viaja a Stripe en `metadata` (cada valor admite 500 caracteres) y
 * el webhook la lee de ahí al confirmar el pago. Mismas llaves en las dos puntas.
 */
export function addressToMetadata(address: DeliveryAddress): Record<string, string> {
  return {
    shipName: address.name,
    shipPhone: address.phone,
    shipLine1: address.line1,
    shipLine2: address.line2,
    shipCity: address.city,
    shipState: address.state,
    shipPostalCode: address.postalCode,
  };
}

export function addressFromMetadata(metadata: Record<string, string> | null | undefined) {
  if (!metadata || !metadata.shipPostalCode) return undefined;
  return {
    name: metadata.shipName || undefined,
    phone: metadata.shipPhone || undefined,
    line1: metadata.shipLine1 || undefined,
    line2: metadata.shipLine2 || undefined,
    city: metadata.shipCity || undefined,
    state: metadata.shipState || undefined,
    postalCode: metadata.shipPostalCode,
    country: "MX",
  };
}

/**
 * Lo que ya está en el perfil de la persona, con los nombres de campo del
 * formulario, para que llegue lleno y no tenga que volver a escribirlo.
 */
export function addressDefaultsFromProfile(
  user:
    | {
        name?: string | null;
        phone?: string | null;
        address?: { line1?: string | null; line2?: string | null; city?: string | null; postalCode?: string | null } | null;
      }
    | null
    | undefined,
): Partial<Record<AddressFieldKey, string>> {
  if (!user) return {};
  return {
    name: user.name ?? "",
    phone: user.phone ?? "",
    line1: user.address?.line1 ?? "",
    line2: user.address?.line2 ?? "",
    city: user.address?.city ?? "",
    postalCode: user.address?.postalCode ?? "",
  };
}
