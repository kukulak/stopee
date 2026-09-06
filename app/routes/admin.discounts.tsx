import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { z } from "zod";
import { connectDB } from "~/lib/db.server";
import { PromotionModel } from "~/models/promotion.server";
import { PROMOTION_TYPES, type PromotionType } from "~/data/promotionTypes";
import { ProductModel } from "~/models/product.server";

export const meta: MetaFunction = () => [{ title: "Descuentos y promociones — Admin STOPee" }];

const TYPE_LABELS: Record<PromotionType, string> = {
  coupon: "Cupón",
  bogo: "Compra y llévate (BOGO)",
  free_gift: "Regalo gratis",
  new_customer: "Descuento nuevos clientes",
  tiered_spend: "Descuento escalonado por gasto",
  custom: "Personalizado",
  flash_sale: "Venta flash",
  vip_early: "VIP primeros compradores",
  buy_together: "Comprar juntos",
  loyalty: "Programa de lealtad",
};

export async function loader() {
  await connectDB();
  const [promotions, products] = await Promise.all([
    PromotionModel.find().sort({ createdAt: -1 }).populate("freeGift.giftProduct").populate("buyTogether.productIds").lean(),
    ProductModel.find().select("name").lean(),
  ]);

  return json({
    products: products.map((p) => ({ id: String(p._id), name: p.name })),
    promotions: promotions.map((p) => ({
      id: String(p._id),
      name: p.name,
      type: p.type as PromotionType,
      isActive: p.isActive,
      startsAt: p.startsAt ?? null,
      endsAt: p.endsAt ?? null,
      usageLimit: p.usageLimit ?? null,
      timesUsed: p.timesUsed ?? 0,
      coupon: p.coupon ?? null,
      bogo: p.bogo ?? null,
      freeGift: p.freeGift
        ? {
            minSpendMxn: p.freeGift.minSpendMxn ?? null,
            giftProductName:
              (p.freeGift.giftProduct as unknown as { name?: string } | null)?.name ?? null,
          }
        : null,
      newCustomer: p.newCustomer ?? null,
      tieredSpend: p.tieredSpend ?? null,
      custom: p.custom ?? null,
      flashSale: p.flashSale ?? null,
      vipEarly: p.vipEarly ?? null,
      buyTogether: p.buyTogether
        ? {
            percentage: p.buyTogether.percentage ?? null,
            productNames: ((p.buyTogether.productIds as unknown as { name?: string }[]) ?? []).map(
              (prod) => prod?.name ?? "",
            ),
          }
        : null,
      loyalty: p.loyalty ?? null,
      banner: p.banner ?? { enabled: false, text: "", ctaText: "", ctaHref: "" },
    })),
  });
}

