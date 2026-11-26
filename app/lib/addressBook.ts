/**
 * La libreta de direcciones de una cuenta, en su parte pura (sin base de datos): qué cuenta como
 * "la misma dirección", cómo se llama una dirección nueva y cómo se ofrece en el pago. La parte que
 * guarda en Mongo está en ~/lib/addressBook.server.
 *
 * Idea: cada dirección que la persona escribe al comprar se guarda sola. La primera queda como
 * principal; las demás, como secundarias. En "Mi cuenta" las nombra, cambia cuál es la principal o las quita.
 */

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
