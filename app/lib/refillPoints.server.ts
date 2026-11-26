import { z } from "zod";
import { connectDB } from "~/lib/db.server";
import { UserModel } from "~/models/user.server";
import { AllyRequestModel } from "~/models/allyRequest.server";
import { hasControlChars } from "~/lib/formGuard.server";
import { normalizePhone } from "~/lib/deliveryAddress";
import { BUSINESS_TYPES, normalizeMapsUrl, STATION_CITIES, type PublicRefillPoint } from "~/lib/refillPoints";
import { logAudit } from "~/lib/logger.server";

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

export const MAPS_URL_ERROR =
  "El enlace del mapa debe ser de Google Maps (https://maps.app.goo.gl/… o https://www.google.com/maps/…).";

/** Formulario público "Conviértete en Punto de Recarga". */
export const allyRequestSchema = z.object({
  name: text("tu nombre", 2, 80),
  /** Opcional: un vecino puede no tener un negocio. */
  businessName: z
    .string()
    .trim()
    .max(80, "El nombre del negocio es demasiado largo (máximo 80 caracteres).")
    .refine((v) => !hasControlChars(v), "El nombre del negocio tiene caracteres no válidos."),
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
    /** Enlace de Google Maps (opcional); se guarda ya validado. */
    mapsUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => normalizeMapsUrl(v) !== null, MAPS_URL_ERROR)
      .transform((v) => normalizeMapsUrl(v) ?? ""),
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
      mapsUrl: user.allyStation?.mapsUrl ?? "",
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

// --- De la solicitud al aliado activo -----------------------------------------------------------

export type ActivationResult = "activated" | "no-account" | "unverified" | "not-found";

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Activa como Punto de Recarga a la cuenta de quien envió una solicitud aprobada, sin que el administrador
 * tenga que hacerlo a mano en su ficha. Se enlaza por el correo de la solicitud y solo cuenta si la cuenta
 * ya CONFIRMÓ ese correo (si no, cualquiera podría registrarse con el correo de otra persona y quedarse
 * con su lugar). Los datos del punto salen de la solicitud; si la cuenta ya tenía datos de su punto, se
 * respetan. **Nunca publica en el directorio**: eso lo decide un administrador cuando el aliado lo autoriza.
 */
export async function activateAllyForRequest(requestId: string): Promise<ActivationResult> {
  await connectDB();
  const request = await AllyRequestModel.findById(requestId);
  if (!request) return "not-found";

  const user = await UserModel.findOne({ email: request.email }).select("emailVerifiedAt allyStation");
  if (!user) return "no-account";
  if (!user.emailVerifiedAt) return "unverified";

  const existing = user.allyStation;
  const keep = <T extends string>(current: T | undefined | null, fallback: T) => (current ? current : fallback);
  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        isRefillAlly: true,
        allyStation: {
          businessName: keep(existing?.businessName, request.businessName || `Punto de ${firstName(request.name)}`),
          neighborhood: keep(existing?.neighborhood, request.neighborhood),
          city: keep(existing?.city, "CDMX"),
          address: keep(existing?.address, request.address),
          schedule: existing?.schedule ?? "",
          whatsapp: keep(existing?.whatsapp, request.whatsapp),
          mapsUrl: existing?.mapsUrl ?? "",
          isPublic: Boolean(existing?.isPublic),
        },
      },
    },
  );
  await AllyRequestModel.updateOne({ _id: request._id }, { $set: { userId: user._id } });
  logAudit("user.refill_ally_activated", { userId: String(user._id), requestId: String(request._id), via: "request_approved" });
  return "activated";
}

/**
 * Si la solicitud aprobada vuelve a pendiente o se rechaza, la cuenta que se activó por ella deja de ser
 * aliado (y sale del directorio). Sus datos se conservan por si se reactiva.
 */
export async function deactivateAllyForRequest(requestId: string): Promise<boolean> {
  await connectDB();
  const request = await AllyRequestModel.findById(requestId).select("userId");
  if (!request?.userId) return false;
  await UserModel.updateOne({ _id: request.userId }, { $set: { isRefillAlly: false, "allyStation.isPublic": false } });
  await AllyRequestModel.updateOne({ _id: request._id }, { $unset: { userId: "" } });
  logAudit("user.refill_ally_deactivated", { userId: String(request.userId), requestId: String(request._id), via: "request_unapproved" });
  return true;
}

/**
 * Para quien se registra DESPUÉS de que se aprobó su solicitud: al confirmar su correo se activa sola,
 * porque en el momento de aprobar aún no tenía cuenta.
 */
export async function activateApprovedAllyForUser(userId: unknown): Promise<boolean> {
  await connectDB();
  const user = await UserModel.findById(userId).select("email emailVerifiedAt");
  if (!user?.emailVerifiedAt) return false;
  const approved = await AllyRequestModel.findOne({ email: user.email, status: "approved" }).sort({ updatedAt: -1 }).select("_id");
  if (!approved) return false;
  return (await activateAllyForRequest(String(approved._id))) === "activated";
}
