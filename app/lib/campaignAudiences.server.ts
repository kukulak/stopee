import { connectDB } from "~/lib/db.server";
import { UserModel } from "~/models/user.server";
import { OrderModel } from "~/models/order.server";
import { LeadModel } from "~/models/lead.server";
import { SubscriptionModel } from "~/models/subscription.server";
import { AnalyticsEventModel } from "~/models/analyticsEvent.server";
import type { AudienceKey } from "~/lib/campaignAudiences";

/**
 * Las listas de personas para campañas de correo. REGLA: solo sale quien aceptó recibir promociones
 * (`marketingOptInAt` en su cuenta o en la lista de espera) y, si tiene cuenta, ya confirmó su correo.
 * Quien no aceptó se cuenta aparte, para que se vea cuántos hay, pero nunca entra a la lista.
 */
const REVENUE_STATUSES = ["paid", "processing", "shipped", "delivered"];
const ABANDONED_LOOKBACK_DAYS = 14;

export type CampaignPerson = {
  email: string;
  name: string;
  origin: "Cuenta" | "Lista de espera" | "Compra sin cuenta";
  registeredAt: Date | null;
  orders: number;
  lastOrderAt: Date | null;
  totalSpent: number;
  optInAt: Date | null;
};

type Candidate = Omit<CampaignPerson, "optInAt"> & { optInAt: Date | null; verified: boolean };

/** Quién cumple la lista y quiénes se dejaron fuera por no haber aceptado (o no haber confirmado su correo). */
export async function buildAudience(audience: AudienceKey): Promise<{ people: CampaignPerson[]; excluded: number }> {
  await connectDB();

  const [users, leads, byUser, byGuestEmail] = await Promise.all([
    UserModel.find({ role: "customer" }).select("email name createdAt emailVerifiedAt marketingOptInAt").lean(),
    LeadModel.find().select("email registeredAt marketingOptInAt").lean(),
    OrderModel.aggregate<{ _id: unknown; orders: number; totalSpent: number; lastOrderAt: Date }>([
      { $match: { status: { $in: REVENUE_STATUSES }, user: { $ne: null } } },
      { $group: { _id: "$user", orders: { $sum: 1 }, totalSpent: { $sum: "$netAmount" }, lastOrderAt: { $max: "$createdAt" } } },
    ]),
    // Compras sin cuenta con correo real (las ventas registradas a mano casi nunca lo tienen).
    OrderModel.aggregate<{ _id: string; orders: number; totalSpent: number; lastOrderAt: Date }>([
      { $match: { status: { $in: REVENUE_STATUSES }, user: null, source: { $ne: "manual" }, email: { $nin: ["", "desconocido@stopee.com.mx"] } } },
      { $group: { _id: { $toLower: "$email" }, orders: { $sum: 1 }, totalSpent: { $sum: "$netAmount" }, lastOrderAt: { $max: "$createdAt" } } },
    ]),
  ]);

  const userStats = new Map(byUser.map((r) => [String(r._id), r]));
  const guestStats = new Map(byGuestEmail.map((r) => [r._id, r]));
  const leadByEmail = new Map(leads.map((l) => [l.email.toLowerCase(), l]));
  const userEmails = new Set(users.map((u) => u.email.toLowerCase()));

  // Con el mismo correo, un permiso dado en la lista de espera también vale para la cuenta (y al revés).
  const optInFor = (email: string, own: Date | null | undefined) => own ?? leadByEmail.get(email)?.marketingOptInAt ?? null;

  const everyone: Candidate[] = [];
  for (const u of users) {
    const email = u.email.toLowerCase();
    const stats = userStats.get(String(u._id)) ?? guestStats.get(email);
    everyone.push({
      email,
      name: u.name ?? "",
      origin: "Cuenta",
      registeredAt: u.createdAt ?? null,
      orders: stats?.orders ?? 0,
      lastOrderAt: stats?.lastOrderAt ?? null,
      totalSpent: Math.round((stats?.totalSpent ?? 0) * 100) / 100,
      optInAt: optInFor(email, u.marketingOptInAt),
      verified: Boolean(u.emailVerifiedAt),
    });
  }
  for (const l of leads) {
    const email = l.email.toLowerCase();
    if (userEmails.has(email)) continue;
    const stats = guestStats.get(email);
    everyone.push({
      email,
      name: "",
      origin: "Lista de espera",
      registeredAt: l.registeredAt ?? null,
      orders: stats?.orders ?? 0,
      lastOrderAt: stats?.lastOrderAt ?? null,
      totalSpent: Math.round((stats?.totalSpent ?? 0) * 100) / 100,
      optInAt: l.marketingOptInAt ?? null,
      // Sin cuenta no hay correo por confirmar: el permiso lo dio al apuntarse o al pagar con su tarjeta.
      verified: true,
    });
  }
  // Compradores sin cuenta que no están en la lista de espera: no aceptaron nada, pero se cuentan como «sin permiso».
  for (const [email, stats] of guestStats) {
    if (userEmails.has(email) || leadByEmail.has(email)) continue;
    everyone.push({
      email,
      name: "",
      origin: "Compra sin cuenta",
      registeredAt: null,
      orders: stats.orders,
      lastOrderAt: stats.lastOrderAt,
      totalSpent: Math.round(stats.totalSpent * 100) / 100,
      optInAt: null,
      verified: true,
    });
  }

  let inAudience: (c: Candidate) => boolean;
  if (audience === "compraron") inAudience = (c) => c.orders > 0;
  else if (audience === "sin-compra") inAudience = (c) => c.orders === 0;
  else {
    const emails = await emailsForSubscriptionOrCart(audience, users, userEmails);
    inAudience = (c) => emails.has(c.email);
  }

  const members = everyone.filter(inAudience);
  const people = members
    .filter((c) => c.verified && c.optInAt)
    .map(({ verified: _verified, ...person }) => person as CampaignPerson)
    .sort((a, b) => a.email.localeCompare(b.email));
  return { people, excluded: members.length - people.length };
}