const baseSchema = z.object({
  name: z.string().trim().min(2, "Ponle un nombre a la promoción."),
  type: z.enum(PROMOTION_TYPES),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  usageLimit: z.coerce.number().optional(),
  bannerEnabled: z.literal("on").optional(),
  bannerText: z.string().optional(),
  bannerCtaText: z.string().optional(),
  bannerCtaHref: z.string().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  await connectDB();
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle-active") {
    const promo = await PromotionModel.findById(String(formData.get("id")));
    if (promo) {
      promo.isActive = !promo.isActive;
      await promo.save();
    }
    return json({ ok: true as const, error: null });
  }

  if (intent === "delete") {
    await PromotionModel.findByIdAndDelete(String(formData.get("id")));
    return json({ ok: true as const, error: null });
  }

  if (intent !== "create") {
    return json({ ok: false as const, error: "Acción no reconocida." }, { status: 400 });
  }

  const base = baseSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    startsAt: formData.get("startsAt") || undefined,
    endsAt: formData.get("endsAt") || undefined,
    usageLimit: formData.get("usageLimit") || undefined,
    bannerEnabled: formData.get("bannerEnabled") || undefined,
    bannerText: formData.get("bannerText") || undefined,
    bannerCtaText: formData.get("bannerCtaText") || undefined,
    bannerCtaHref: formData.get("bannerCtaHref") || undefined,
  });

  if (!base.success) {
    return json({ ok: false as const, error: base.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const { type } = base.data;
  const doc: Record<string, unknown> = {
    name: base.data.name,
    type,
    startsAt: base.data.startsAt ? new Date(base.data.startsAt) : undefined,
    endsAt: base.data.endsAt ? new Date(base.data.endsAt) : undefined,
    usageLimit: base.data.usageLimit,
    banner: {
      enabled: base.data.bannerEnabled === "on",
      text: base.data.bannerText ?? "",
      ctaText: base.data.bannerCtaText ?? "",
      ctaHref: base.data.bannerCtaHref || "/tienda",
    },
  };

  const percentage = Number(formData.get("percentage"));

  switch (type) {
    case "coupon": {
      const code = String(formData.get("code") ?? "").trim().toUpperCase();
      if (!code || !percentage) {
        return json({ ok: false as const, error: "El cupón necesita código y porcentaje." }, { status: 400 });
      }
      const exists = await PromotionModel.findOne({ type: "coupon", "coupon.code": code });
      if (exists) {
        return json({ ok: false as const, error: "Ya existe un cupón con ese código." }, { status: 409 });
      }
      doc.coupon = { code, percentage };
      break;
    }
    case "bogo": {
      doc.bogo = {
        buyQuantity: Number(formData.get("buyQuantity") ?? 1),
        getQuantity: Number(formData.get("getQuantity") ?? 1),
        getDiscountPercentage: Number(formData.get("getDiscountPercentage") ?? 100),
        applicableSku: String(formData.get("applicableSku") ?? "").trim(),
      };
      break;
    }
    case "free_gift": {
      doc.freeGift = {
        minSpendMxn: Number(formData.get("minSpendMxn") ?? 0),
        giftProduct: String(formData.get("giftProductId") ?? "") || undefined,
      };
      break;
    }
    case "new_customer": {
      if (!percentage) return json({ ok: false as const, error: "Ingresa el % de descuento." }, { status: 400 });
      doc.newCustomer = { percentage };
      break;
    }
    case "tiered_spend": {
      const tiers = [1, 2, 3]
        .map((n) => ({
          minSpendMxn: Number(formData.get(`tier${n}MinSpend`) ?? 0),
          percentage: Number(formData.get(`tier${n}Percentage`) ?? 0),
        }))
        .filter((t) => t.minSpendMxn > 0 && t.percentage > 0);
      if (tiers.length === 0) {
        return json({ ok: false as const, error: "Define al menos un escalón." }, { status: 400 });
      }
      doc.tieredSpend = { tiers };
      break;
    }
    case "custom": {
      doc.custom = {
        percentage: percentage || undefined,
        description: String(formData.get("description") ?? "").trim(),
      };
      break;
    }
    case "flash_sale": {
      if (!percentage) return json({ ok: false as const, error: "Ingresa el % de la venta flash." }, { status: 400 });
      doc.flashSale = { percentage };
      break;
    }
    case "vip_early": {
      if (!percentage) return json({ ok: false as const, error: "Ingresa el % VIP." }, { status: 400 });
      doc.vipEarly = { percentage, maxCustomers: base.data.usageLimit };
      break;
    }
    case "buy_together": {
      const productIds = formData.getAll("buyTogetherProductIds") as string[];
      if (productIds.length < 2 || !percentage) {
        return json(
          { ok: false as const, error: "Elige al menos 2 productos y un % de descuento." },
          { status: 400 },
        );
      }
      doc.buyTogether = { productIds, percentage };
      break;
    }
    case "loyalty": {
      const purchasesRequired = Number(formData.get("purchasesRequired") ?? 5);
      if (!percentage || purchasesRequired < 2) {
        return json(
          { ok: false as const, error: "Define cada cuántas compras y el % de descuento." },
          { status: 400 },
        );
      }
      doc.loyalty = { purchasesRequired, percentage };
      break;
    }
  }

  await PromotionModel.create(doc);
  return json({ ok: true as const, error: null });
}

const inputClass =
  "mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none";

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-carbon">
        {label}
      </label>
      {children}
    </div>
  );
}

