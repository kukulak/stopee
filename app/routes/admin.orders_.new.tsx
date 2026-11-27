import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useEffect, useState } from "react";
import { connectDB } from "~/lib/db.server";
import { requireAdmin } from "~/lib/session.server";
import { OrderModel } from "~/models/order.server";
import { getCatalogItemBySku, getCatalogItems } from "~/lib/catalog.server";
import { decrementStock } from "~/lib/inventory.server";
import { logError } from "~/lib/logger.server";
import { readInvoiceRequest, orderNumber, type BillingErrors } from "~/lib/fiscal";
import { InvoiceFields } from "~/components/ecommerce/InvoiceFields";

export const meta: MetaFunction = () => [{ title: "Crear pedido — Admin STOPee" }];

const FORM_ID = "manual-order-form";

const PAYMENT_OPTIONS = [
  { value: "cash", label: "Efectivo" },
  { value: "transfer", label: "Transferencia" },
  { value: "other", label: "Otro" },
] as const;

const STATUS_OPTIONS = [
  { value: "delivered", label: "Entregado" },
  { value: "paid", label: "Nuevo (falta prepararlo)" },
  { value: "processing", label: "En preparación" },
  { value: "shipped", label: "En tránsito" },
] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const money = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const mexicoToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  // Todo lo que se puede vender, esté o no a la venta en línea: productos, paquetes y kits, y lo exclusivo de los Puntos de recarga.
  const catalog = await getCatalogItems({ includeUnavailable: true });
  const group = (i: { kind: string; visibility: string }) =>
    i.visibility === "ALLY_ONLY" ? "ally" : i.kind === "bundle" ? "bundle" : "product";
  return data({
    today: mexicoToday(),
    items: catalog
      .map((i) => ({ sku: i.sku, name: i.name, price: i.priceMxn, stock: i.stock, group: group(i) }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
  });
}

type ActionResult =
  | { ok: true; number: string; total: number; units: number; lowStock: string[]; where: string }
  | { ok: false; error: string; invoiceErrors?: BillingErrors };

/**
 * Registra una venta que no pasó por la tienda (un vecino que paga en efectivo, por ejemplo). Queda como un pedido
 * más —con su número, sus existencias descontadas y, si lo piden, su factura— marcado como «Manual». No manda correos.
 */
export async function action({ request }: ActionFunctionArgs) {
  const staff = await requireAdmin(request);
  await connectDB();
  const form = await request.formData();
  const fail = (error: string, extra: { invoiceErrors?: BillingErrors } = {}) =>
    data<ActionResult>({ ok: false, error, ...extra }, { status: 400 });

  const skus = form.getAll("lineSku").map(String);
  const quantities = form.getAll("lineQty").map(String);
  const prices = form.getAll("linePrice").map(String);
  if (skus.length > 60) return fail("Son demasiados renglones. Registra la venta en dos pedidos.");

  const items: { sku: string; name: string; quantity: number; unitPriceMxn: number }[] = [];
  const soldBySku = new Map<string, { name: string; stock: number; quantity: number }>();
  let gross = 0;
  let net = 0;
  for (let i = 0; i < skus.length; i++) {
    // El nombre y el precio de lista se leen del catálogo, no de lo que mande el navegador.
    const item = await getCatalogItemBySku(skus[i], { includeUnavailable: true });
    if (!item) return fail("Uno de los productos ya no está disponible. Quítalo del pedido y vuelve a agregarlo.");
    const quantity = Number(quantities[i]);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      return fail(`La cantidad de «${item.name}» debe ser un número entero, de 1 a 999.`);
    }
    const priceRaw = (prices[i] ?? "").trim();
    const unitPrice = priceRaw === "" ? item.priceMxn : Number(priceRaw);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000) {
      return fail(`Revisa el precio de «${item.name}»: escribe un monto como 320 o 299.50.`);
    }
    const unit = Math.round(unitPrice * 100) / 100;
    items.push({ sku: item.sku, name: item.name, quantity, unitPriceMxn: unit });
    gross += item.priceMxn * quantity;
    net += unit * quantity;
    const sold = soldBySku.get(item.sku) ?? { name: item.name, stock: item.stock, quantity: 0 };
    sold.quantity += quantity;
    soldBySku.set(item.sku, sold);
  }
  const lowStock = [...soldBySku.values()]
    .filter((s) => s.quantity > s.stock)
    .map((s) => `${s.name} (había ${s.stock}, vendiste ${s.quantity})`);
  if (items.length === 0) return fail("Elige al menos un producto: pon la cantidad que vendiste.");

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (email && (email.length > 254 || !EMAIL_PATTERN.test(email))) {
    return fail("Revisa el correo: debe verse como nombre@correo.com. Si no lo tienes, déjalo vacío.");
  }
  const customerName = String(form.get("customerName") ?? "").trim().slice(0, 120);

  const paymentMethod = String(form.get("paymentMethod") ?? "");
  if (!PAYMENT_OPTIONS.some((o) => o.value === paymentMethod)) return fail("Elige cómo te pagaron.");
  const status = String(form.get("status") ?? "");
  if (!STATUS_OPTIONS.some((o) => o.value === status)) return fail("Elige el estado del pedido.");

  // Fecha: hoy usa la hora real; un día anterior se guarda al mediodía de México (UTC-6 todo el año).
  const dateRaw = String(form.get("date") ?? "").trim();
  let createdAt: Date | undefined;
  if (dateRaw && dateRaw !== mexicoToday()) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? new Date(`${dateRaw}T12:00:00-06:00`) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return fail("La fecha no es válida. Elige un día del calendario.");
    if (parsed.getTime() > Date.now()) return fail("La fecha no puede ser futura. Elige hoy o un día anterior.");
    createdAt = parsed;
  }

  const invoice = readInvoiceRequest(form);
  if (invoice.requested && !invoice.result.ok) {
    return fail("Revisa los datos de la factura.", { invoiceErrors: invoice.result.errors });
  }

  const discount = Math.max(0, Math.round((gross - net) * 100) / 100);
  const order = await OrderModel.create({
    source: "manual",
    createdBy: staff._id,
    createdByName: (staff.name || staff.email || "").trim(),
    paymentMethod,
    email,
    customerName,
    items,
    totalAmount: Math.max(gross, net),
    discountAmount: discount,
    discountPercent: gross > 0 && discount > 0 ? Math.round((discount / gross) * 10000) / 100 : 0,
    netAmount: Math.round(net * 100) / 100,
    type: "one_time",
    status,
    countsTowardLoyalty: false,
    ...(invoice.requested && invoice.result.ok ? { requiresInvoice: true, billingInfo: invoice.result.info } : {}),
    // Las existencias se descuentan aquí mismo, así que ningún proceso posterior debe volver a hacerlo.
    effects: { stock: true },
    ...(createdAt ? { createdAt } : {}),
  });

  try {
    await decrementStock(items.map((i) => ({ sku: i.sku, quantity: i.quantity })));
  } catch (error) {
    logError("orders.manual-stock", error, { orderId: String(order._id) });
  }

  return data<ActionResult>({
    ok: true,
    number: orderNumber(order._id),
    total: order.netAmount,
    units: items.reduce((sum, i) => sum + i.quantity, 0),
    lowStock,
    where: invoice.requested ? "factura" : "pedidos",
  });
}

