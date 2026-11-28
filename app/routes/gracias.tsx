import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { ArrowIcon, CheckIcon } from "~/components/ui/Icons";
import { clearCart, getCart } from "~/lib/cart.server";
import { connectDB } from "~/lib/db.server";
import { logError } from "~/lib/logger.server";
import { maskEmail } from "~/lib/maskEmail";
import { checkRateLimit, getClientIp } from "~/lib/rateLimit.server";
import { getUser } from "~/lib/session.server";
import { stripe } from "~/lib/stripe.server";
import { frequencyLabel } from "~/lib/subscriptionConfig";
import { OrderModel } from "~/models/order.server";
import { getInvoiceRequestEmail } from "~/models/legalSettings.server";
import { invoiceLaterNote, orderNumber as toOrderNumber } from "~/lib/fiscal";
import { SubscriptionModel } from "~/models/subscription.server";

export const meta: MetaFunction = () => [{ title: "Gracias por tu compra — STOPee" }, { name: "robots", content: "noindex" }];

/** Los ids de sesión de Stripe son largos e imposibles de adivinar; solo se aceptan con su forma real. */
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

type Item = { name: string; quantity: number };

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id") ?? "";
  const kind = url.searchParams.get("tipo") === "suscripcion" ? "suscripcion" : "compra";
  if (!SESSION_ID.test(sessionId)) return redirect("/tienda");

  // Esta página no pide sesión (quien compra sin cuenta también llega aquí), así que
  // se limita para que no sirva de atajo a Stripe.
  const limit = await checkRateLimit(`gracias:${getClientIp(request)}`, { max: 60, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) return redirect("/tienda");

  // Stripe confirma que el pago existe y se completó: sin esto, cualquier id con la forma
  // correcta mostraría un "pedido confirmado".
  let confirmed = false;
  let awaitingPayment = false;
  let stripeSubscriptionId: string | null = null;
  let stripeEmail = "";
  try {
    // Tope corto: si Stripe tarda, la página sigue en vez de dejar esperando a quien acaba de pagar.
    const session = await stripe.checkout.sessions.retrieve(sessionId, {}, { timeout: 6000, maxNetworkRetries: 0 });
    if (session.status !== "complete") return redirect("/tienda");
    // Pagos diferidos (ficha de OXXO, transferencia SPEI): la sesión queda "complete" cuando el cliente
    // genera la ficha, pero el dinero aún no llega. No es un "gracias": es "falta pagar".
    awaitingPayment = session.mode === "payment" && session.payment_status === "unpaid";
    confirmed = !awaitingPayment;
    stripeEmail = session.customer_details?.email ?? session.customer_email ?? "";
    stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null);
  } catch (error) {
    // Solo "ese pago no existe" manda a la tienda. Si Stripe no respondió (red, lentitud), la persona
    // pudo haber pagado de verdad: se muestra "confirmando" y la página reintenta sola.
    const missing = (error as { code?: string }).code === "resource_missing";
    if (missing) return redirect("/tienda");
    logError("gracias.retrieve-session", error);
  }

  await connectDB();
  const [user, cartBefore] = await Promise.all([getUser(request), getCart(request)]);

  let items: Item[] | null = null;
  let total: number | null = null;
  let frequency: string | null = null;
  let email = stripeEmail;
  let orderNum: string | null = null;
  let invoiceRequested = false;

  if (kind === "suscripcion") {
    const subscription = stripeSubscriptionId
      ? await SubscriptionModel.findOne({ stripeSubscriptionId }).lean()
      : null;
    if (subscription) {
      items = subscription.items.map((i) => ({ name: i.name, quantity: i.quantity }));
      frequency = frequencyLabel(subscription.frequency).toLowerCase();
    }
  } else {
    const order = await OrderModel.findOne({ stripeCheckoutSessionId: sessionId }).lean();
    if (order) {
      confirmed = true; // el pedido ya está registrado: el pago existe aunque Stripe no haya respondido
      items = (order.items as Item[]).map((i) => ({ name: i.name, quantity: i.quantity }));
      total = order.netAmount;
      email = order.email || email;
      orderNum = toOrderNumber(order._id);
      invoiceRequested = Boolean(order.requiresInvoice);
    }
  }

  // El pago ya se cobró: el carrito deja de tener sentido. Sin esto, quien regresa a la tienda ve sus
  // productos todavía ahí y puede pagar el mismo pedido dos veces.
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  const paidPurchase = kind === "compra" && confirmed && !awaitingPayment;
  if (paidPurchase) headers.append("Set-Cookie", await clearCart(request));
  const cartCount = paidPurchase ? 0 : cartBefore.reduce((sum, item) => sum + item.quantity, 0);

  return data(
    {
      kind,
      confirmed,
      awaitingPayment,
      items,
      total,
      frequency,
      maskedEmail: maskEmail(email),
      signedIn: Boolean(user),
      cartCount,
      orderNumber: orderNum,
      invoiceRequested,
      invoiceNote: paidPurchase && !invoiceRequested ? invoiceLaterNote(await getInvoiceRequestEmail()) : null,
    },
    { headers },
  );
}

