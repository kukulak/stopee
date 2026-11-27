import { describeCouponRules } from "~/lib/couponRules";
import { formatDayMx } from "~/lib/promotionDates";
import type { LoaderFunctionArgs } from "react-router";
import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { connectDB } from "~/lib/db.server";
import { PromotionModel } from "~/models/promotion.server";
import type { PromotionType } from "~/data/promotionTypes";
import { ProductModel } from "~/models/product.server";
import { getCatalogItems } from "~/lib/catalog.server";
import { parseCatalogFormData } from "~/lib/upload.server";
import { buildPromotionDocFromFormData } from "~/lib/promotionForm.server";
import { PromotionFormFields, TYPE_LABELS, type PromotionDefaults } from "~/components/admin/PromotionFormFields";
import { requireAdmin } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Descuentos y promociones — Admin STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const [promotions, products, catalogItems] = await Promise.all([
    PromotionModel.find().sort({ createdAt: -1 }).populate("freeGift.giftProduct").populate("buyTogether.productIds").lean(),
    ProductModel.find().select("name").lean(),
    getCatalogItems({ includeUnavailable: true }),
  ]);
  const catalogBySku = new Map(catalogItems.map((item) => [item.sku, item]));

  return data({
    products: products.map((p) => ({ id: String(p._id), name: p.name })),
    catalogItems: catalogItems.map((item) => ({ sku: item.sku, name: item.name })),
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
            giftProduct: p.freeGift.giftProduct ? String((p.freeGift.giftProduct as unknown as { _id: unknown })._id) : "",
            giftProductName: (p.freeGift.giftProduct as unknown as { name?: string } | null)?.name ?? null,
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
            productIds: ((p.buyTogether.productIds as unknown as { _id: unknown }[]) ?? []).map((prod) =>
              String(prod._id),
            ),
            productNames: ((p.buyTogether.productIds as unknown as { name?: string }[]) ?? []).map(
              (prod) => prod?.name ?? "",
            ),
          }
        : null,
      loyalty: p.loyalty ?? null,
      byRequirement: p.byRequirement
        ? {
            condition: p.byRequirement.condition,
            targetSku: p.byRequirement.targetSku ?? "",
            targetName: p.byRequirement.targetSku
              ? catalogBySku.get(p.byRequirement.targetSku)?.name ?? null
              : null,
            minQuantity: p.byRequirement.minQuantity ?? null,
            minSpendMxn: p.byRequirement.minSpendMxn ?? null,
            rewardDiscountPercentage: p.byRequirement.rewardDiscountPercentage ?? null,
            rewardGiftSku: p.byRequirement.rewardGiftSku ?? "",
            rewardGiftName: p.byRequirement.rewardGiftSku
              ? catalogBySku.get(p.byRequirement.rewardGiftSku)?.name ?? null
              : null,
          }
        : null,
      banner: p.banner ?? { enabled: false, text: "", ctaText: "", ctaHref: "", imageUrl: "", imageAlt: "" },
    })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const formData = await parseCatalogFormData(request);
  const intent = formData.get("intent");

  if (intent === "toggle-active") {
    const promo = await PromotionModel.findById(String(formData.get("id")));
    if (promo) {
      promo.isActive = !promo.isActive;
      await promo.save();
    }
    return data({ ok: true as const, error: null });
  }

  if (intent === "delete") {
    await PromotionModel.findByIdAndDelete(String(formData.get("id")));
    return data({ ok: true as const, error: null });
  }

  if (intent === "duplicate") {
    const original = await PromotionModel.findById(String(formData.get("id"))).lean();
    if (!original) {
      return data({ ok: false as const, error: "No se encontró la promoción a duplicar." }, { status: 404 });
    }
    const {
      _id: _originalId,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      timesUsed: _timesUsed,
      ...rest
    } = original as typeof original & { _id: unknown };

    const clone: Record<string, unknown> = {
      ...rest,
      name: `${original.name} (copia)`,
      isActive: false,
      startsAt: undefined,
      endsAt: undefined,
      timesUsed: 0,
    };
    // Un cupón duplicado no puede quedarse con el mismo código único.
    if (original.type === "coupon" && original.coupon?.code) {
      clone.coupon = { ...original.coupon, code: `${original.coupon.code}-COPY` };
    }
    await PromotionModel.create(clone);
    return data({ ok: true as const, error: null });
  }

  if (intent === "update") {
    const id = String(formData.get("id"));
    const existing = await PromotionModel.findById(id);
    if (!existing) {
      return data({ ok: false as const, error: "Promoción no encontrada." }, { status: 404 });
    }
    const result = await buildPromotionDocFromFormData(formData, {
      existingId: id,
      existingBannerImageUrl: existing.banner?.imageUrl ?? "",
    });
    if (!result.ok) {
      return data({ ok: false as const, error: result.error }, { status: result.status });
    }
    await PromotionModel.findByIdAndUpdate(id, result.doc);
    return data({ ok: true as const, error: null });
  }

  if (intent === "create") {
    const result = await buildPromotionDocFromFormData(formData);
    if (!result.ok) {
      return data({ ok: false as const, error: result.error }, { status: result.status });
    }
    await PromotionModel.create(result.doc);
    return data({ ok: true as const, error: null });
  }

  return data({ ok: false as const, error: "Acción no reconocida." }, { status: 400 });
}

