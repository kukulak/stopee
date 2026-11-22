import { isStaff } from "~/lib/roles";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { z } from "zod";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { connectDB } from "~/lib/db.server";
import { requireUserId, logout } from "~/lib/session.server";
import { UserModel, verifyPassword } from "~/models/user.server";
import { checkRateLimit, rateLimitMessage } from "~/lib/rateLimit.server";
import { sendVerificationEmail } from "~/lib/accountEmails.server";
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
import { ArrowIcon, CloseIcon } from "~/components/ui/Icons";

const ORDER_STATUS_LABELS: Record<string, string> = {
  paid: "Pagado",
  processing: "En preparación",
  shipped: "En tránsito",
  delivered: "Entregado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
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

  const dogs = (user.dogs && user.dogs.length > 0
    ? user.dogs
    : user.dogName
      ? [{ name: user.dogName, birthday: null }]
      : []
  ) as { name: string; birthday: string | Date | null }[];

  return data({
    user: {
      name: user.name,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      isAdmin: isStaff(user.role),
      phone: user.phone ?? "",
      address: user.address ?? {},
      dogs: dogs.map((d) => ({ name: d.name, birthday: d.birthday ? new Date(d.birthday).toISOString().slice(0, 10) : "" })),
    },
    loyalty: {
      count: user.loyaltyCycleCount ?? 0,
      required: loyaltyConfig.purchasesRequired,
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
    })),
    subscriptions: subscriptions.map((s) => ({
      id: String(s._id),
      items: s.items as Array<{ sku: string; quantity: number; name: string }>,
      frequency: s.frequency,
      status: s.status,
      currentPeriodEnd: s.currentPeriodEnd,
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

  if (intent === "update-profile") {
    const profileSchema = z.object({
      phone: z.string().trim().max(20),
      addressLine1: z.string().trim().max(200),
      addressLine2: z.string().trim().max(200),
      addressCity: z.string().trim().max(100),
      addressState: z.string().trim().max(100),
      addressPostalCode: z.union([z.literal(""), z.string().trim().regex(/^\d{4,5}$/, "El código postal debe tener 4 o 5 dígitos.")]),
    });
    const parsed = profileSchema.safeParse({
      phone: formData.get("phone"),
      addressLine1: formData.get("addressLine1"),
      addressLine2: formData.get("addressLine2"),
      addressCity: formData.get("addressCity"),
      addressState: formData.get("addressState"),
      addressPostalCode: formData.get("addressPostalCode"),
    });
    if (!parsed.success) {
      return data(
        { ok: false, savedIntent: "update-profile" as const, error: parsed.error.issues[0]?.message ?? "Revisa los datos." },
        { status: 400 },
      );
    }

    const address = {
      line1: parsed.data.addressLine1,
      line2: parsed.data.addressLine2,
      city: parsed.data.addressCity,
      state: parsed.data.addressState,
      postalCode: parsed.data.addressPostalCode,
      country: "MX",
    };
    const dogNames = formData.getAll("mascota") as string[];
    const dogBirthdays = formData.getAll("dogBirthday") as string[];
    const dogs = dogNames
      .map((name, i) => ({ name: name.trim(), birthday: dogBirthdays[i] ? new Date(dogBirthdays[i]) : undefined }))
      .filter((d) => d.name);

    await UserModel.findByIdAndUpdate(userId, { phone: parsed.data.phone, address, dogs });
    return data({ ok: true, savedIntent: "update-profile" as const, error: null as string | null });
  }

  if (intent === "resend-verification") {
    const user = await UserModel.findById(userId);
    if (!user) return data({ ok: false, savedIntent: "resend-verification" as const, error: "No se encontró tu cuenta." }, { status: 404 });
    if (user.emailVerifiedAt) {
      return data({ ok: true, savedIntent: "resend-verification" as const, error: null as string | null });
    }
    const limit = checkRateLimit(`resend-verification:${userId}`, { max: 3, windowMs: 60 * 60 * 1000 });
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
    const passwordLimit = checkRateLimit(`delete-account:${userId}`, { max: 5, windowMs: 15 * 60 * 1000 });
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
  const { user, loyalty, orders, subscriptions, subscriptionProgram } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isBusy = navigation.state !== "idle";
  const isSavingProfile = isBusy && navigation.formData?.get("intent") === "update-profile";
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isResendingVerification = isBusy && navigation.formData?.get("intent") === "resend-verification";
  const resendResult =
    actionData && "savedIntent" in actionData && actionData.savedIntent === "resend-verification" ? actionData : null;
  const isDeletingAccount = isBusy && navigation.formData?.get("intent") === "delete-account";
  const deleteError =
    actionData && "savedIntent" in actionData && actionData.savedIntent === "delete-account"
      ? actionData.error
      : null;
  const [dogRows, setDogRows] = useState(
    user.dogs.length > 0 ? user.dogs : [{ name: "", birthday: "" }],
  );

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar />

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
            Mi cuenta
          </p>
          <h1 className="mt-2 font-display text-3xl font-black text-carbon">
            Hola{user.name ? `, ${user.name}` : ""}
            {user.dogs[0]?.name ? ` y ${user.dogs[0].name}` : ""}
          </h1>
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

          {/* Perfil: teléfono, dirección y perros */}
          <div className="mt-8 rounded-3xl border border-carbon/10 bg-white p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display font-bold text-carbon">Mi perfil</p>
                <p className="mt-1 text-sm text-carbon/60">
                  Teléfono, dirección de envío y tus perros — para tus pedidos y para no perdernos
                  su cumpleaños.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowProfileForm((v) => !v)}
                className="min-h-11 shrink-0 rounded-full border border-carbon/15 px-4 text-sm font-semibold text-carbon hover:border-carbon/30"
              >
                {showProfileForm ? "Cerrar" : "Editar"}
              </button>
            </div>

            {actionData && "savedIntent" in actionData && actionData.savedIntent === "update-profile" && (
              actionData.ok ? (
                <p className="mt-3 text-sm font-semibold text-bosque">Perfil actualizado.</p>
              ) : (
                <p className="mt-3 text-sm font-semibold text-red-600">{actionData.error}</p>
              )
            )}

            {!showProfileForm ? (
              <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <p className="text-carbon/70">
                  <span className="font-semibold text-carbon">Teléfono: </span>
                  {user.phone || "sin registrar"}
                </p>
                <p className="text-carbon/70">
                  <span className="font-semibold text-carbon">Dirección: </span>
                  {user.address?.line1 ? `${user.address.line1}, ${user.address.city ?? ""}` : "sin registrar"}
                </p>
                <p className="text-carbon/70 sm:col-span-2">
                  <span className="font-semibold text-carbon">Perros: </span>
                  {user.dogs.length > 0
                    ? user.dogs.map((d) => (d.birthday ? `${d.name} (cumpleaños ${d.birthday})` : d.name)).join(", ")
                    : "sin registrar"}
                </p>
              </div>
            ) : (
              <Form method="post" className="mt-4 flex flex-col gap-4">
                <input type="hidden" name="intent" value="update-profile" />

                <div>
                  <label htmlFor="phone" className="text-sm font-semibold text-carbon">
                    Teléfono
                  </label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    defaultValue={user.phone}
                    className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
                  />
                </div>

                <div>
                  <p className="text-sm font-semibold text-carbon">Dirección de envío</p>
                  <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      name="addressLine1"
                      placeholder="Calle y número"
                      defaultValue={user.address?.line1}
                      className="min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none sm:col-span-2"
                    />
                    <input
                      name="addressLine2"
                      placeholder="Colonia, interior (opcional)"
                      defaultValue={user.address?.line2}
                      className="min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none sm:col-span-2"
                    />
                    <input
                      name="addressCity"
                      placeholder="Ciudad"
                      defaultValue={user.address?.city}
                      className="min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
                    />
                    <input
                      name="addressState"
                      placeholder="Estado"
                      defaultValue={user.address?.state}
                      className="min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
                    />
                    <input
                      name="addressPostalCode"
                      placeholder="Código postal"
                      defaultValue={user.address?.postalCode}
                      className="min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <p className="text-sm font-semibold text-carbon">Tus perros</p>
                  <div className="mt-1 flex flex-col gap-2">
                    {dogRows.map((dog, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <input
                          name="mascota"
                          autoComplete="off"
                          placeholder="Nombre"
                          defaultValue={dog.name}
                          className="min-h-11 flex-1 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
                        />
                        <input
                          name="dogBirthday"
                          type="date"
                          defaultValue={dog.birthday ?? ""}
                          aria-label="Cumpleaños"
                          className="min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setDogRows((rows) => rows.filter((_, idx) => idx !== i))}
                          aria-label="Quitar perro"
                          className="min-h-11 min-w-11 rounded-full text-carbon/40 hover:text-carbon"
                        >
                          <CloseIcon className="mx-auto block h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDogRows((rows) => [...rows, { name: "", birthday: "" }])}
                    className="mt-2 text-sm font-semibold text-bosque hover:underline"
                  >
                    + Agregar otro perro
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="min-h-11 self-start rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60"
                >
                  {isSavingProfile ? "Guardando…" : "Guardar perfil"}
                </button>
              </Form>
            )}
          </div>

          {/* Fidelidad */}
          <div className="mt-8 rounded-3xl border border-lima/30 bg-bosque/5 p-6">
            <p className="font-display font-bold text-carbon">Programa de fidelidad</p>
            {loyalty.pendingReward ? (
              <p className="mt-1 text-sm text-bosque">
                ¡Ya ganaste{" "}
                {loyalty.pendingReward.rewardType === "gift"
                  ? loyalty.pendingReward.giftDescription
                  : `${loyalty.pendingReward.percentage}% de descuento`}{" "}
                para tu próxima compra! Se aplica automáticamente al pagar.
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm text-carbon/70">
                  Llevas {loyalty.count} de {loyalty.required} compras individuales. Al completar
                  tu {loyalty.required}ª compra, desbloqueas una recompensa para tu siguiente
                  pedido.
                </p>
                <div className="mt-3 flex gap-1.5">
                  {Array.from({ length: loyalty.required }).map((_, i: number) => (
                    <span
                      key={i}
                      className={`h-2 flex-1 rounded-full ${
                        i < loyalty.count ? "bg-lima" : "bg-carbon/10"
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Suscripciones */}
          <div className="mt-10">
            <h2 className="font-display text-xl font-black text-carbon">Mi suscripción</h2>
            {subscriptions.length === 0 ? (
              <p className="mt-2 text-sm text-carbon/60">
                Aún no tienes un auto-envío activo. Actívalo desde{" "}
                <a href="/suscripcion" className="font-semibold text-bosque hover:underline">
                  {subscriptionProgram.name}
                </a>
                .
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-4">
                {subscriptions.map((sub) => (
                  <li
                    key={sub.id}
                    className="rounded-3xl border border-carbon/10 bg-white p-5 sm:p-6"
                  >
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
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Pedidos */}
          <div className="mt-10">
            <h2 className="font-display text-xl font-black text-carbon">Mis pedidos</h2>
            {orders.length === 0 ? (
              <p className="mt-2 text-sm text-carbon/60">Todavía no tienes pedidos.</p>
            ) : (
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
                        {new Date(order.createdAt).toLocaleDateString("es-MX")} ·{" "}
                        {ORDER_STATUS_LABELS[order.status] ?? order.status}
                        {order.shippingCost > 0 && ` · Incluye envío $${order.shippingCost} MXN`}
                      </p>
                    </div>
                    <p className="font-display font-bold text-carbon">${order.netAmount} MXN</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Form method="post" action="/cuenta/salir" className="mt-12">
            <button type="submit" className="text-sm font-semibold text-carbon/50 hover:text-carbon">
              Cerrar sesión
            </button>
          </Form>

          <div className="mt-10 rounded-3xl border border-red-200 bg-red-50/50 p-6">
            <p className="font-display font-bold text-red-900">Eliminar mi cuenta</p>
            <p className="mt-1 text-sm text-red-900/70">
              Se borra tu perfil (datos de contacto, mascotas, dirección) de forma permanente. Tus
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
        </section>
      </main>

      <Footer />
    </div>
  );
}