export default function AdminDiscounts() {
  const { promotions, products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isCreating = navigation.state !== "idle" && navigation.formData?.get("intent") === "create";
  const [type, setType] = useState<PromotionType>("coupon");

  return (
    <div>
      <h1 className="font-display text-2xl font-black text-carbon">Descuentos y promociones</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Varias estrategias en un solo lugar — cupones, BOGO, regalos, escalonados, flash y más.
      </p>

      <Form method="post" className="mt-6 flex flex-col gap-5 rounded-3xl border border-carbon/10 bg-white p-6">
        <input type="hidden" name="intent" value="create" />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nombre interno" htmlFor="name">
            <input id="name" name="name" required placeholder="Descuento lanzamiento" className={inputClass} />
          </Field>
          <Field label="Tipo de promoción" htmlFor="type">
            <select
              id="type"
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as PromotionType)}
              className={inputClass}
            >
              {PROMOTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* Campos por tipo */}
        {type === "coupon" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Código" htmlFor="code">
              <input id="code" name="code" required placeholder="BIENVENIDA10" className={`${inputClass} uppercase`} />
            </Field>
            <Field label="% de descuento" htmlFor="percentage">
              <input id="percentage" name="percentage" type="number" min={1} max={100} required className={inputClass} />
            </Field>
          </div>
        )}

        {type === "bogo" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Field label="Compra (cantidad)" htmlFor="buyQuantity">
              <input id="buyQuantity" name="buyQuantity" type="number" min={1} defaultValue={1} className={inputClass} />
            </Field>
            <Field label="Llévate (cantidad)" htmlFor="getQuantity">
              <input id="getQuantity" name="getQuantity" type="number" min={1} defaultValue={1} className={inputClass} />
            </Field>
            <Field label="% desc. en el regalo" htmlFor="getDiscountPercentage">
              <input id="getDiscountPercentage" name="getDiscountPercentage" type="number" min={1} max={100} defaultValue={100} className={inputClass} />
            </Field>
            <Field label="SKU aplicable" htmlFor="applicableSku">
              <input id="applicableSku" name="applicableSku" placeholder="concentrado-1l" className={inputClass} />
            </Field>
          </div>
        )}

        {type === "free_gift" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Gasto mínimo (MXN)" htmlFor="minSpendMxn">
              <input id="minSpendMxn" name="minSpendMxn" type="number" min={0} required className={inputClass} />
            </Field>
            <Field label="Producto de regalo" htmlFor="giftProductId">
              <select id="giftProductId" name="giftProductId" required className={inputClass}>
                <option value="">Selecciona un producto</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {type === "new_customer" && (
          <Field label="% de descuento" htmlFor="percentage">
            <input id="percentage" name="percentage" type="number" min={1} max={100} required className={inputClass} />
          </Field>
        )}

        {type === "tiered_spend" && (
          <div>
            <p className="text-sm font-semibold text-carbon">Escalones (deja en 0 los que no uses)</p>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="rounded-xl border border-carbon/10 p-3">
                  <p className="text-xs font-semibold text-carbon/50">Escalón {n}</p>
                  <input
                    name={`tier${n}MinSpend`}
                    type="number"
                    min={0}
                    placeholder="Gasto mín. MXN"
                    className={inputClass}
                  />
                  <input
                    name={`tier${n}Percentage`}
                    type="number"
                    min={0}
                    max={100}
                    placeholder="% descuento"
                    className={inputClass}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {type === "custom" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="% de descuento (opcional)" htmlFor="percentage">
              <input id="percentage" name="percentage" type="number" min={1} max={100} className={inputClass} />
            </Field>
            <Field label="Descripción" htmlFor="description">
              <input id="description" name="description" placeholder="Descripción de la promo" className={inputClass} />
            </Field>
          </div>
        )}

        {type === "flash_sale" && (
          <Field label="% de descuento" htmlFor="percentage">
            <input id="percentage" name="percentage" type="number" min={1} max={100} required className={inputClass} />
          </Field>
        )}

        {type === "vip_early" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="% de descuento" htmlFor="percentage">
              <input id="percentage" name="percentage" type="number" min={1} max={100} required className={inputClass} />
            </Field>
            <Field label="Primeros N compradores" htmlFor="usageLimit">
              <input id="usageLimit" name="usageLimit" type="number" min={1} placeholder="100" className={inputClass} />
            </Field>
          </div>
        )}

        {type === "buy_together" && (
          <div>
            <Field label="% de descuento" htmlFor="percentage">
              <input id="percentage" name="percentage" type="number" min={1} max={100} required className={inputClass} />
            </Field>
            <p className="mt-3 text-sm font-semibold text-carbon">Productos incluidos (elige 2 o más)</p>
            <div className="mt-2 flex flex-col gap-1">
              {products.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm text-carbon">
                  <input type="checkbox" name="buyTogetherProductIds" value={p.id} className="h-5 w-5 accent-lima" />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {type === "loyalty" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Cada cuántas compras" htmlFor="purchasesRequired">
              <input
                id="purchasesRequired"
                name="purchasesRequired"
                type="number"
                min={2}
                defaultValue={5}
                required
                className={inputClass}
              />
            </Field>
            <Field label="% de descuento permanente" htmlFor="percentage">
              <input id="percentage" name="percentage" type="number" min={1} max={100} defaultValue={10} required className={inputClass} />
            </Field>
            <p className="text-xs text-carbon/50 sm:col-span-2">
              Esto reemplaza el "camino a la 5ª compra": activa esta promoción y el dashboard/tienda
              usarán el número y porcentaje que definas aquí.
            </p>
          </div>
        )}

        {/* Vigencia */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Inicia (opcional)" htmlFor="startsAt">
            <input id="startsAt" name="startsAt" type="date" className={inputClass} />
          </Field>
          <Field label="Termina (opcional)" htmlFor="endsAt">
            <input id="endsAt" name="endsAt" type="date" className={inputClass} />
          </Field>
        </div>

        {/* Banner */}
        <div className="rounded-2xl border border-carbon/10 p-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-carbon">
            <input type="checkbox" name="bannerEnabled" className="h-5 w-5 accent-lima" />
            Mostrar banner en el hero de la tienda
          </label>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input name="bannerText" placeholder="Texto del banner" className={inputClass} />
            <input name="bannerCtaText" placeholder="Texto del botón (opcional)" className={inputClass} />
            <input name="bannerCtaHref" placeholder="/tienda" className={inputClass} />
          </div>
        </div>

        {actionData?.error && <p className="text-sm font-semibold text-red-600">{actionData.error}</p>}

        <button
          type="submit"
          disabled={isCreating}
          className="min-h-11 self-start rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60"
        >
          {isCreating ? "Creando…" : "Crear promoción"}
        </button>
      </Form>

      {promotions.length === 0 ? (
        <p className="mt-8 text-sm text-carbon/60">Aún no has creado ninguna promoción.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {promotions.map((p) => (
            <li key={p.id} className="rounded-3xl border border-carbon/10 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display font-bold text-carbon">{p.name}</p>
                    <span className="rounded-full bg-carbon/5 px-2 py-0.5 text-xs text-carbon/50">
                      {TYPE_LABELS[p.type]}
                    </span>
                    {p.banner.enabled && (
                      <span className="rounded-full bg-oliva/15 px-2 py-0.5 text-xs font-semibold text-oliva">
                        Con banner
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-carbon/60">{describePromotion(p)}</p>
                  {(p.startsAt || p.endsAt) && (
                    <p className="mt-1 text-xs text-carbon/40">
                      {p.startsAt ? new Date(p.startsAt).toLocaleDateString("es-MX") : "sin inicio"} –{" "}
                      {p.endsAt ? new Date(p.endsAt).toLocaleDateString("es-MX") : "sin fin"}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      p.isActive ? "bg-lima/20 text-bosque" : "bg-carbon/10 text-carbon/50"
                    }`}
                  >
                    {p.isActive ? "Activa" : "Inactiva"}
                  </span>
                  <Form method="post">
                    <input type="hidden" name="intent" value="toggle-active" />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30">
                      {p.isActive ? "Desactivar" : "Activar"}
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-red-600 hover:border-red-300">
                      Eliminar
                    </button>
                  </Form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type PromotionRow = ReturnType<typeof useLoaderData<typeof loader>>["promotions"][number];

function describePromotion(p: PromotionRow): string {
  switch (p.type) {
    case "coupon":
      return p.coupon ? `Código ${p.coupon.code} · ${p.coupon.percentage}% de descuento` : "";
    case "bogo":
      return p.bogo
        ? `Compra ${p.bogo.buyQuantity}, llévate ${p.bogo.getQuantity} con ${p.bogo.getDiscountPercentage}% de descuento${p.bogo.applicableSku ? ` (${p.bogo.applicableSku})` : ""}`
        : "";
    case "free_gift":
      return p.freeGift
        ? `Gasto mínimo $${p.freeGift.minSpendMxn} → regalo: ${p.freeGift.giftProductName ?? "producto eliminado"}`
        : "";
    case "new_customer":
      return p.newCustomer ? `${p.newCustomer.percentage}% para nuevos clientes` : "";
    case "tiered_spend":
      return p.tieredSpend
        ? (p.tieredSpend.tiers as { minSpendMxn: number; percentage: number }[])
            .map((t) => `$${t.minSpendMxn}→${t.percentage}%`)
            .join(" · ")
        : "";
    case "custom":
      return p.custom ? `${p.custom.percentage ? `${p.custom.percentage}% — ` : ""}${p.custom.description}` : "";
    case "flash_sale":
      return p.flashSale ? `${p.flashSale.percentage}% por tiempo limitado` : "";
    case "vip_early":
      return p.vipEarly
        ? `${p.vipEarly.percentage}% para los primeros ${p.vipEarly.maxCustomers ?? "N"} compradores`
        : "";
    case "buy_together":
      return p.buyTogether
        ? `${p.buyTogether.percentage}% al comprar juntos: ${p.buyTogether.productNames.join(" + ")}`
        : "";
    case "loyalty":
      return p.loyalty ? `${p.loyalty.percentage}% permanente desde la compra #${p.loyalty.purchasesRequired}` : "";
    default:
      return "";
  }
}
