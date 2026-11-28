import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { isStaff, isSuperAdmin, ROLE_LABELS, type UserRole } from "~/lib/roles";
import { logAudit } from "~/lib/logger.server";
import { connectDB } from "~/lib/db.server";
import { UserModel } from "~/models/user.server";
import { OrderModel } from "~/models/order.server";
import { SubscriptionModel } from "~/models/subscription.server";
import { AnalyticsEventModel } from "~/models/analyticsEvent.server";
import { getCatalogItems } from "~/lib/catalog.server";
import { ArrowLink } from "~/components/ui/ArrowLink";
import { requireAdmin, requireSuperAdmin } from "~/lib/session.server";
import { allyStationSchema, syncRequestsWithAllyState } from "~/lib/refillPoints.server";
import { AllyRequestModel } from "~/models/allyRequest.server";
import { STATION_CITIES } from "~/lib/refillPoints";
import { Types } from "mongoose";
import { cleanPlainText } from "~/lib/formGuard.server";
import { normalizePhone } from "~/lib/deliveryAddress";
import { applyEmailChange, parseNewEmail } from "~/lib/emailChange.server";

export const meta: MetaFunction = () => [{ title: "Cliente — Admin STOPee" }];

const REVENUE_STATUSES = ["paid", "processing", "shipped", "delivered"];

