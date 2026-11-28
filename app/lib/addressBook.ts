/**
 * La libreta de direcciones de una cuenta, en su parte pura (sin base de datos): qué cuenta como
 * "la misma dirección", cómo se llama una dirección nueva y cómo se ofrece en el pago. La parte que
 * guarda en Mongo está en ~/lib/addressBook.server.
 *
 * Idea: cada dirección que la persona escribe al comprar se guarda sola. La primera queda como
 * principal; las demás, como secundarias. En "Mi cuenta" las nombra, cambia cuál es la principal o las quita.
 */

import { normalizePhone } from "~/lib/deliveryAddress";
import { normalizePostalCode } from "~/lib/deliveryZone";

/** Tope de direcciones secundarias por cuenta: evita que una cuenta crezca sin límite. */
export const MAX_SAVED_ADDRESSES = 10;

export type AddressLike = {
  line1?: string | null;
  postalCode?: string | null;
};

/** Minúsculas, sin acentos, puntuación ni espacios: "Av. Insurgentes Sur #123" ≈ "av insurgentes sur 123". */
function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Llave de comparación: calle + código postal. Vacía si no hay calle (no hay nada que comparar). */
export function addressKey(address: AddressLike): string {
  const street = normalizeText(address.line1 ?? "");
  const postalCode = (address.postalCode ?? "").trim();
  if (!street && !postalCode) return "";
  return `${street}|${postalCode}`;
}

export function sameAddress(a: AddressLike, b: AddressLike): boolean {
  const keyA = addressKey(a);
  return keyA !== "" && keyA === addressKey(b);
}

/** ¿La dirección principal de la cuenta todavía está vacía? */
export function isAddressEmpty(address: AddressLike | null | undefined): boolean {
  return !address || (!(address.line1 ?? "").trim() && !(address.postalCode ?? "").trim());
}

/** Nombre automático de una dirección que la persona aún no nombró. */
export function defaultAddressLabel(recipientName: string, ownerName: string | null | undefined): string {
  const recipient = recipientName.trim();
  const owner = (ownerName ?? "").trim();
  if (recipient && owner && recipient.toLowerCase() !== owner.toLowerCase()) {
    return `Entrega a ${recipient.split(/\s+/)[0]}`.slice(0, 40);
  }
  return "Otra dirección";
}

export type AddressOption = {
  /** "principal" o el id de una dirección guardada. */
  id: string;
  label: string;
  isPrincipal: boolean;
  /** Los campos listos para llenar el formulario de entrega. */
  fields: {
    name: string;
    phone: string;
    line1: string;
    line2: string;
    city: string;
    postalCode: string;
  };
};

type ProfileLike = {
  name?: string | null;
  phone?: string | null;
  address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    postalCode?: string | null;
    label?: string | null;
    recipientName?: string | null;
  } | null;
  savedAddresses?: Array<{
    _id?: unknown;
    label?: string | null;
    name?: string | null;
    phone?: string | null;
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    postalCode?: string | null;
  }> | null;
};

/** Todas las direcciones de la cuenta, la principal primero, listas para ofrecerlas en el pago y en "Mi cuenta". */
export function addressOptionsFromProfile(user: ProfileLike | null | undefined): AddressOption[] {
  if (!user) return [];
  const options: AddressOption[] = [];

  if (!isAddressEmpty(user.address)) {
    options.push({
      id: "principal",
      label: user.address?.label || "Principal",
      isPrincipal: true,
      fields: {
        name: user.address?.recipientName || user.name || "",
        phone: user.phone ?? "",
        line1: user.address?.line1 ?? "",
        line2: user.address?.line2 ?? "",
        city: user.address?.city ?? "",
        postalCode: user.address?.postalCode ?? "",
      },
    });
  }

  for (const saved of user.savedAddresses ?? []) {
    if (!saved._id) continue; // sin identificador no se puede elegir ni editar
    options.push({
      id: String(saved._id),
      label: saved.label || "Otra dirección",
      isPrincipal: false,
      fields: {
        name: saved.name ?? "",
        phone: saved.phone ?? "",
        line1: saved.line1 ?? "",
        line2: saved.line2 ?? "",
        city: saved.city ?? "",
        postalCode: saved.postalCode ?? "",
      },
    });
  }
  return options;
}

export type AddressFormField = "label" | "name" | "phone" | "line1" | "city" | "postalCode";

export type AddressFormValue = {
  label: string;
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
};

const tidy = (value: unknown, max: number) =>
  (typeof value === "string" ? value : "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Lo que la persona escribe en «Agregar dirección» / «Editar»: acepta teléfonos y códigos postales escritos como
 * quiera (con guiones, +52, un cero de menos) y dice, campo por campo, qué falta. No exige zona de entrega: eso se
 * revisa al pagar, no al guardar una dirección.
 */
export function validateAddressForm(
  raw: Partial<Record<keyof AddressFormValue, unknown>>,
): { ok: true; value: AddressFormValue } | { ok: false; errors: Partial<Record<AddressFormField, string>> } {
  const errors: Partial<Record<AddressFormField, string>> = {};
  const label = tidy(raw.label, 40);
  const name = tidy(raw.name, 100);
  const line1 = tidy(raw.line1, 120);
  const city = tidy(raw.city, 80);
  const phone = normalizePhone(raw.phone);
  const postalCode = normalizePostalCode(typeof raw.postalCode === "string" ? raw.postalCode : "");

  if (label.length < 2) errors.label = "Ponle un nombre para reconocerla, por ejemplo «Casa de mamá».";
  if (name.length < 3) errors.name = "Escribe el nombre de quien recibe.";
  if (!phone) errors.phone = "Escribe un teléfono de 10 dígitos.";
  if (line1.length < 3) errors.line1 = "Escribe la calle y el número.";
  if (city.length < 2) errors.city = "Escribe la alcaldía o el municipio.";
  if (!postalCode) errors.postalCode = "Escribe un código postal de 5 dígitos.";

  if (Object.keys(errors).length > 0 || !phone || !postalCode) return { ok: false, errors };
  return {
    ok: true,
    value: { label, name, phone, line1, line2: tidy(raw.line2, 120), city, state: tidy(raw.state, 80), postalCode },
  };
}
