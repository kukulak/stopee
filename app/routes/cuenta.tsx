import { isStaff } from "~/lib/roles";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { z } from "zod";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { connectDB } from "~/lib/db.server";
import { requireUserId, logout, getSession, sessionStorage } from "~/lib/session.server";
import { UserModel, hashPassword, verifyPassword } from "~/models/user.server";
import { passwordProblem } from "~/lib/password";
import { requestEmailChange } from "~/lib/emailChange.server";
import { checkRateLimit, rateLimitMessage } from "~/lib/rateLimit.server";
import { sendPasswordChangedNotice, sendVerificationEmail, settleWithin } from "~/lib/accountEmails.server";
import { OrderModel } from "~/models/order.server";
import { SubscriptionModel } from "~/models/subscription.server";
import {
  createBillingPortalSession,
  pauseSubscription,
  resumeSubscription,
  updateSubscriptionFrequency,
} from "~/lib/stripe.server";
import { getSubscriptionConfig } from "~/models/subscriptionSettings.server";
import {
  activeFrequencies,
  frequencyKey,
  frequencyLabel,
  isOfferedFrequency,
  programDisplayName,
} from "~/lib/subscriptionConfig";
import { getActiveLoyaltyConfig } from "~/models/promotion.server";
import { ArrowIcon, MapPinIcon, PackageIcon, PawIcon, ReceiptIcon, RepeatIcon, StoreIcon, UserIcon } from "~/components/ui/Icons";
import { AccountSection, AccountTile, LoyaltyStrip, TileGroup, jumpTo } from "~/components/account/AccountHub";
import { firstNameOf, fullNameOf, greetingFor, splitFullName } from "~/lib/names";
import { describeLoyaltyReward, resolveLoyaltyTier } from "~/lib/loyalty";
import { AddressBookCard } from "~/components/account/AddressBookCard";
import { AllyCard } from "~/components/account/AllyCard";
import { BillingCard } from "~/components/account/BillingCard";
import { MarketingCard } from "~/components/account/MarketingCard";
import { DogsCard } from "~/components/account/DogsCard";
import { ProfileCard } from "~/components/account/ProfileCard";
import { LeadModel } from "~/models/lead.server";
import { orderNumber, validateBillingInfo } from "~/lib/fiscal";
import { AllyRequestModel } from "~/models/allyRequest.server";
import { ProductModel } from "~/models/product.server";
import { cleanPlainText } from "~/lib/formGuard.server";
import { normalizeMapsUrl, REQUEST_STATUS_LABELS, type RequestStatus } from "~/lib/refillPoints";
import { MAPS_URL_ERROR } from "~/lib/refillPoints.server";
import { normalizePhone } from "~/lib/deliveryAddress";
import { addressOptionsFromProfile, validateAddressForm } from "~/lib/addressBook";
import { addAddress, makePrincipalAddress, removeSavedAddress, renameAddress, updateAddress } from "~/lib/addressBook.server";

const ORDER_STATUS_LABELS: Record<string, string> = {
  paid: "Pagado",
  processing: "En preparación",
  shipped: "En tránsito",
  delivered: "Entregado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: "Activo",
  paused: "Pausado",
  past_due: "Pago pendiente",
  cancelled: "Cancelado",
};