const EVENT_LABELS: Record<string, string> = {
  page_view: "Visitó el sitio",
  view_item: "Vio un producto",
  add_to_cart: "Agregó al carrito",
  begin_checkout: "Inició el pago",
  banner_click: "Le dio clic al banner",
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  paid: "Pagado",
  processing: "En preparación",
  shipped: "En tránsito",
  delivered: "Entregado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

/**
 * Dos acciones con permisos distintos, y cada una pide el suyo antes de tocar nada:
 *  - cambiar el rol de la cuenta: solo un super administrador, y nunca el de otro super administrador ni el propio.
 *  - activar la cuenta como Punto de Recarga y editar sus datos: cualquier administrador (es operación del negocio, no seguridad).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  // El guardia va antes de leer el formulario: quien no es administrador no llega a nada.
  const admin = await requireAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "set-ally") return saveAllyStation(admin, params.id, formData);

  const viewer = await requireSuperAdmin(request);
  await connectDB();
  if (intent === "change-email") return changeCustomerEmail(viewer, params.id, formData);
  if (intent !== "set-role") return data({ ok: false, savedIntent: null, error: "Acción no reconocida." }, { status: 400 });

  const role = formData.get("role");
  if (role !== "customer" && role !== "admin") {
    return data({ ok: false, savedIntent: "set-role" as const, error: "Elige un rol válido." }, { status: 400 });
  }

  const target = await UserModel.findById(params.id);
  if (!target) return data({ ok: false, savedIntent: "set-role" as const, error: "Cuenta no encontrada." }, { status: 404 });
  if (target.role === "superadmin") {
    return data({ ok: false, savedIntent: "set-role" as const, error: "El rol de un super administrador solo se cambia desde la terminal." }, { status: 403 });
  }
  if (String(target._id) === String(viewer._id)) {
    return data({ ok: false, savedIntent: "set-role" as const, error: "No puedes cambiar tu propio rol." }, { status: 403 });
  }

  if (target.role !== role) {
    const previousRole = target.role;
    target.role = role;
    await target.save();
    logAudit("user.role_changed", { by: String(viewer._id), userId: String(target._id), from: previousRole, to: role });
  }
  return data({ ok: true, savedIntent: "set-role" as const, error: null as string | null });
}

/**
 * Cambiar el correo de un cliente que PERDIÓ el acceso al anterior (si lo conserva, lo cambia él mismo en Mi cuenta).
 * Es la puerta de una toma de cuenta por ingeniería social, así que: solo un super administrador, nunca a una cuenta del
 * equipo, y hay que dejar escrito cómo se comprobó que es la persona. Al correo anterior le llega el «no fui yo» y al
 * nuevo, el enlace para confirmarlo; hasta entonces la cuenta no entra.
 */
async function changeCustomerEmail(viewer: { _id: unknown }, id: string | undefined, formData: FormData) {
  const fail = (error: string, status = 400) => data({ ok: false, savedIntent: "change-email" as const, error }, { status });
  if (!id || !Types.ObjectId.isValid(id)) return fail("Cuenta no encontrada.", 404);
  const newEmail = parseNewEmail(formData.get("newEmail"));
  if (!newEmail) return fail("Escribe un correo válido.");
  const proof = cleanPlainText(formData.get("proof")).slice(0, 300);
  if (proof.length < 10) return fail("Anota cómo comprobaste que es la persona (por ejemplo: número de pedido y dirección de entrega que coinciden).");

  await connectDB();
  const target = await UserModel.findById(id).select("role email");
  if (!target) return fail("Cuenta no encontrada.", 404);
  if (isStaff(target.role)) return fail("El correo de una cuenta del equipo no se cambia desde aquí.", 403);

  const result = await applyEmailChange(id, newEmail, { byStaffId: String((viewer as { _id: unknown })._id) });
  if (!result.ok) return fail(result.error);
  logAudit("user.email_changed_by_staff", { by: String((viewer as { _id: unknown })._id), userId: id, proof });
  return data({ ok: true, savedIntent: "change-email" as const, error: null as string | null });
}

/** Activa o desactiva a una cuenta como Punto de Recarga y guarda los datos de su punto. */
async function saveAllyStation(viewer: { _id: unknown }, id: string | undefined, formData: FormData) {
  const fail = (error: string, status = 400) => data({ ok: false, savedIntent: "set-ally" as const, error }, { status });
  if (!id || !Types.ObjectId.isValid(id)) return fail("Cuenta no encontrada.", 404);

  const isRefillAlly = formData.get("isRefillAlly") === "on";
  const parsed = allyStationSchema.safeParse({
    businessName: cleanPlainText(formData.get("businessName")),
    neighborhood: cleanPlainText(formData.get("neighborhood")),
    city: String(formData.get("city") ?? "CDMX"),
    address: cleanPlainText(formData.get("address")),
    schedule: cleanPlainText(formData.get("schedule")),
    whatsapp: cleanPlainText(formData.get("whatsapp")),
    mapsUrl: String(formData.get("mapsUrl") ?? "").trim(),
    // Solo un aliado activo puede estar en el directorio.
    isPublic: isRefillAlly && formData.get("isPublic") === "on",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Revisa los datos del punto.");
  if (isRefillAlly && !parsed.data.businessName) return fail("Escribe el nombre del punto para activarlo.");

  await connectDB();
  const station = { ...parsed.data, whatsapp: parsed.data.whatsapp ? (normalizePhone(parsed.data.whatsapp) ?? "") : "" };
  const target = await UserModel.findOneAndUpdate({ _id: id }, { $set: { isRefillAlly, allyStation: station } }, { new: true }).select("email");
  if (!target) return fail("Cuenta no encontrada.", 404);

  // La solicitud de este correo se pone de acuerdo con lo que se acaba de guardar (aprobada si es aliado;
  // pendiente si se desactivó), para que la pantalla de solicitudes y esta ficha no se contradigan.
  const requestSync = await syncRequestsWithAllyState(target.email, isRefillAlly, id);

  logAudit("user.refill_ally_changed", {
    by: String((viewer as { _id: unknown })._id),
    userId: id,
    isRefillAlly,
    isPublic: station.isPublic,
  });
  return data({ ok: true, savedIntent: "set-ally" as const, error: null as string | null, requestSync });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireAdmin(request);
  await connectDB();
  const user = await UserModel.findById(params.id).lean();
  if (!user) throw new Response("Cliente no encontrado", { status: 404 });

  const [orders, subscriptions, events, catalogItems] = await Promise.all([
    OrderModel.find({ user: user._id }).sort({ createdAt: -1 }).lean(),
    SubscriptionModel.find({ user: user._id }).sort({ createdAt: -1 }).lean(),
    AnalyticsEventModel.find({ userId: user._id }).sort({ createdAt: -1 }).limit(60).lean(),
    getCatalogItems({ includeUnavailable: true }),
  ]);
  const catalogNameBySku = new Map(catalogItems.map((item) => [item.sku, item.name]));

  const revenueOrders = orders.filter((o) => REVENUE_STATUSES.includes(o.status));
  const oneTimeOrders = revenueOrders.filter((o) => o.type === "one_time");
  const hasActiveSubscription = subscriptions.some((s) => s.status === "active" || s.status === "past_due");
  // Compra seguido pero nunca se metió al auto-envío — pierde el descuento de
  // suscripción en cada pedido. Es exactamente el caso que vale la pena
  // ofrecerle el auto-envío de forma proactiva.
  const isSubscriptionCandidate = oneTimeOrders.length >= 2 && !hasActiveSubscription;

  const hasOrdered = revenueOrders.length > 0;
  const hasBeginCheckout = events.some((e) => e.type === "begin_checkout");
  const hasAddToCart = events.some((e) => e.type === "add_to_cart");
  const hasViewItem = events.some((e) => e.type === "view_item");
  const funnelStage = hasOrdered
    ? "Compró"
    : hasBeginCheckout
      ? "Inició el pago, pero no completó la compra"
      : hasAddToCart
        ? "Agregó productos al carrito, pero no pagó"
        : hasViewItem
          ? "Vio productos, sin agregar al carrito"
          : "Solo entró al sitio";

  return data({
    profile: {
      id: String(user._id),
      email: user.email,
      name: user.name ?? "",
      phone: user.phone ?? "",
      address: user.address ?? null,
      dogs: (user.dogs ?? []).map((d) => ({ name: d.name, birthday: d.birthday as unknown as string | null })),
      registeredAt: user.createdAt,
      role: user.role as UserRole,
    },
    allyRequestStatus: ((await AllyRequestModel.findOne({ email: user.email }).sort({ createdAt: -1 }).select("status").lean())?.status ??
      null) as "pending" | "approved" | "rejected" | null,
    ally: {
      isRefillAlly: Boolean(user.isRefillAlly),
      businessName: user.allyStation?.businessName ?? "",
      neighborhood: user.allyStation?.neighborhood ?? "",
      city: user.allyStation?.city || "CDMX",
      address: user.allyStation?.address ?? "",
      schedule: user.allyStation?.schedule ?? "",
      whatsapp: user.allyStation?.whatsapp ?? "",
      mapsUrl: user.allyStation?.mapsUrl ?? "",
      isPublic: Boolean(user.allyStation?.isPublic),
    },
    canManageRole: isSuperAdmin(viewer.role) && user.role !== "superadmin" && String(user._id) !== String(viewer._id),
    // El correo de una cuenta del equipo no se cambia desde aquí (ver changeCustomerEmail).
    canChangeEmail: isSuperAdmin(viewer.role) && !isStaff(user.role),
    insights: {
      ltv: Math.round(user.totalSpentLTV ?? 0),
      orderCount: revenueOrders.length,
      loyaltyCycleCount: user.loyaltyCycleCount ?? 0,
      loyaltyPendingReward: user.loyaltyPendingReward
        ? {
            rewardType: user.loyaltyPendingReward.rewardType,
            percentage: user.loyaltyPendingReward.percentage ?? null,
            giftDescription: user.loyaltyPendingReward.giftDescription ?? null,
          }
        : null,
      isSubscriptionCandidate,
      funnelStage,
    },
    orders: orders.map((o) => ({
      id: String(o._id),
      items: o.items as { sku: string; name: string; quantity: number; unitPriceMxn: number }[],
      netAmount: o.netAmount,
      status: o.status,
      type: o.type,
      promotionName: o.promotion?.name ?? null,
      createdAt: o.createdAt,
    })),
    subscriptions: subscriptions.map((s) => ({
      id: String(s._id),
      frequency: s.frequency,
      status: s.status,
      discountPercent: s.discountPercent,
      totalOrdersGenerated: s.totalOrdersGenerated,
      nextDeliveryDate: s.nextDeliveryDate,
    })),
    timeline: events.map((e) => ({
      type: e.type,
      label: EVENT_LABELS[e.type] ?? e.type,
      productName: e.sku ? catalogNameBySku.get(e.sku) ?? e.sku : null,
      at: e.createdAt,
    })),
  });
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`min-w-0 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-5 ${className}`}>{children}</div>;
}

export default function AdminCustomerDetail() {
  const { profile, ally, allyRequestStatus, canManageRole, canChangeEmail, insights, orders, subscriptions, timeline } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSavingRole = navigation.state !== "idle" && navigation.formData?.get("intent") === "set-role";
  const isSavingAlly = navigation.state !== "idle" && navigation.formData?.get("intent") === "set-ally";
  const roleResult = actionData && actionData.savedIntent === "set-role" ? actionData : null;
  const allyResult = actionData && actionData.savedIntent === "set-ally" ? actionData : null;
  const emailResult = actionData && actionData.savedIntent === "change-email" ? actionData : null;
  const isChangingEmail = navigation.state !== "idle" && navigation.formData?.get("intent") === "change-email";

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="min-w-0">
        <ArrowLink to="/admin/customers" direction="left" className="text-sm">Volver a clientes</ArrowLink>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-all font-display text-2xl font-black text-carbon sm:text-3xl">{profile.name || profile.email}</h1>
          {isStaff(profile.role) && (
            <span className="rounded-full bg-carbon/10 px-2.5 py-1 text-xs font-semibold text-carbon/60">{ROLE_LABELS[profile.role]}</span>
          )}
        </div>
        <p className="mt-1 break-all text-sm text-carbon/60 sm:break-words">
          {profile.email} · Registrado el {new Date(profile.registeredAt).toLocaleDateString("es-MX")}
        </p>
      </div>

      {canManageRole && (
        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Rol de la cuenta</h2>
          <p className="mt-1 text-sm text-carbon/60">
            Un administrador entra al panel y gestiona catálogo, pedidos y promociones; no puede crear cuentas ni cambiar roles.
            Si lo bajas a cliente, pierde el acceso al panel de inmediato.
          </p>
          <Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="set-role" />
            <div>
              <label htmlFor="role" className="text-sm font-semibold text-carbon">Rol</label>
              <select
                id="role"
                name="role"
                defaultValue={profile.role}
                className="mt-1 block min-h-11 rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none"
              >
                <option value="customer">{ROLE_LABELS.customer}</option>
                <option value="admin">{ROLE_LABELS.admin}</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={isSavingRole}
              className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60"
            >
              {isSavingRole ? "Guardando…" : "Guardar rol"}
            </button>
          </Form>
          {roleResult?.ok && <p role="status" className="mt-2 text-sm font-semibold text-bosque">Rol actualizado.</p>}
          {roleResult && !roleResult.ok && roleResult.error && (
            <p role="alert" className="mt-2 text-sm font-semibold text-red-600">{roleResult.error}</p>
          )}
        </Card>
      )}

      {canChangeEmail && (
        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Cambiar el correo de esta cuenta</h2>
          <p className="mt-1 text-sm text-carbon/60">
            Solo para quien <strong>ya no tiene acceso</strong> a su correo (si lo tiene, lo cambia él mismo en Mi cuenta, con su contraseña).
            Nunca lo cambies solo porque lo pidan: compara lo que te digan con esta ficha (pedidos, direcciones, qué compró y cuándo) y anota cómo lo
            comprobaste. Al correo anterior le llega un aviso para deshacerlo y la persona confirma el nuevo con un enlace.
          </p>
          <Form method="post" className="mt-3 flex max-w-lg flex-col gap-3">
            <input type="hidden" name="intent" value="change-email" />
            <div>
              <label htmlFor="newEmail" className="text-sm font-semibold text-carbon">Correo nuevo</label>
              <input id="newEmail" name="newEmail" type="email" required autoComplete="off" className="mt-1 block min-h-11 w-full rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none" />
            </div>
            <div>
              <label htmlFor="proof" className="text-sm font-semibold text-carbon">¿Cómo comprobaste que es la persona?</label>
              <textarea id="proof" name="proof" required minLength={10} maxLength={300} rows={2} className="mt-1 block w-full rounded-xl border border-carbon/15 px-3 py-2 focus:border-oliva focus:outline-none" />
            </div>
            <button type="submit" disabled={isChangingEmail} className="min-h-11 self-start rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60">
              {isChangingEmail ? "Cambiando…" : "Cambiar correo"}
            </button>
          </Form>
          {emailResult?.ok && <p role="status" className="mt-2 text-sm font-semibold text-bosque">Listo. Avisamos al correo anterior y mandamos el enlace de confirmación al nuevo.</p>}
          {emailResult && !emailResult.ok && emailResult.error && <p role="alert" className="mt-2 text-sm font-semibold text-red-600">{emailResult.error}</p>}
        </Card>
      )}

      <Card>
        <h2 className="font-display text-lg font-bold text-carbon">Punto de Recarga</h2>
        {allyRequestStatus && (
          <p className="mt-1 text-sm text-carbon/70">
            Solicitud de este correo:{" "}
            <strong>{{ pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada" }[allyRequestStatus]}</strong>.{" "}
            <a href="/admin/aliados" className="font-semibold text-bosque underline">Ver solicitudes</a>. Lo que cambies aquí se refleja
            en la solicitud, y al revés.
          </p>
        )}
        <p className="mt-1 text-sm text-carbon/60">
          Actívalo cuando esta cuenta ya sea un aliado que recarga bidones. Aparece en el directorio público de
          /puntos-de-recarga solo si marcas «Publicar», y eso solo se hace con la autorización del aliado.
        </p>
        <Form method="post" className="mt-4 flex flex-col gap-4">
          <input type="hidden" name="intent" value="set-ally" />
          <label htmlFor="isRefillAlly" className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-carbon">
            <input id="isRefillAlly" name="isRefillAlly" type="checkbox" defaultChecked={ally.isRefillAlly} className="h-5 w-5 accent-bosque" />
            Esta cuenta es un Punto de Recarga
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="businessName" className="text-sm font-semibold text-carbon">Nombre del punto</label>
              <input id="businessName" name="businessName" defaultValue={ally.businessName} maxLength={80} placeholder="Veterinaria San Ángel" className="mt-1 block min-h-11 w-full rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none" />
            </div>
            <div>
              <label htmlFor="neighborhood" className="text-sm font-semibold text-carbon">Colonia</label>
              <input id="neighborhood" name="neighborhood" defaultValue={ally.neighborhood} maxLength={80} className="mt-1 block min-h-11 w-full rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none" />
            </div>
            <div>
              <label htmlFor="city" className="text-sm font-semibold text-carbon">Zona</label>
              <select id="city" name="city" defaultValue={ally.city} className="mt-1 block min-h-11 w-full rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none">
                {STATION_CITIES.map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="whatsapp" className="text-sm font-semibold text-carbon">WhatsApp del punto</label>
              <input id="whatsapp" name="whatsapp" type="tel" inputMode="tel" defaultValue={ally.whatsapp} maxLength={20} className="mt-1 block min-h-11 w-full rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="address" className="text-sm font-semibold text-carbon">Dirección pública o referencia</label>
              <input id="address" name="address" defaultValue={ally.address} maxLength={160} className="mt-1 block min-h-11 w-full rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="mapsUrl" className="text-sm font-semibold text-carbon">Enlace de Google Maps (opcional)</label>
              <input id="mapsUrl" name="mapsUrl" type="url" inputMode="url" defaultValue={ally.mapsUrl} maxLength={500} placeholder="https://maps.app.goo.gl/…" className="mt-1 block min-h-11 w-full rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none" />
              <p className="mt-1 text-xs text-carbon/60">
                En Google Maps: busca el lugar, pulsa «Compartir» y copia el enlace. Sin enlace, el botón «Abrir mapa» busca la dirección en Maps.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="schedule" className="text-sm font-semibold text-carbon">Horario de recarga</label>
              <input id="schedule" name="schedule" defaultValue={ally.schedule} maxLength={120} placeholder="Lunes a sábado, 10:00 a 18:00" className="mt-1 block min-h-11 w-full rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none" />
            </div>
          </div>

          <label htmlFor="isPublic" className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-carbon">
            <input id="isPublic" name="isPublic" type="checkbox" defaultChecked={ally.isPublic} className="mt-1 h-5 w-5 shrink-0 accent-bosque" />
            <span>
              <span className="font-semibold">Publicar en el directorio</span>
              <span className="block text-carbon/60">
                Muestra nombre, colonia, dirección, horario y WhatsApp a cualquier visitante. Requiere todos esos datos y
                que el aliado lo haya autorizado.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isSavingAlly}
              className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60"
            >
              {isSavingAlly ? "Guardando…" : "Guardar punto de recarga"}
            </button>
            {allyResult?.ok && (
              <p role="status" className="text-sm font-semibold text-bosque">
                Punto de recarga guardado.
                {"requestSync" in allyResult && allyResult.requestSync === "approved" && " Su solicitud quedó como Aprobada."}
                {"requestSync" in allyResult && allyResult.requestSync === "pending" && " Su solicitud volvió a Pendiente."}
              </p>
            )}
            {allyResult && !allyResult.ok && allyResult.error && (
              <p role="alert" className="text-sm font-semibold text-red-600">{allyResult.error}</p>
            )}
          </div>
        </Form>
      </Card>

      {insights.isSubscriptionCandidate && (
        <Card className="border-oliva/40 bg-oliva/5">
          <p className="font-display font-bold text-carbon">Candidato a suscripción</p>
          <p className="mt-1 text-sm text-carbon/70">
            Ya hizo {insights.orderCount} compras individuales pero no tiene una suscripción activa —
            cada vez que recompra a mano, se pierde el descuento de suscripción. Buen momento para
            ofrecérselo.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">LTV</p>
          <p className="mt-2 font-display text-2xl font-black text-bosque">${insights.ltv.toLocaleString("es-MX")}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Pedidos</p>
          <p className="mt-2 font-display text-2xl font-black text-carbon">{insights.orderCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Lealtad</p>
          <p className="mt-2 text-sm font-semibold text-carbon">
            {insights.loyaltyPendingReward
              ? `${insights.loyaltyPendingReward.rewardType === "gift" ? insights.loyaltyPendingReward.giftDescription : `${insights.loyaltyPendingReward.percentage}% listo`}`
              : `${insights.loyaltyCycleCount} compras en su ciclo actual`}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Llegó hasta</p>
          <p className="mt-2 text-sm font-semibold text-carbon">{insights.funnelStage}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Datos de contacto</h2>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="shrink-0 text-carbon/50">Teléfono</dt>
              <dd className="min-w-0 break-words text-right text-carbon/70">{profile.phone || "sin registrar"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="shrink-0 text-carbon/50">Dirección</dt>
              <dd className="min-w-0 break-words text-right text-carbon/70">
                {profile.address?.line1
                  ? `${profile.address.line1}${profile.address.line2 ? `, ${profile.address.line2}` : ""}, ${profile.address.city ?? ""}, ${profile.address.state ?? ""} ${profile.address.postalCode ?? ""}`
                  : "sin registrar"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-carbon/50">Perros</p>
          {profile.dogs.length === 0 ? (
            <p className="mt-1 text-sm text-carbon/60">Sin registrar.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1 text-sm text-carbon/70">
              {profile.dogs.map((d, i) => (
                <li key={i}>
                  {d.name}
                  {d.birthday && ` — cumpleaños ${new Date(d.birthday).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}`}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="font-display text-lg font-bold text-carbon">Suscripción</h2>
          {subscriptions.length === 0 ? (
            <p className="mt-2 text-sm text-carbon/60">Nunca se ha suscrito.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-3">
              {subscriptions.map((s) => (
                <li key={s.id} className="rounded-xl border border-carbon/10 p-3 text-sm">
                  <p className="font-semibold text-carbon">
                    {s.frequency} · {s.status === "active" ? "Activa" : s.status === "paused" ? "Pausada" : s.status === "past_due" ? "Pago pendiente" : "Cancelada"}
                  </p>
                  <p className="mt-1 text-carbon/60">
                    {s.discountPercent}% de descuento · {s.totalOrdersGenerated} envíos generados
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="font-display text-lg font-bold text-carbon">Historial de pedidos</h2>
        {orders.length === 0 ? (
          <p className="mt-3 text-sm text-carbon/60">Todavía no ha comprado.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-carbon/50">
                  <th className="pb-2">Fecha</th>
                  <th className="pb-2">Artículos</th>
                  <th className="pb-2">Promoción</th>
                  <th className="pb-2">Estado</th>
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-carbon/5">
                    <td className="py-2.5 text-carbon/60">{new Date(o.createdAt).toLocaleDateString("es-MX")}</td>
                    <td className="py-2.5 text-carbon/70">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</td>
                    <td className="py-2.5 text-carbon/60">{o.promotionName || "—"}</td>
                    <td className="py-2.5 text-carbon/60">{ORDER_STATUS_LABELS[o.status] ?? o.status}</td>
                    <td className="py-2.5 text-right font-semibold text-carbon">${o.netAmount.toLocaleString("es-MX")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-display text-lg font-bold text-carbon">Comportamiento reciente</h2>
        <p className="mt-1 text-sm text-carbon/60">
          Solo se registran eventos ocurridos con sesión iniciada.
        </p>
        {timeline.length === 0 ? (
          <p className="mt-3 text-sm text-carbon/60">Sin actividad registrada todavía.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {timeline.map((e, i) => (
              <li key={i} className="flex flex-col gap-0.5 border-t border-carbon/5 pt-2 text-sm first:border-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="min-w-0 break-words text-carbon/70">
                  {e.label}
                  {e.productName && `: ${e.productName}`}
                </span>
                <span className="shrink-0 text-xs text-carbon/40">
                  {new Date(e.at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