async function emailsForSubscriptionOrCart(
  audience: "carrito" | "auto-envio",
  users: { _id: unknown; email: string }[],
  _userEmails: Set<string>,
): Promise<Set<string>> {
  const emailByUserId = new Map(users.map((u) => [String(u._id), u.email.toLowerCase()]));

  if (audience === "auto-envio") {
    const active = await SubscriptionModel.distinct("user", { status: "active" });
    return new Set(active.map((id) => emailByUserId.get(String(id))).filter((e): e is string => Boolean(e)));
  }

  // Dejaron el carrito: iniciaron el pago con sesión abierta y no hubo un pedido después (mismo criterio que la pantalla de Clientes).
  const lookback = new Date(Date.now() - ABANDONED_LOOKBACK_DAYS * 86400000);
  const attempts = await AnalyticsEventModel.aggregate<{ _id: unknown; lastAttemptAt: Date }>([
    { $match: { type: "begin_checkout", userId: { $ne: null }, createdAt: { $gte: lookback } } },
    { $group: { _id: "$userId", lastAttemptAt: { $max: "$createdAt" } } },
  ]);
  const orders = attempts.length
    ? await OrderModel.find({ user: { $in: attempts.map((a) => a._id) } }).select("user createdAt").lean()
    : [];
  const lastOrder = new Map<string, number>();
  for (const o of orders) {
    const key = String(o.user);
    const t = new Date(o.createdAt as unknown as string).getTime();
    if (!lastOrder.has(key) || t > lastOrder.get(key)!) lastOrder.set(key, t);
  }
  const emails = new Set<string>();
  for (const a of attempts) {
    const last = lastOrder.get(String(a._id));
    const email = emailByUserId.get(String(a._id));
    if (email && (!last || last < new Date(a.lastAttemptAt).getTime())) emails.add(email);
  }
  return emails;
}