export const meta: MetaFunction = () => [{ title: "Mi cuenta — STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  await connectDB();

  const [user, orders, subscriptions, loyaltyConfig, subscriptionConfig] = await Promise.all([
    UserModel.findById(userId).lean(),
    OrderModel.find({ user: userId }).sort({ createdAt: -1 }).lean(),
    SubscriptionModel.find({ user: userId }).sort({ createdAt: -1 }).lean(),
    getActiveLoyaltyConfig(),
    getSubscriptionConfig(),
  ]);

  if (!user) throw new Response("Usuario no encontrado", { status: 404 });

  // Punto de Recarga: su punto y sus pedidos de bidón, o el estado de su solicitud si todavía no es aliado.
  const isAlly = Boolean(user.isRefillAlly);
  const [allyOnlySkus, latestRequest] = await Promise.all([
    isAlly ? ProductModel.distinct("sku", { visibility: "ALLY_ONLY" }) : Promise.resolve([] as string[]),
    isAlly ? null : AllyRequestModel.findOne({ email: user.email }).sort({ createdAt: -1 }).select("status").lean(),
  ]);
  const allyOrders = isAlly
    ? orders
        .filter((o) => (o.items as { sku: string }[]).some((item) => allyOnlySkus.includes(item.sku)))
        .slice(0, 8)
        .map((o) => ({
          id: String(o._id),
          createdAt: new Date(o.createdAt as unknown as string).toISOString(),
          status: o.status,
          netAmount: o.netAmount,
          items: (o.items as { sku: string; name: string; quantity: number }[])
            .filter((item) => allyOnlySkus.includes(item.sku))
            .map((item) => ({ name: item.name, quantity: item.quantity })),
        }))
    : [];

  const dogs = (user.dogs && user.dogs.length > 0
    ? user.dogs
    : user.dogName
      ? [{ name: user.dogName, birthday: null }]
      : []
  ) as { name: string; birthday: string | Date | null }[];

  return data({
    ally: isAlly
      ? {
          businessName: user.allyStation?.businessName ?? "",
          neighborhood: user.allyStation?.neighborhood ?? "",
          city: user.allyStation?.city ?? "",
          address: user.allyStation?.address ?? "",
          schedule: user.allyStation?.schedule ?? "",
          whatsapp: user.allyStation?.whatsapp ?? "",
          mapsUrl: user.allyStation?.mapsUrl ?? "",
          isPublic: Boolean(user.allyStation?.isPublic),
        }
      : null,
    allyRequestStatus: (latestRequest?.status ?? null) as RequestStatus | null,
    allyOrders,
    user: {
      name: user.name,
      // Nombre de pila para el saludo: el guardado por separado o, en cuentas anteriores, la primera palabra.
      greetingName: user.firstName || firstNameOf(user.name),
      // Lo que se muestra al editar: lo guardado o, en cuentas anteriores, una sugerencia que la persona corrige.
      firstName: user.firstName || splitFullName(user.name).firstName,
      lastName: user.lastName ?? (user.firstName ? "" : splitFullName(user.name).lastName),
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      marketing: Boolean(user.marketingOptInAt),
      isAdmin: isStaff(user.role),
      phone: user.phone ?? "",
      address: user.address ?? {},
      addresses: addressOptionsFromProfile(user),
      billing: user.billingInfo?.rfc
        ? {
            rfc: user.billingInfo.rfc,
            razonSocial: user.billingInfo.razonSocial ?? "",
            regimenFiscal: user.billingInfo.regimenFiscal ?? "",
            codigoPostalFiscal: user.billingInfo.codigoPostalFiscal ?? "",
            usoCfdi: user.billingInfo.usoCfdi ?? "G03",
          }
        : null,
      dogs: dogs.map((d) => ({ name: d.name, birthday: d.birthday ? new Date(d.birthday).toISOString().slice(0, 10) : "" })),
    },
    loyalty: {
      count: user.loyaltyCycleCount ?? 0,
      required: loyaltyConfig.purchasesRequired,
      // Lo que gana al completar el ciclo en el que va, para mostrarlo como protagonista de la tarjeta.
      nextReward: describeLoyaltyReward(resolveLoyaltyTier(user.loyaltyCyclesCompleted ?? 0, loyaltyConfig.tiers)),
      pendingReward: user.loyaltyPendingReward
        ? {
            rewardType: user.loyaltyPendingReward.rewardType,
            percentage: user.loyaltyPendingReward.percentage ?? null,
            giftDescription: user.loyaltyPendingReward.giftDescription ?? null,
          }
        : null,
    },
    orders: orders.map((o) => ({
      id: String(o._id),
      items: o.items,
      netAmount: o.netAmount,
      shippingCost: o.shippingCost ?? 0,
      status: o.status,
      createdAt: o.createdAt,
      number: orderNumber(o._id),
      requiresInvoice: Boolean(o.requiresInvoice),
    })),
    subscriptions: subscriptions.map((s) => ({
      id: String(s._id),
      items: s.items as Array<{ sku: string; quantity: number; name: string }>,
      frequency: s.frequency,
      status: s.status,
      currentPeriodEnd: s.currentPeriodEnd,
      requiresInvoice: Boolean(s.requiresInvoice),
    })),
    subscriptionProgram: {
      name: programDisplayName(subscriptionConfig),
      disclaimer: subscriptionConfig.disclaimer,
      frequencies: activeFrequencies(subscriptionConfig).map((f) => frequencyKey(f.weeks)),
    },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  await connectDB();
  const formData = await request.formData();
  const intent = formData.get("intent");
  const subscriptionId = String(formData.get("subscriptionId") ?? "");

  if (intent === "address-rename" || intent === "address-make-principal" || intent === "address-remove") {
    const addressId = String(formData.get("addressId") ?? "");
    const result =
      intent === "address-rename"
        ? await renameAddress(userId, addressId, String(formData.get("label") ?? ""))
        : intent === "address-make-principal"
          ? await makePrincipalAddress(userId, addressId)
          : await removeSavedAddress(userId, addressId);
    return data(
      { ok: result.ok, savedIntent: intent, error: result.ok ? null : result.error },
      { status: result.ok ? 200 : 400 },
    );
  }

  if (intent === "address-add" || intent === "address-update") {
    const parsed = validateAddressForm({
      label: formData.get("label"),
      name: formData.get("name"),
      phone: formData.get("phone"),
      line1: formData.get("line1"),
      line2: formData.get("line2"),
      city: formData.get("city"),
      state: formData.get("state"),
      postalCode: formData.get("postalCode"),
    });
    if (!parsed.ok) {
      return data(
        { ok: false, savedIntent: intent, error: "Revisa los datos marcados en rojo.", errors: parsed.errors },
        { status: 400 },
      );
    }
    const result =
      intent === "address-add"
        ? await addAddress(userId, parsed.value)
        : await updateAddress(userId, String(formData.get("addressId") ?? ""), parsed.value);
    // Un fallo de la libreta (ya la tenía, llegó al tope) va como aviso general, no pegado a un campo.
    return data({ ok: result.ok, savedIntent: intent, error: result.ok ? null : result.error }, { status: result.ok ? 200 : 400 });
  }

  if (intent === "billing-update" || intent === "billing-remove") {
    if (intent === "billing-remove") {
      await UserModel.updateOne({ _id: userId }, { $unset: { billingInfo: 1 } });
      // Sin datos fiscales no hay con qué facturar: la factura automática de las cajas se apaga con ellos.
      await SubscriptionModel.updateMany({ user: userId }, { $set: { requiresInvoice: false } });
      return data({ ok: true, savedIntent: "billing-remove" as const, error: null as string | null });
    }
    const parsed = validateBillingInfo({
      rfc: formData.get("invRfc"),
      razonSocial: formData.get("invRazonSocial"),
      regimenFiscal: formData.get("invRegimen"),
      codigoPostalFiscal: formData.get("invCp"),
      usoCfdi: formData.get("invUso"),
    });
    if (!parsed.ok) {
      return data(
        { ok: false, savedIntent: "billing-update" as const, error: "Revisa los datos marcados en rojo.", errors: parsed.errors },
        { status: 400 },
      );
    }
    await UserModel.updateOne({ _id: userId }, { $set: { billingInfo: parsed.info } });
    return data({ ok: true, savedIntent: "billing-update" as const, error: null as string | null });
  }

  if (intent === "ally-update") {
    // Un aliado mantiene al día su horario, WhatsApp y mapa. El nombre, la dirección y publicar el punto en el
    // directorio siguen siendo de un administrador.
    const fail = (error: string) => data({ ok: false, savedIntent: "ally-update" as const, error }, { status: 400 });
    const me = await UserModel.findById(userId).select("isRefillAlly allyStation");
    if (!me?.isRefillAlly) return fail("Tu cuenta no es un Punto de Recarga.");

    const schedule = cleanPlainText(formData.get("schedule")).slice(0, 120);
    const whatsappRaw = cleanPlainText(formData.get("whatsapp"));
    const whatsapp = whatsappRaw ? normalizePhone(whatsappRaw) : "";
    const mapsUrl = normalizeMapsUrl(String(formData.get("mapsUrl") ?? ""));
    if (whatsapp === null) return fail("El WhatsApp debe tener 10 dígitos.");
    if (mapsUrl === null) return fail(MAPS_URL_ERROR);
    // Un punto que ya está en el directorio no puede quedarse sin horario ni WhatsApp.
    if (me.allyStation?.isPublic && (!schedule || !whatsapp)) {
      return fail("Tu punto ya aparece en el directorio: necesita horario y WhatsApp.");
    }

    await UserModel.updateOne(
      { _id: userId, isRefillAlly: true },
      { $set: { "allyStation.schedule": schedule, "allyStation.whatsapp": whatsapp, "allyStation.mapsUrl": mapsUrl } },
    );
    return data({ ok: true, savedIntent: "ally-update" as const, error: null as string | null });
  }

  if (intent === "update-profile") {
    // Mi perfil: nombre, apellidos y teléfono. El correo no se cambia aquí (lo ligan los pedidos y los avisos) y la
    // contraseña tiene su propio paso. Los apellidos son opcionales al editar para que quien solo quiere cambiar su
    // teléfono no tenga que llenarlos; al registrarse sí se piden.
    const parsed = z
      .object({
        firstName: z.string().trim().min(2, "Escribe tu nombre.").max(60, "Tu nombre es demasiado largo."),
        lastName: z.string().trim().max(80, "Tus apellidos son demasiado largos."),
        phone: z.string().trim().max(20, "Revisa tu teléfono."),
      })
      .safeParse({ firstName: formData.get("firstName"), lastName: formData.get("lastName") ?? "", phone: formData.get("phone") });
    if (!parsed.success) {
      return data(
        { ok: false, savedIntent: "update-profile" as const, error: parsed.error.issues[0]?.message ?? "Revisa los datos." },
        { status: 400 },
      );
    }
    const firstName = cleanPlainText(parsed.data.firstName);
    const lastName = cleanPlainText(parsed.data.lastName);
    await UserModel.updateOne({ _id: userId }, { firstName, lastName, name: fullNameOf(firstName, lastName), phone: parsed.data.phone });
    return data({ ok: true, savedIntent: "update-profile" as const, error: null as string | null });
  }

  if (intent === "update-dogs") {
    const dogNames = formData.getAll("mascota") as string[];
    const dogBirthdays = formData.getAll("dogBirthday") as string[];
    const dogs = dogNames
      .map((name, i) => ({ name: name.trim().slice(0, 40), birthday: dogBirthdays[i] ? new Date(dogBirthdays[i]) : undefined }))
      .filter((d) => d.name)
      .slice(0, 8);
    await UserModel.updateOne({ _id: userId }, { dogs });
    return data({ ok: true, savedIntent: "update-dogs" as const, error: null as string | null });
  }

  if (intent === "change-email") {
    const fail = (error: string, status = 400) => data({ ok: false, savedIntent: "change-email" as const, error }, { status });
    const limit = await checkRateLimit(`change-email:${userId}`, { max: 5, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) return fail(rateLimitMessage(limit.retryAfterSeconds), 429);

    const user = await UserModel.findById(userId).select("email name passwordHash");
    if (!user) return fail("No se encontró tu cuenta.", 404);
    // Con la contraseña: una sesión abierta en un equipo prestado no basta para quedarse con la cuenta.
    if (!(await verifyPassword(String(formData.get("currentPassword") ?? ""), user.passwordHash))) {
      return fail("Tu contraseña actual no es correcta.");
    }
    const result = await requestEmailChange(user, formData.get("newEmail"));
    if (!result.ok) return fail(result.error);
    return data({ ok: true, savedIntent: "change-email" as const, error: null as string | null, maskedEmail: result.maskedEmail });
  }

  if (intent === "change-password") {
    const fail = (error: string, status = 400) => data({ ok: false, savedIntent: "change-password" as const, error }, { status });
    const limit = await checkRateLimit(`change-password:${userId}`, { max: 5, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) return fail(rateLimitMessage(limit.retryAfterSeconds), 429);

    const user = await UserModel.findById(userId);
    if (!user) return fail("No se encontró tu cuenta.", 404);
    const current = String(formData.get("currentPassword") ?? "");
    const next = String(formData.get("newPassword") ?? "");
    const confirm = String(formData.get("confirmPassword") ?? "");

    // Pedir la actual evita que alguien con una sesión abierta (computadora compartida, teléfono prestado) cambie la
    // contraseña y se quede con la cuenta.
    if (!(await verifyPassword(current, user.passwordHash))) return fail("Tu contraseña actual no es correcta.");
    const problem = passwordProblem(next, user.email);
    if (problem) return fail(problem);
    if (next !== confirm) return fail("Las contraseñas nuevas no coinciden.");
    if (await verifyPassword(next, user.passwordHash)) return fail("La contraseña nueva debe ser distinta a la actual.");

    user.passwordHash = await hashPassword(next);
    user.passwordChangedAt = new Date();
    await user.save();
    // Aviso al correo, sin que un fallo del envío detenga el cambio.
    await settleWithin(sendPasswordChangedNotice(user).catch(() => undefined), 1500);

    // Las otras sesiones dejan de valer (passwordChangedAt); esta se renueva para que quien la cambió siga dentro.
    const session = await getSession(request);
    session.set("iat", Date.now());
    return data(
      { ok: true, savedIntent: "change-password" as const, error: null as string | null },
      { headers: { "Set-Cookie": await sessionStorage.commitSession(session) } },
    );
  }

  if (intent === "marketing-update") {
    const on = formData.get("marketing") === "on";
    const account = await UserModel.findById(userId).select("email").lean();
    if (on) {
      // Conserva la fecha en que lo aceptó por primera vez.
      await UserModel.updateOne({ _id: userId, marketingOptInAt: { $exists: false } }, { $set: { marketingOptInAt: new Date() } });
    } else {
      await UserModel.updateOne({ _id: userId }, { $unset: { marketingOptInAt: 1 } });
      // Si además estaba en la lista de espera con este correo, tampoco debe seguir recibiendo.
      if (account?.email) await LeadModel.updateMany({ email: account.email }, { $unset: { marketingOptInAt: 1 } });
    }
    return data({ ok: true, savedIntent: "marketing-update" as const, error: null as string | null });
  }

  if (intent === "resend-verification") {
    const user = await UserModel.findById(userId);
    if (!user) return data({ ok: false, savedIntent: "resend-verification" as const, error: "No se encontró tu cuenta." }, { status: 404 });
    if (user.emailVerifiedAt) {
      return data({ ok: true, savedIntent: "resend-verification" as const, error: null as string | null });
    }
    const limit = await checkRateLimit(`resend-verification:${userId}`, { max: 3, windowMs: 60 * 60 * 1000 });
    if (!limit.allowed) {
      return data({ ok: false, savedIntent: "resend-verification" as const, error: rateLimitMessage(limit.retryAfterSeconds) }, { status: 429 });
    }
    const { result } = await sendVerificationEmail(user);
    if (!result.ok && !result.skipped) {
      return data(
        { ok: false, savedIntent: "resend-verification" as const, error: "No pudimos enviar el correo en este momento. Intenta de nuevo en unos minutos." },
        { status: 502 },
      );
    }
    return data({ ok: true, savedIntent: "resend-verification" as const, error: null as string | null });
  }

  if (intent === "delete-account") {
    const user = await UserModel.findById(userId);
    if (!user || isStaff(user.role)) {
      return data({ ok: false, savedIntent: "delete-account" as const, error: "No se pudo eliminar la cuenta." }, { status: 400 });
    }

    // Pedir la contraseña evita que alguien con acceso momentáneo a una sesión
    // abierta (computadora compartida, teléfono prestado) borre la cuenta.
    const passwordLimit = await checkRateLimit(`delete-account:${userId}`, { max: 5, windowMs: 15 * 60 * 1000 });
    if (!passwordLimit.allowed) {
      return data(
        { ok: false, savedIntent: "delete-account" as const, error: rateLimitMessage(passwordLimit.retryAfterSeconds) },
        { status: 429 },
      );
    }
    const password = String(formData.get("password") ?? "");
    if (!(await verifyPassword(password, user.passwordHash))) {
      return data(
        { ok: false, savedIntent: "delete-account" as const, error: "La contraseña no es correcta. Vuelve a intentarlo." },
        { status: 400 },
      );
    }

    // No se puede borrar una cuenta con una suscripción todavía viva en
    // Stripe — cancelarla primero evita dejar un cobro recurrente activo sin
    // nadie que lo vea ni pueda detenerlo desde la tienda.
    const hasLiveSubscription = await SubscriptionModel.exists({
      user: userId,
      status: { $in: ["active", "paused", "past_due"] },
    });
    if (hasLiveSubscription) {
      return data({
        ok: false,
        savedIntent: "delete-account" as const,
        error: "Tienes una suscripción activa. Cancélala primero desde \"Gestionar método de pago\" y vuelve a intentarlo.",
      }, { status: 400 });
    }

    // Los pedidos SÍ se conservan (obligación contable/fiscal) — solo se
    // desvincula la referencia al usuario, igual que un pedido de invitado.
    await OrderModel.updateMany({ user: userId }, { $set: { user: null } });
    await UserModel.findByIdAndDelete(userId);

    return logout(request);
  }

  const subscription = await SubscriptionModel.findOne({ _id: subscriptionId, user: userId });
  if (intent === "billing-portal") {
    const user = await UserModel.findById(userId);
    if (!user?.stripeCustomerId) {
      return data({ ok: false, savedIntent: null, error: "Aún no tienes un método de pago registrado." }, { status: 400 });
    }
    const portalSession = await createBillingPortalSession(user.stripeCustomerId);
    return redirect(portalSession.url);
  }

  if (!subscription) {
    return data({ ok: false, savedIntent: null, error: "Suscripción no encontrada." }, { status: 404 });
  }

  if (intent === "subscription-invoice") {
    const turnOn = formData.get("invoice") === "on";
    if (turnOn) {
      const owner = await UserModel.findById(userId).select("billingInfo").lean();
      if (!owner?.billingInfo?.rfc) {
        return data(
          {
            ok: false,
            savedIntent: "subscription-invoice" as const,
            error: "Primero guarda tus datos en «Mis datos de facturación» (en Mi cuenta) y luego prende la factura de cada caja.",
          },
          { status: 400 },
        );
      }
    }
    subscription.requiresInvoice = turnOn;
    await subscription.save();
    return data({ ok: true, savedIntent: "subscription-invoice" as const, error: null as string | null });
  }

  if (intent === "pause-subscription") {
    await pauseSubscription(subscription.stripeSubscriptionId);
    subscription.status = "paused";
    await subscription.save();
  }

  if (intent === "resume-subscription") {
    await resumeSubscription(subscription.stripeSubscriptionId);
    subscription.status = "active";
    await subscription.save();
  }

  if (intent === "update-frequency") {
    const frequency = String(formData.get("frequency"));
    // Se permite conservar la frecuencia actual aunque ya no se ofrezca; cambiar a otra exige que esté vigente.
    if (frequency !== subscription.frequency && !isOfferedFrequency(await getSubscriptionConfig(), frequency)) {
      return data({ ok: false, savedIntent: null, error: "Esa frecuencia ya no está disponible. Elige otra." }, { status: 400 });
    }
    await updateSubscriptionFrequency(
      subscription.stripeSubscriptionId,
      frequency,
      subscription.items ?? [],
    );
    subscription.frequency = frequency;
    await subscription.save();
  }

  return data({ ok: true, savedIntent: null, error: null as string | null });
}

export default function Cuenta() {
  const { user, loyalty, orders, subscriptions, subscriptionProgram, ally, allyRequestStatus, allyOrders } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isBusy = navigation.state !== "idle";
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isResendingVerification = isBusy && navigation.formData?.get("intent") === "resend-verification";
  const resendResult =
    actionData && "savedIntent" in actionData && actionData.savedIntent === "resend-verification" ? actionData : null;
  const isDeletingAccount = isBusy && navigation.formData?.get("intent") === "delete-account";
  const deleteError =
    actionData && "savedIntent" in actionData && actionData.savedIntent === "delete-account"
      ? actionData.error
      : null;

  const hasPoint = Boolean(ally) || Boolean(allyRequestStatus);

  // Lo que dice cada cuadro del tablero: cómo está eso hoy, sin tener que abrirlo. Un cuadro sin nada que ver
  // (aún sin pedidos ni suscripción) se queda quieto y sin enlace; su sección ni siquiera se dibuja abajo.
  const hasOrders = orders.length > 0;
  const hasSubscriptions = subscriptions.length > 0;
  const inTransit = orders.filter((o) => o.status === "shipped").length;
  const preparing = orders.filter((o) => o.status === "paid" || o.status === "processing").length;
  const ordersSummary = hasOrders ? `${orders.length} ${orders.length === 1 ? "pedido" : "pedidos"}` : "Todavía no tienes pedidos";
  const ordersBadge = inTransit > 0 ? `${inTransit} en camino` : preparing > 0 ? `${preparing} en preparación` : null;
  const firstSubscription = subscriptions[0];
  const subscriptionSummary = firstSubscription
    ? `${SUBSCRIPTION_STATUS_LABELS[firstSubscription.status] ?? firstSubscription.status} · ${frequencyLabel(firstSubscription.frequency)}`
    : "Todavía no tienes una";
  const subscriptionBadge = subscriptions.some((s) => s.status === "past_due") ? "Pago pendiente" : null;
  const dogsSummary = user.dogs.length > 0 ? user.dogs.map((d) => d.name).join(", ") : "Agrega a tu perrito";
  const profileSummary = user.name || user.email;
  const addressesSummary = user.addresses.length === 0 ? "Agrega la primera" : user.addresses.map((a) => a.label).join(", ");
  const billingSummary = user.billing ? `RFC ${user.billing.rfc}` : "Sin datos guardados";

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar />

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
            Mi cuenta
          </p>
          <h1 className="mt-2 font-display text-3xl font-black text-carbon">{greetingFor(user.greetingName, user.dogs.map((d) => d.name))}</h1>
          <p className="mt-1 text-carbon/60">{user.email}</p>

          {!user.emailVerified && (
            <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-bold">Confirma tu correo</p>
              <p className="mt-1">
                Te mandamos un enlace a <span className="break-all font-semibold">{user.email}</span>. Con el correo
                confirmado puedes usar cupones personales.
              </p>
              {resendResult?.ok ? (
                <p role="status" className="mt-2 font-semibold text-bosque">
                  Listo, te enviamos un enlace nuevo. Revisa tu bandeja (y el spam).
                </p>
              ) : (
                <Form method="post" className="mt-2">
                  <input type="hidden" name="intent" value="resend-verification" />
                  <button
                    type="submit"
                    disabled={isResendingVerification}
                    className="min-h-11 rounded-full bg-carbon px-5 text-sm font-bold text-hueso disabled:opacity-60"
                  >
                    {isResendingVerification ? "Enviando…" : "Reenviar enlace"}
                  </button>
                  {resendResult?.error && <p className="mt-2 font-semibold text-red-700">{resendResult.error}</p>}
                </Form>
              )}
            </div>
          )}

          {user.isAdmin && (
            <Link
              to="/admin"
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-carbon px-6 text-sm font-bold text-hueso transition-colors hover:bg-bosque"
            >
              Ir al backoffice
              <ArrowIcon />
            </Link>
          )}

          <div id="menu" className="scroll-mt-20">
            <LoyaltyStrip loyalty={loyalty} pendingRewardText={loyalty.pendingReward ? describeLoyaltyReward(loyalty.pendingReward) : null} />
  
            {hasPoint && (
              <TileGroup title="Mi punto de recarga">
                <AccountTile
                  section="punto"
                  icon={<StoreIcon className="h-6 w-6" />}
                  title={ally ? "Mi punto de recarga" : "Mi solicitud de punto de recarga"}
                  summary={ally ? ally.businessName || "Tu punto y tus pedidos de bidón" : REQUEST_STATUS_LABELS[allyRequestStatus!]}
                />
              </TileGroup>
            )}
  
            <TileGroup title="Mis compras">
              <AccountTile
                section={hasOrders ? "pedidos" : undefined}
                icon={<PackageIcon className="h-6 w-6" />}
                title="Mis pedidos"
                summary={ordersSummary}
                badge={ordersBadge}
              />
              <AccountTile
                section={hasSubscriptions ? "suscripcion" : undefined}
                icon={<RepeatIcon className="h-6 w-6" />}
                title="Mi suscripción"
                summary={subscriptionSummary}
                badge={subscriptionBadge}
                badgeTone="warning"
              />
            </TileGroup>

            <TileGroup title="Mi información" columns="sm:grid-cols-2 lg:grid-cols-4">
              <AccountTile section="perritos" icon={<PawIcon className="h-6 w-6" />} title="Mis perritos" summary={dogsSummary} />
              <AccountTile section="perfil" icon={<UserIcon className="h-6 w-6" />} title="Mi perfil" summary={profileSummary} />
              <AccountTile section="direcciones" icon={<MapPinIcon className="h-6 w-6" />} title="Mis direcciones" summary={addressesSummary} />
              <AccountTile section="facturacion" icon={<ReceiptIcon className="h-6 w-6" />} title="Mis datos de facturación" summary={billingSummary} />
            </TileGroup>

            {/* Es solo sí o no: va aquí mismo, sin mandar a nadie a otra sección. */}
            <MarketingCard subscribed={user.marketing} />

            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Form method="post" action="/cuenta/salir">
                <button
                  type="submit"
                  className="min-h-11 rounded-full border border-carbon/25 px-6 text-sm font-semibold text-carbon transition-colors hover:bg-carbon/5"
                >
                  Cerrar sesión
                </button>
              </Form>
              <a
                href="#eliminar"
                onClick={(event) => jumpTo(event, "eliminar")}
                className="min-h-11 content-center text-sm font-semibold text-carbon/50 underline hover:text-red-700"
              >
                Eliminar mi cuenta
              </a>
            </div>
          </div>

          {hasPoint && <AccountSection id="punto">
    <AllyCard ally={ally} requestStatus={allyRequestStatus} orders={allyOrders} orderStatusLabels={ORDER_STATUS_LABELS} />
          </AccountSection>}

          {hasOrders && (
            <AccountSection id="pedidos">
              <h2 className="font-display text-xl font-black text-carbon">Mis pedidos</h2>
              <ul className="mt-4 flex flex-col gap-3">
                {orders.map((order) => (
                  <li
                    key={order.id}
                    className="flex items-center justify-between rounded-2xl border border-carbon/10 bg-white p-4"
                  >
                    <div>
                      <p className="text-sm font-semibold text-carbon">
                        {(order.items as Array<{ quantity: number; name: string }>)
                          .map((i) => `${i.quantity}× ${i.name}`)
                          .join(", ")}
                      </p>
                      <p className="text-xs text-carbon/50">
                        Pedido {order.number} · {new Date(order.createdAt).toLocaleDateString("es-MX")} ·{" "}
                        {ORDER_STATUS_LABELS[order.status] ?? order.status}
                        {order.shippingCost > 0 && ` · Incluye envío $${order.shippingCost} MXN`}
                        {order.requiresInvoice && " · Factura solicitada"}
                      </p>
                    </div>
                    <p className="font-display font-bold text-carbon">${order.netAmount} MXN</p>
                  </li>
                ))}
              </ul>
            </AccountSection>
          )}

          {hasSubscriptions && (
            <AccountSection id="suscripcion">
              <h2 className="font-display text-xl font-black text-carbon">Mi suscripción</h2>
              <ul className="mt-4 flex flex-col gap-4">
                {subscriptions.map((sub) => (
                  <li key={sub.id} className="rounded-3xl border border-carbon/10 bg-white p-5 sm:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-display font-bold text-carbon">
                          {sub.items.map((i) => `${i.quantity}× ${i.name}`).join(" + ")}
                        </p>
                        <p className="text-sm text-carbon/60">
                          {frequencyLabel(sub.frequency)} · Estado:{" "}
                          <span className="font-semibold capitalize">
                            {sub.status === "active"
                              ? "Activa"
                              : sub.status === "paused"
                                ? "Pausada"
                                : sub.status === "past_due"
                                  ? "Pago pendiente"
                                  : "Cancelada"}
                          </span>
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {sub.status === "active" ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="pause-subscription" />
                            <input type="hidden" name="subscriptionId" value={sub.id} />
                            <button
                              type="submit"
                              disabled={isBusy}
                              className="min-h-11 rounded-full border border-carbon/15 px-4 text-sm font-semibold text-carbon disabled:opacity-60"
                            >
                              Pausar
                            </button>
                          </Form>
                        ) : sub.status === "paused" ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="resume-subscription" />
                            <input type="hidden" name="subscriptionId" value={sub.id} />
                            <button
                              type="submit"
                              disabled={isBusy}
                              className="min-h-11 rounded-full bg-lima px-4 text-sm font-bold text-carbon disabled:opacity-60"
                            >
                              Reanudar
                            </button>
                          </Form>
                        ) : null}

                        <Form method="post">
                          <input type="hidden" name="intent" value="billing-portal" />
                          <button
                            type="submit"
                            disabled={isBusy}
                            className="min-h-11 rounded-full border border-carbon/15 px-4 text-sm font-semibold text-carbon disabled:opacity-60"
                          >
                            Gestionar pago
                          </button>
                        </Form>
                      </div>
                    </div>

                    <Form method="post" className="mt-4 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="intent" value="update-frequency" />
                      <input type="hidden" name="subscriptionId" value={sub.id} />
                      <label htmlFor={`freq-${sub.id}`} className="text-sm text-carbon/60">
                        Cambiar frecuencia:
                      </label>
                      <select
                        id={`freq-${sub.id}`}
                        name="frequency"
                        defaultValue={sub.frequency}
                        className="min-h-11 rounded-xl border border-carbon/15 px-3 text-sm"
                      >
                        {(subscriptionProgram.frequencies.includes(sub.frequency)
                          ? subscriptionProgram.frequencies
                          : [sub.frequency, ...subscriptionProgram.frequencies]
                        ).map((value) => (
                          <option key={value} value={value}>
                            {frequencyLabel(value)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={isBusy}
                        className="min-h-11 rounded-full border border-carbon/15 px-4 text-sm font-semibold text-carbon disabled:opacity-60"
                      >
                        Guardar
                      </button>
                    </Form>

                    {/* La factura de cada caja: se emite con los datos de «Mis datos de facturación» (otra sección de Mi cuenta). */}
                    <Form method="post" className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-carbon/10 pt-4">
                      <input type="hidden" name="intent" value="subscription-invoice" />
                      <input type="hidden" name="subscriptionId" value={sub.id} />
                      <input type="hidden" name="invoice" value={sub.requiresInvoice ? "off" : "on"} />
                      <div className="min-w-0 flex-1 basis-60">
                        <p className="text-sm font-semibold text-carbon">Factura en cada caja</p>
                        <p className="text-sm text-carbon/60">
                          {sub.requiresInvoice
                            ? user.billing
                              ? `Prendida: cada caja se factura con el RFC ${user.billing.rfc}.`
                              : "Prendida, pero ya no tienes datos fiscales guardados: agrégalos en «Mis datos de facturación» para que se emita."
                            : "Apagada: si necesitas factura de una caja, pídela dentro del mismo mes de su cobro."}
                        </p>
                      </div>
                      <button
                        type="submit"
                        disabled={isBusy}
                        className="min-h-11 rounded-full border border-carbon/15 px-4 text-sm font-semibold text-carbon disabled:opacity-60"
                      >
                        {sub.requiresInvoice ? "Apagar" : "Prender"}
                      </button>
                      {actionData && "savedIntent" in actionData && actionData.savedIntent === "subscription-invoice" && !actionData.ok && (
                        <p className="basis-full text-sm font-semibold text-red-600">{actionData.error}</p>
                      )}
                    </Form>
                  </li>
                ))}
              </ul>
            </AccountSection>
          )}

          <AccountSection id="perritos">
            <DogsCard dogs={user.dogs} />
          </AccountSection>

          <AccountSection id="perfil">
            <ProfileCard name={user.name ?? ""} firstName={user.firstName} lastName={user.lastName} email={user.email} emailVerified={user.emailVerified} phone={user.phone} />
          </AccountSection>

          <AccountSection id="direcciones">
            <AddressBookCard addresses={user.addresses} />
          </AccountSection>

          <AccountSection id="facturacion">
            <BillingCard billing={user.billing} invoicesBoxes={subscriptions.some((s) => s.requiresInvoice)} />
          </AccountSection>

          <AccountSection id="eliminar">
    {/* Borrar la cuenta va aparte, con su propio espacio y divisor: nadie debe confundirlo con salir. */}
              <div>
              <div className="rounded-3xl border border-red-200 bg-red-50/50 p-6">
                <p className="font-display font-bold text-red-900">Eliminar mi cuenta</p>
                <p className="mt-1 text-sm text-red-900/70">
                  Se borra tu perfil (datos de contacto, perritos, direcciones) de forma permanente. Tus
                  pedidos ya pagados se conservan como comprobante, sin ligarlos a tu nombre.
                </p>
    
                {deleteError && <p className="mt-3 text-sm font-semibold text-red-700">{deleteError}</p>}
    
                {!confirmingDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="mt-4 min-h-11 rounded-full border border-red-300 px-5 text-sm font-semibold text-red-700 hover:bg-red-100"
                  >
                    Eliminar mi cuenta
                  </button>
                ) : (
                  <Form method="post" className="mt-4 max-w-sm">
                    <input type="hidden" name="intent" value="delete-account" />
                    <label htmlFor="delete-account-password" className="block text-sm font-semibold text-red-900">
                      Escribe tu contraseña para confirmar
                    </label>
                    <input
                      id="delete-account-password"
                      name="password"
                      type="password"
                      required
                      autoFocus
                      autoComplete="current-password"
                      className="mt-2 min-h-11 w-full rounded-xl border border-red-300 bg-white px-4 text-base text-carbon focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={isDeletingAccount}
                        className="min-h-11 rounded-full bg-red-600 px-5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        {isDeletingAccount ? "Eliminando…" : "Sí, eliminar mi cuenta"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(false)}
                        className="min-h-11 rounded-full border border-carbon/15 px-5 text-sm font-semibold text-carbon hover:border-carbon/30"
                      >
                        Cancelar
                      </button>
                    </div>
                  </Form>
                )}
              </div>
              </div>
          </AccountSection>
        </section>
      </main>

      <Footer />
    </div>
  );
}