export default function AdminDiscounts() {
  const { promotions, products, catalogItems } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isCreating = navigation.state !== "idle" && navigation.formData?.get("intent") === "create";
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="min-w-0">
      <h1 className="font-display text-2xl font-black text-carbon sm:text-3xl">Descuentos y promociones</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Varias estrategias en un solo lugar — cupones, BOGO, regalos, escalonados, flash y más.
      </p>

      <Form
        method="post"
        encType="multipart/form-data"
        className="mt-6 flex flex-col gap-5 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6"
      >
        <input type="hidden" name="intent" value="create" />
        <PromotionFormFields products={products} catalogItems={catalogItems} />

        {actionData?.error && <p className="text-sm font-semibold text-red-600">{actionData.error}</p>}

        <button
          type="submit"
          disabled={isCreating}
          className="min-h-11 w-full rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60 sm:w-auto sm:self-start"
        >
          {isCreating ? "Creando…" : "Crear promoción"}
        </button>
      </Form>

      {promotions.length === 0 ? (
        <p className="mt-8 text-sm text-carbon/60">Aún no has creado ninguna promoción.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {promotions.map((p) => (
            <li key={p.id} className="min-w-0 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words font-display font-bold text-carbon">{p.name}</p>
                    <span className="rounded-full bg-carbon/5 px-2 py-0.5 text-xs text-carbon/50">
                      {TYPE_LABELS[p.type]}
                    </span>
                    {p.banner.enabled && (
                      <span className="rounded-full bg-oliva/15 px-2 py-0.5 text-xs font-semibold text-oliva">
                        Con banner
                      </span>
                    )}
                    {p.banner.enabled && p.isActive && (
                      <span className="rounded-full bg-lima px-2 py-0.5 text-xs font-bold text-carbon">En el carrusel</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-carbon/60">{describePromotion(p)}</p>
                  <p className="mt-1 text-xs text-carbon/40">
                    {p.timesUsed} {p.timesUsed === 1 ? "uso" : "usos"}
                    {(p.startsAt || p.endsAt) && (
                      <>
                        {" "}
                        · {p.startsAt ? formatDayMx(p.startsAt) : "sin inicio"} –{" "}
                        {p.endsAt ? formatDayMx(p.endsAt) : "sin fin"}
                      </>
                    )}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center lg:shrink-0">
                  <span
                    className={`col-span-2 justify-self-start rounded-full px-2.5 py-1 text-xs font-semibold sm:col-span-1 ${
                      p.isActive ? "bg-lima/20 text-bosque" : "bg-carbon/10 text-carbon/50"
                    }`}
                  >
                    {p.isActive ? "Activa" : "Inactiva"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                    className="min-h-11 w-full rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30 sm:w-auto"
                  >
                    {editingId === p.id ? "Cerrar" : "Editar"}
                  </button>
                  <Form method="post" className="contents">
                    <input type="hidden" name="intent" value="duplicate" />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="min-h-11 w-full rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30 sm:w-auto">
                      Duplicar
                    </button>
                  </Form>
                  <Form method="post" className="contents">
                    <input type="hidden" name="intent" value="toggle-active" />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="min-h-11 w-full rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30 sm:w-auto">
                      {p.isActive ? "Desactivar" : "Activar"}
                    </button>
                  </Form>
                  <Form method="post" className="contents">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="min-h-11 w-full rounded-full border border-carbon/15 px-4 text-xs font-semibold text-red-600 hover:border-red-300 sm:w-auto">
                      Eliminar
                    </button>
                  </Form>
                </div>
              </div>

              {editingId === p.id && (
                <Form
                  method="post"
                  encType="multipart/form-data"
                  className="mt-5 flex min-w-0 flex-col gap-5 rounded-2xl border border-dashed border-carbon/20 p-3 sm:p-4"
                >
                  <input type="hidden" name="intent" value="update" />
                  <input type="hidden" name="id" value={p.id} />
                  <PromotionFormFields products={products} catalogItems={catalogItems} defaults={p as PromotionDefaults} />
                  <button
                    type="submit"
                    className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso sm:w-auto sm:self-start"
                  >
                    Guardar cambios
                  </button>
                </Form>
              )}
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
      if (!p.coupon) return "";
      return [
        p.coupon.autoApply
          ? `Se aplica sola${p.coupon.code ? ` (también con el código ${p.coupon.code})` : ""} · ${p.coupon.percentage}% de descuento`
          : `Código ${p.coupon.code} · ${p.coupon.percentage}% de descuento`,
        ...describeCouponRules(p.coupon),
      ].join(" · ");
    case "bogo":
      return p.bogo
        ? `Compra ${p.bogo.buyQuantity}, llévate ${p.bogo.getQuantity} con ${p.bogo.getDiscountPercentage}% de descuento${p.bogo.applicableSku ? ` (${p.bogo.applicableSku})` : ""}`
        : "";
    case "free_gift":
      return p.freeGift
        ? `Gasto mínimo $${p.freeGift.minSpendMxn}, regalo: ${p.freeGift.giftProductName ?? "producto eliminado"}`
        : "";
    case "new_customer":
      return p.newCustomer ? `${p.newCustomer.percentage}% para nuevos clientes` : "";
    case "tiered_spend":
      return p.tieredSpend
        ? (p.tieredSpend.tiers as { minSpendMxn: number; percentage: number }[])
            .map((t) => `$${t.minSpendMxn}: ${t.percentage}%`)
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
    case "loyalty": {
      if (!p.loyalty) return "";
      const tiers = (p.loyalty.tiers ?? []) as { rewardType?: string; percentage?: number; giftDescription?: string }[];
      const tierLabels = tiers.map((t) => (t.rewardType === "gift" ? t.giftDescription || "regalo" : `${t.percentage}%`));
      return `Cada ${p.loyalty.purchasesRequired} compras, para la siguiente: ${tierLabels.join(", luego ") || "sin recompensas"}`;
    }
    case "by_requirement": {
      if (!p.byRequirement) return "";
      const { condition, targetName, minQuantity, minSpendMxn, rewardDiscountPercentage, rewardGiftName } = p.byRequirement;
      const conditionLabel =
        condition === "first_purchase"
          ? "Es su primera compra"
          : condition === "product_in_cart"
            ? `${minQuantity ?? 1}+ × ${targetName ?? "producto/paquete eliminado"} en el carrito`
            : `Gasta $${minSpendMxn} en ${targetName ?? "producto/paquete eliminado"}`;
      const rewardParts = [
        rewardDiscountPercentage ? `${rewardDiscountPercentage}% de descuento` : null,
        rewardGiftName ? `regalo: ${rewardGiftName}` : null,
      ].filter(Boolean);
      return `${conditionLabel}: ${rewardParts.join(" + ") || "sin recompensa configurada"}`;
    }
    default:
      return "";
  }
}
