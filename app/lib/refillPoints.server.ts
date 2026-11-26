import { z } from "zod";
import { connectDB } from "~/lib/db.server";
import { UserModel } from "~/models/user.server";
import { AllyRequestModel } from "~/models/allyRequest.server";
import { hasControlChars } from "~/lib/formGuard.server";
import { normalizePhone } from "~/lib/deliveryAddress";
import { BUSINESS_TYPES, STATION_CITIES, type PublicRefillPoint } from "~/lib/refillPoints";

const text = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `Escribe ${label} (mínimo ${min} letras).`)
    .max(max, `${label[0].toUpperCase()}${label.slice(1)} es demasiado largo (máximo ${max} caracteres).`)
    .refine((v) => !hasControlChars(v), `${label[0].toUpperCase()}${label.slice(1)} tiene caracteres no válidos.`);

const whatsapp = z
  .string()
  .trim()
  .refine((v) => normalizePhone(v) !== null, "Escribe un WhatsApp de 10 dígitos.")
  .transform((v) => normalizePhone(v) as string);

/** Formulario público "Conviértete en Punto de Recarga". */
export const allyRequestSchema = z.object({
  name: text("tu nombre", 2, 80),
  businessOrType: z.enum(BUSINESS_TYPES, { message: "Elige qué tipo de punto serías." }),
  neighborhood: text("tu colonia", 2, 80),
  address: text("la dirección o una referencia", 5, 160),
  whatsapp,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(100, "El correo es demasiado largo.")
    .email("Ingresa un correo válido.")
    .refine((v) => !hasControlChars(v), "El correo tiene caracteres no válidos."),
  privacy: z.literal("on", { message: "Acepta el aviso de privacidad para enviar tu solicitud." }),
});

/**
 * Datos del punto en la ficha del cliente (admin). Para publicarlo en el directorio deben estar
 * completos: una tarjeta sin dirección u horario no le sirve a quien la busca.
 */
export const allyStationSchema = z
  .object({
    businessName: z.string().trim().max(80),
    neighborhood: z.string().trim().max(80),
    city: z.enum(STATION_CITIES),
    address: z.string().trim().max(160),
    schedule: z.string().trim().max(120),
    whatsapp: z.string().trim().max(30),
    isPublic: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const phoneOk = normalizePhone(value.whatsapp) !== null;
    if (value.whatsapp && !phoneOk) ctx.addIssue({ code: "custom", message: "El WhatsApp debe tener 10 dígitos.", path: ["whatsapp"] });
    if (!value.isPublic) return;
    const missing: [string, string][] = [
      [value.businessName, "el nombre del punto"],
      [value.neighborhood, "la colonia"],
      [value.address, "la dirección"],
      [value.schedule, "el horario"],
    ];
    for (const [field, label] of missing) {
      if (!field) ctx.addIssue({ code: "custom", message: `Para publicarlo en el directorio falta ${label}.`, path: ["isPublic"] });
    }
    if (!phoneOk) ctx.addIssue({ code: "custom", message: "Para publicarlo en el directorio falta un WhatsApp de 10 dígitos.", path: ["isPublic"] });
  });

/**
 * Lo que ve cualquiera en /puntos-de-recarga: solo aliados activos que un administrador marcó
 * como públicos, y solo los datos del punto (nunca el correo ni el nombre de la cuenta).
 */
export async function getPublicRefillPoints(): Promise<PublicRefillPoint[]> {
  await connectDB();
  const users = await UserModel.find({ isRefillAlly: true, "allyStation.isPublic": true })
    .select("allyStation")
    .lean();
  return users
    .map((user) => ({
      id: String(user._id),
      businessName: user.allyStation?.businessName ?? "",
      neighborhood: user.allyStation?.neighborhood ?? "",
      city: user.allyStation?.city ?? "",
      address: user.allyStation?.address ?? "",
      schedule: user.allyStation?.schedule ?? "",
      whatsapp: user.allyStation?.whatsapp ?? "",
    }))
    .filter((point) => point.businessName && point.neighborhood)
    .sort((a, b) => a.neighborhood.localeCompare(b.neighborhood, "es") || a.businessName.localeCompare(b.businessName, "es"));
}

/**
 * Guarda una solicitud. Si ese correo ya tiene una pendiente no crea otra (evita llenar el panel
 * de repetidas), pero quien envía no lo nota: la respuesta es la misma.
 */
export async function createAllyRequest(input: Omit<z.output<typeof allyRequestSchema>, "privacy">): Promise<{ created: boolean }> {
  await connectDB();
  const pending = await AllyRequestModel.exists({ email: input.email, status: "pending" });
  if (pending) return { created: false };
  await AllyRequestModel.create({ ...input, status: "pending", privacyAcceptedAt: new Date() });
  return { created: true };
}
