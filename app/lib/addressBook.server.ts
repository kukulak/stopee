import { Types } from "mongoose";
import { connectDB } from "~/lib/db.server";
import { UserModel } from "~/models/user.server";
import {
  addressKey,
  defaultAddressLabel,
  isAddressEmpty,
  MAX_SAVED_ADDRESSES,
  sameAddress,
} from "~/lib/addressBook";

export type RememberedAddress = {
  name?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
};

export type AddressBookResult = { ok: true } | { ok: false; error: string };

const NOT_FOUND = "No encontramos esa dirección. Recarga la página e intenta de nuevo.";

function clean(value: string | null | undefined, max: number) {
  return (value ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Guarda la dirección que la persona acaba de escribir al pagar o al activar el Club. Es la
 * misma idea que escuchar a la persona: si ya la dio, no se la volvemos a pedir.
 *
 *  - Si su cuenta no tenía dirección, esta queda como la principal (y su teléfono/nombre, si faltaban).
 *  - Si es la principal o una ya guardada (aunque la haya escrito distinto), no se duplica.
 *  - Si es nueva, se guarda como secundaria con un nombre automático que luego puede cambiar.
 *
 * Nunca pisa la principal: puede estar enviando un regalo. Guardar es una comodidad y no
 * debe impedir el pago, así que quien llama atrapa cualquier error.
 */
export async function rememberDeliveryAddress(userId: string, address: RememberedAddress): Promise<void> {
  const line1 = clean(address.line1, 120);
  const postalCode = clean(address.postalCode, 10);
  if (!line1 || !postalCode) return;

  await connectDB();
  const user = await UserModel.findById(userId).select("name phone address savedAddresses");
  if (!user) return;

  const incoming = {
    name: clean(address.name, 100),
    phone: clean(address.phone, 20),
    line1,
    line2: clean(address.line2, 120),
    city: clean(address.city, 80),
    state: clean(address.state, 80),
    postalCode,
  };

  if (isAddressEmpty(user.address)) {
    await UserModel.updateOne(
      { _id: user._id },
      {
        $set: {
          address: {
            line1: incoming.line1,
            line2: incoming.line2,
            city: incoming.city,
            state: incoming.state,
            postalCode: incoming.postalCode,
            country: "MX",
            label: "Principal",
            recipientName: incoming.name,
          },
          ...(user.phone ? {} : { phone: incoming.phone }),
          ...(user.name ? {} : { name: incoming.name }),
        },
      },
    );
    return;
  }

  if (sameAddress(user.address ?? {}, incoming)) return;

  const known = (user.savedAddresses ?? []).find((saved) => sameAddress(saved, incoming));
  if (known) {
    // Misma dirección de otra vez: se actualiza a quién y a qué teléfono se entregó la última vez.
    await UserModel.updateOne(
      { _id: user._id, "savedAddresses._id": known._id },
      {
        $set: {
          "savedAddresses.$.name": incoming.name || known.name,
          "savedAddresses.$.phone": incoming.phone || known.phone,
          "savedAddresses.$.lastUsedAt": new Date(),
        },
      },
    );
    return;
  }

  if ((user.savedAddresses ?? []).length >= MAX_SAVED_ADDRESSES) return;

  const key = addressKey(incoming);
  // El filtro por `key` evita el duplicado si dos pagos de la misma dirección llegan a la vez.
  await UserModel.updateOne(
    { _id: user._id, "savedAddresses.key": { $ne: key } },
    {
      $push: {
        savedAddresses: {
          ...incoming,
          country: "MX",
          key,
          label: defaultAddressLabel(incoming.name, user.name),
          lastUsedAt: new Date(),
        },
      },
    },
  );
}

/** Pone un nombre ("Casa de mamá") a la principal (`id = "principal"`) o a una guardada. */
export async function renameAddress(userId: string, id: string, rawLabel: string): Promise<AddressBookResult> {
  const label = clean(rawLabel, 40);
  if (label.length < 2) return { ok: false, error: "Escribe un nombre de al menos 2 letras, por ejemplo «Casa de mamá»." };

  await connectDB();
  if (id === "principal") {
    const done = await UserModel.updateOne(
      { _id: userId, "address.postalCode": { $nin: [null, ""] } },
      { $set: { "address.label": label } },
    );
    return done.matchedCount > 0 ? { ok: true } : { ok: false, error: NOT_FOUND };
  }
  if (!Types.ObjectId.isValid(id)) return { ok: false, error: NOT_FOUND };
  const done = await UserModel.updateOne(
    { _id: userId, "savedAddresses._id": id },
    { $set: { "savedAddresses.$.label": label } },
  );
  return done.matchedCount > 0 ? { ok: true } : { ok: false, error: NOT_FOUND };
}

/** Quita una dirección guardada. La principal no se quita: se cambia por otra con `makePrincipalAddress`. */
export async function removeSavedAddress(userId: string, id: string): Promise<AddressBookResult> {
  if (!Types.ObjectId.isValid(id)) return { ok: false, error: NOT_FOUND };
  await connectDB();
  // El filtro exige que la dirección sea de esta cuenta: con otro id, no encuentra nada.
  const done = await UserModel.updateOne({ _id: userId, "savedAddresses._id": id }, { $pull: { savedAddresses: { _id: id } } });
  return done.matchedCount > 0 ? { ok: true } : { ok: false, error: NOT_FOUND };
}

/**
 * Cambia la dirección principal por una guardada. La principal de antes no se pierde: queda
 * guardada como secundaria con su nombre, a quién se entregaba y su teléfono.
 */
export async function makePrincipalAddress(userId: string, id: string): Promise<AddressBookResult> {
  if (!Types.ObjectId.isValid(id)) return { ok: false, error: NOT_FOUND };
  await connectDB();
  const user = await UserModel.findById(userId).select("name phone address savedAddresses");
  if (!user) return { ok: false, error: NOT_FOUND };

  const chosen = (user.savedAddresses ?? []).find((saved) => String(saved._id) === id);
  if (!chosen) return { ok: false, error: NOT_FOUND };

  const previous = user.address;
  const rest: Record<string, unknown>[] = (user.savedAddresses ?? [])
    .filter((saved) => String(saved._id) !== id)
    .map((saved) => saved.toObject() as Record<string, unknown>);

  if (!isAddressEmpty(previous)) {
    rest.push({
      _id: new Types.ObjectId(),
      label: previous?.label || "Principal anterior",
      name: previous?.recipientName || user.name || "",
      phone: user.phone ?? "",
      line1: previous?.line1 ?? "",
      line2: previous?.line2 ?? "",
      city: previous?.city ?? "",
      state: previous?.state ?? "",
      postalCode: previous?.postalCode ?? "",
      country: "MX",
      key: addressKey({ line1: previous?.line1, postalCode: previous?.postalCode }),
      lastUsedAt: new Date(),
    });
  }

  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        address: {
          line1: chosen.line1,
          line2: chosen.line2,
          city: chosen.city,
          state: chosen.state,
          postalCode: chosen.postalCode,
          country: "MX",
          label: chosen.label || "Principal",
          recipientName: chosen.name,
        },
        // El teléfono de la cuenta es el de la dirección principal: se queda con el de la nueva si lo tiene.
        ...(chosen.phone ? { phone: chosen.phone } : {}),
        savedAddresses: rest,
      },
    },
  );
  return { ok: true };
}