export default function Gracias() {
  const { kind, confirmed, awaitingPayment, items, total, frequency, maskedEmail, signedIn, cartCount, orderNumber, invoiceRequested, invoiceNote } =
    useLoaderData<typeof loader>();
  const isSubscription = kind === "suscripcion";

  // Stripe avisa al servidor (webhook) en paralelo a que el cliente regresa: si el pedido
  // todavía no está registrado, se vuelve a preguntar unos segundos en vez de dejar un hueco.
  const revalidator = useRevalidator();
  const tries = useRef(0);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    // Una ficha de OXXO o una transferencia puede tardar horas: no tiene caso preguntar cada pocos segundos.
    if (awaitingPayment || (confirmed && items)) return;
    const id = setInterval(() => {
      tries.current += 1;
      if (tries.current > 8) {
        clearInterval(id);
        setGaveUp(true);
        return;
      }
      revalidator.revalidate();
    }, 2500);
    return () => clearInterval(id);
  }, [awaitingPayment, confirmed, items, revalidator]);

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      <Navbar cartCount={cartCount} />
      <main className="flex-1">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-lima text-carbon" aria-hidden="true">
            {confirmed ? (
              <CheckIcon className="h-7 w-7" />
            ) : (
              // Reloj: todavía no hay pago confirmado, así que no se muestra la palomita.
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            )}
          </div>
          <h1 className="mt-6 font-display text-3xl font-black text-carbon sm:text-4xl">
            {awaitingPayment
              ? "Falta completar tu pago"
              : !confirmed
                ? "Estamos confirmando tu pago"
                : isSubscription
                  ? "Tu suscripción ya está activa"
                  : "¡Gracias por tu compra!"}
          </h1>
          <p className="mt-3 text-carbon/70">
            {awaitingPayment
              ? "Generaste tu ficha de pago, pero todavía no recibimos el dinero. Págala antes de que venza; en cuanto llegue, tu pedido queda registrado."
              : !confirmed
                ? "Tarda unos segundos. No cierres esta página ni vuelvas a pagar: si ya te cobraron, tu pedido queda registrado."
                : isSubscription
                ? "Tu pago se procesó correctamente y tu caja ya quedó programada."
                : "Tu pago se procesó correctamente."}
          </p>

          <section aria-live="polite" className="mt-8 rounded-3xl border-2 border-lima bg-lima/10 p-6">
            {items ? (
              <>
                <h2 className="font-display text-lg font-black text-carbon">{isSubscription ? "Tu caja" : "Tu pedido"}</h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {items.map((item) => (
                    <li key={item.name} className="flex items-center gap-2 text-carbon">
                      <CheckIcon className="h-4 w-4 shrink-0 text-bosque" />
                      {item.quantity}× {item.name}
                    </li>
                  ))}
                </ul>
                {total !== null && (
                  <p className="mt-4 border-t border-carbon/10 pt-4 text-carbon/70">
                    Total pagado: <span className="font-semibold text-carbon">${total} MXN</span> (IVA incluido)
                    {orderNumber && (
                      <>
                        <br />
                        Número de pedido: <span className="font-semibold text-carbon">{orderNumber}</span>
                      </>
                    )}
                  </p>
                )}
                {invoiceRequested && (
                  <p className="mt-3 text-sm text-carbon/70">
                    Registramos tu solicitud de factura. La emitiremos con los datos que capturaste y te la enviaremos por correo.
                  </p>
                )}
                {invoiceNote && <p className="mt-3 text-xs text-carbon/60">{invoiceNote}</p>}
                {frequency && (
                  <p className="mt-4 border-t border-carbon/10 pt-4 text-carbon/70">
                    La enviaremos <span className="font-semibold text-carbon">{frequency}</span>. Puedes pausarla o
                    cancelarla cuando quieras.
                  </p>
                )}
              </>
            ) : awaitingPayment ? (
              <p className="text-carbon/70">
                Si ya pagaste en tienda o por transferencia, el aviso puede tardar. Cuando llegue el pago te mandamos la
                confirmación por correo.
              </p>
            ) : gaveUp ? (
              <p className="text-carbon/70">
                Seguimos sin ver el registro de tu pedido. Si ya te cobraron, no vuelvas a pagar:{" "}
                <Link to="/contacto" className="font-semibold text-bosque underline underline-offset-2">
                  escríbenos
                </Link>{" "}
                con el correo que usaste y lo revisamos.
              </p>
            ) : (
              <p className="text-carbon/70">
                Estamos confirmando los últimos detalles. En unos segundos aparece aquí el resumen
                {isSubscription ? " de tu caja" : " de tu pedido"}.
              </p>
            )}
          </section>

          <section className="mt-10">
            <h2 className="font-display text-lg font-black text-carbon">Qué sigue</h2>
            <ol className="mt-4 flex flex-col gap-4 text-carbon/80">
              <li>
                <span className="font-semibold text-carbon">Revisa tu correo.</span>{" "}
                {maskedEmail
                  ? `Te enviamos la confirmación a ${maskedEmail}. Si no la ves, busca en spam.`
                  : "Te enviamos la confirmación. Si no la ves, busca en spam."}
              </li>
              <li>
                <span className="font-semibold text-carbon">Preparamos tu envío.</span> Te avisamos por correo en cuanto
                salga de nuestro almacén, con tu número de guía.
              </li>
              <li>
                <span className="font-semibold text-carbon">¿Dudas?</span>{" "}
                <Link to="/contacto" className="font-semibold text-bosque underline underline-offset-2">
                  Escríbenos
                </Link>{" "}
                y te respondemos.
              </li>
            </ol>
          </section>

          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
            {signedIn ? (
              <Link
                to="/cuenta"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-lima px-7 py-3 font-bold text-carbon transition-colors hover:bg-lima/80"
              >
                Ver mis pedidos
                <ArrowIcon />
              </Link>
            ) : (
              <>
                <Link
                  to="/tienda"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-lima px-7 py-3 font-bold text-carbon transition-colors hover:bg-lima/80"
                >
                  Seguir comprando
                  <ArrowIcon />
                </Link>
                <Link
                  to="/cuenta/registro"
                  className="inline-flex min-h-12 items-center justify-center text-sm font-semibold text-bosque underline underline-offset-2"
                >
                  Crear mi cuenta para seguir mi pedido
                </Link>
              </>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