const fieldClass =
  "min-h-11 w-full rounded-xl border border-carbon/15 bg-white px-3 text-base text-carbon placeholder:text-carbon/40 focus:border-oliva focus:outline-none sm:text-sm";

type Line = { sku: string; name: string; qty: number; price: number };

const GROUP_LABELS: Record<string, string> = {
  product: "Productos",
  bundle: "Paquetes y kits",
  ally: "Para Puntos de recarga",
};

export default function AdminNewOrder() {
  const { items, today } = useLoaderData<typeof loader>();
  const result = useActionData<ActionResult>();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  const [lines, setLines] = useState<Line[]>([]);
  // Lo que se está por agregar: no viaja con el formulario hasta que se toca «Agregar».
  const [draftSku, setDraftSku] = useState("");
  const [draftQty, setDraftQty] = useState("1");
  const [draftPrice, setDraftPrice] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [dismissed, setDismissed] = useState<unknown>(null);

  const draftItem = items.find((i) => i.sku === draftSku);
  const total = lines.reduce((sum, l) => sum + l.qty * l.price, 0);
  const units = lines.reduce((sum, l) => sum + l.qty, 0);

  const success = result?.ok && result !== dismissed ? result : null;
  const errorMessage = result && !result.ok ? result.error : null;
  const invoiceErrors = result && !result.ok ? result.invoiceErrors : undefined;
  // El formulario es largo: al registrar, la confirmación debe quedar a la vista aunque se haya enviado desde abajo.
  useEffect(() => {
    if (success) window.scrollTo({ top: 0 });
  }, [success]);

  function chooseItem(sku: string) {
    setDraftSku(sku);
    setDraftError(null);
    const item = items.find((i) => i.sku === sku);
    setDraftPrice(item ? String(item.price) : "");
  }

  function addLine() {
    if (!draftItem) return setDraftError("Elige qué vendiste.");
    const qty = Number(draftQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) return setDraftError("La cantidad debe ser un número entero, de 1 a 999.");
    const price = draftPrice.trim() === "" ? draftItem.price : Number(draftPrice);
    if (!Number.isFinite(price) || price < 0) return setDraftError("Escribe el precio como 320 o 299.50.");
    setLines((current) => {
      // El mismo producto al mismo precio se suma al renglón que ya está, en vez de repetirlo.
      const same = current.findIndex((l) => l.sku === draftItem.sku && l.price === price);
      if (same >= 0) return current.map((l, i) => (i === same ? { ...l, qty: l.qty + qty } : l));
      return [...current, { sku: draftItem.sku, name: draftItem.name, qty, price }];
    });
    setDraftSku("");
    setDraftQty("1");
    setDraftPrice("");
    setDraftError(null);
  }

  function onKeyDownDraft(e: React.KeyboardEvent) {
    // Enter en estos campos agrega el renglón; no debe mandar todo el pedido.
    if (e.key === "Enter") {
      e.preventDefault();
      addLine();
    }
  }

  if (success) {
    return (
      <div className="max-w-xl">
        <div role="status" className="rounded-2xl border border-lima bg-lima/20 p-5">
          <h1 className="font-display text-2xl font-black text-carbon">Venta registrada</h1>
          <p className="mt-2 text-sm text-carbon">
            Pedido <strong>{success.number}</strong> por <strong>{money(success.total)}</strong> ({success.units}{" "}
            {success.units === 1 ? "pieza" : "piezas"}). Ya se descontó del inventario.
          </p>
          {success.where === "factura" && (
            <p className="mt-1 text-sm text-carbon">Pidió factura: aparecerá en la lista de pedidos por facturar.</p>
          )}
          {success.lowStock.length > 0 && (
            <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Ojo: vendiste más de lo que había registrado, así que el inventario quedó en 0 para{" "}
              {success.lowStock.join(", ")}. Revisa tus existencias.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setDismissed(result);
                setLines([]);
                setRound((r) => r + 1);
              }}
              className="min-h-11 rounded-full bg-carbon px-5 text-sm font-bold text-hueso hover:bg-carbon/90"
            >
              Registrar otra venta
            </button>
            <a
              href="/admin/orders"
              className="flex min-h-11 items-center rounded-full border border-carbon/20 px-5 text-sm font-semibold text-carbon hover:border-carbon/40"
            >
              Ver pedidos
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <a href="/admin/orders" className="text-sm font-semibold text-bosque underline">
        Volver a pedidos
      </a>
      <h1 className="mt-2 font-display text-2xl font-black text-carbon sm:text-3xl">Crear pedido</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Para ventas que no pasaron por la tienda, como un vecino que paga en efectivo. Queda como un pedido más,
        marcado como «Manual» y con tu nombre, y descuenta del inventario. No se manda ningún correo.
      </p>

      <Form method="post" id={FORM_ID} key={round} className="mt-6 flex flex-col gap-6">
        <fieldset className="min-w-0">
          <legend className="mb-2 text-sm font-bold text-carbon">Qué vendiste</legend>

          <div className="rounded-2xl border border-carbon/10 bg-white p-3">
            <label htmlFor="draftSku" className="mb-1 block text-sm font-semibold text-carbon">
              Producto
            </label>
            <select
              id="draftSku"
              value={draftSku}
              onChange={(e) => chooseItem(e.target.value)}
              onKeyDown={onKeyDownDraft}
              className={fieldClass}
            >
              <option value="">Elige un producto, paquete o kit</option>
              {(["product", "bundle", "ally"] as const).map((g) => {
                const inGroup = items.filter((i) => i.group === g);
                return inGroup.length === 0 ? null : (
                  <optgroup key={g} label={GROUP_LABELS[g]}>
                    {inGroup.map((i) => (
                      <option key={i.sku} value={i.sku}>
                        {i.name} · {money(i.price)}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            {draftItem && <p className="mt-1 text-xs text-carbon/50">{draftItem.stock} en inventario</p>}

            <div className="mt-3 grid grid-cols-[5.5rem_minmax(0,1fr)] items-end gap-3 sm:grid-cols-[6rem_8rem_auto]">
              <div>
                <label htmlFor="draftQty" className="mb-1 block text-sm font-semibold text-carbon">
                  Cantidad
                </label>
                <input
                  id="draftQty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={999}
                  step={1}
                  value={draftQty}
                  onChange={(e) => setDraftQty(e.target.value)}
                  onKeyDown={onKeyDownDraft}
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor="draftPrice" className="mb-1 block text-sm font-semibold text-carbon">
                  Precio c/u
                </label>
                <input
                  id="draftPrice"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={draftPrice}
                  onChange={(e) => setDraftPrice(e.target.value)}
                  onKeyDown={onKeyDownDraft}
                  placeholder={draftItem ? String(draftItem.price) : ""}
                  className={fieldClass}
                />
              </div>
              <button
                type="button"
                onClick={addLine}
                className="col-span-2 min-h-11 rounded-full border border-carbon/25 px-5 text-sm font-bold text-carbon hover:border-carbon/50 sm:col-span-1"
              >
                Agregar
              </button>
            </div>
            {draftError && (
              <p role="alert" className="mt-2 text-sm font-semibold text-red-600">
                {draftError}
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-carbon/50">El precio ya incluye IVA. Cámbialo si le diste descuento.</p>

          {lines.length === 0 ? (
            <p className="mt-3 text-sm text-carbon/60">Todavía no agregas nada. Elige lo que vendiste y toca «Agregar».</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-carbon/10 rounded-2xl border border-carbon/10 bg-white">
              {lines.map((l, i) => (
                <li key={`${l.sku}-${l.price}`} className="flex items-center gap-3 p-3">
                  <input type="hidden" name="lineSku" value={l.sku} />
                  <input type="hidden" name="lineQty" value={l.qty} />
                  <input type="hidden" name="linePrice" value={l.price} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-carbon">{l.name}</p>
                    <p className="text-xs text-carbon/60">
                      {l.qty} × {money(l.price)}
                    </p>
                  </div>
                  <p className="font-semibold text-carbon">{money(l.qty * l.price)}</p>
                  <button
                    type="button"
                    onClick={() => setLines((current) => current.filter((_, idx) => idx !== i))}
                    aria-label={`Quitar ${l.name}`}
                    className="min-h-11 rounded-full px-3 text-sm font-semibold text-carbon/60 hover:text-red-600"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <fieldset className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-bold text-carbon">Cliente (opcional)</legend>
          <div>
            <label htmlFor="customerName" className="mb-1 block text-sm font-semibold text-carbon">
              Nombre
            </label>
            <input id="customerName" name="customerName" maxLength={120} autoComplete="off" placeholder="Vecino del 4B" className={fieldClass} />
          </div>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-semibold text-carbon">
              Correo
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="nombre@correo.com"
              className={fieldClass}
            />
          </div>
        </fieldset>

        <fieldset className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-bold text-carbon">Cobro</legend>
          <div>
            <label htmlFor="paymentMethod" className="mb-1 block text-sm font-semibold text-carbon">
              Cómo pagó
            </label>
            <select id="paymentMethod" name="paymentMethod" defaultValue="cash" className={fieldClass}>
              {PAYMENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="status" className="mb-1 block text-sm font-semibold text-carbon">
              Estado
            </label>
            <select id="status" name="status" defaultValue="delivered" className={fieldClass}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="date" className="mb-1 block text-sm font-semibold text-carbon">
              Fecha de la venta
            </label>
            <input id="date" name="date" type="date" defaultValue={today} max={today} className={fieldClass} />
          </div>
        </fieldset>

        <InvoiceFields formId={FORM_ID} signedIn={false} errors={invoiceErrors} staff />

        <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t border-carbon/10 bg-hueso px-1 py-3">
          {errorMessage && (
            <p role="alert" className="text-sm font-semibold text-red-600">
              {errorMessage}
            </p>
          )}
          {draftSku && !errorMessage && (
            <p className="text-sm text-carbon/70">
              Tienes «{draftItem?.name ?? "un producto"}» por agregar. Toca «Agregar» para sumarlo al pedido.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-carbon" aria-live="polite">
              {units > 0 ? (
                <>
                  <span className="text-carbon/60">{units} {units === 1 ? "pieza" : "piezas"} · Total </span>
                  <strong className="text-lg">{money(total)}</strong>
                </>
              ) : (
                <span className="text-carbon/60">Agrega al menos un producto.</span>
              )}
            </p>
            <button
              type="submit"
              disabled={submitting || lines.length === 0 || Boolean(draftSku)}
              className="min-h-11 rounded-full bg-carbon px-6 text-sm font-bold text-hueso hover:bg-carbon/90 disabled:opacity-50"
            >
              {submitting ? "Registrando…" : "Registrar venta"}
            </button>
          </div>
        </div>
      </Form>
    </div>
  );
}
