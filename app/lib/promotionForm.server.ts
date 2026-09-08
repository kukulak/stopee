import { z } from "zod";
import { PROMOTION_TYPES, type PromotionType } from "~/data/promotionTypes";
import { PromotionModel } from "~/models/promotion.server";
import { uploadedFileToPublicUrl } from "~/lib/upload.server";
import { PRODUCTS } from "~/data/products";

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

export type BuildResult =
  | { ok: true; doc: Record<string, unknown> }
  | { ok: false; error: string; status: number };

/**
 * Construye el documento a insertar/actualizar a partir del formData del
 * formulario de promoción, validando los campos propios de cada estrategia.
 * Compartido entre crear, editar y duplicar para no repetir el switch.
 *
 * `existingId` se usa para permitir que un cupón conserve su propio código
 * al editarse (si no, "ya existe un cupón con ese código" se dispararía
 * contra sí mismo).
 */
export async function buildPromotionDocFromFormData(
  formData: FormData,
  options: { existingId?: string; existingBannerImageUrl?: string } = {},
): Promise<BuildResult> {
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
    return { ok: false, error: base.error.issues[0]?.message ?? "Datos inválidos.", status: 400 };
  }

  const { type } = base.data;

  const uploadedImageUrl = uploadedFileToPublicUrl(formData.get("bannerImage") as File | null);
  const removeImage = formData.get("removeBannerImage") === "on";
  const imageUrl = uploadedImageUrl ?? (removeImage ? "" : options.existingBannerImageUrl ?? "");

  const doc: Record<string, unknown> = {
    name: base.data.name,
    type,
    startsAt: base.data.startsAt ? new Date(base.data.startsAt) : undefined,
    endsAt: base.data.endsAt ? new Date(base.data.endsAt) : undefined,
    usageLimit: base.data.usageLimit,
    banner: {
      enabled: base.data.bannerEnabled === "on",
      text: base.data.bannerText ?? "",
      imageUrl,
      ctaText: base.data.bannerCtaText ?? "",
      ctaHref: base.data.bannerCtaHref || "/tienda",
    },
  };

  const percentage = Number(formData.get("percentage"));

  switch (type as PromotionType) {
    case "coupon": {
      const code = String(formData.get("code") ?? "").trim().toUpperCase();
      if (!code || !percentage) {
        return { ok: false, error: "El cupón necesita código y porcentaje.", status: 400 };
      }
      const exists = await PromotionModel.findOne({
        type: "coupon",
        "coupon.code": code,
        ...(options.existingId ? { _id: { $ne: options.existingId } } : {}),
      });
      if (exists) {
        return { ok: false, error: "Ya existe un cupón con ese código.", status: 409 };
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
      if (!percentage) return { ok: false, error: "Ingresa el % de descuento.", status: 400 };
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
        return { ok: false, error: "Define al menos un escalón.", status: 400 };
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
      if (!percentage) return { ok: false, error: "Ingresa el % de la venta flash.", status: 400 };
      doc.flashSale = { percentage };
      break;
    }
    case "vip_early": {
      if (!percentage) return { ok: false, error: "Ingresa el % VIP.", status: 400 };
      doc.vipEarly = { percentage, maxCustomers: base.data.usageLimit };
      break;
    }
    case "buy_together": {
      const productIds = formData.getAll("buyTogetherProductIds") as string[];
      if (productIds.length < 2 || !percentage) {
        return { ok: false, error: "Elige al menos 2 productos y un % de descuento.", status: 400 };
      }
      doc.buyTogether = { productIds, percentage };
      break;
    }
    case "loyalty": {
      const purchasesRequired = Number(formData.get("purchasesRequired") ?? 5);
      if (purchasesRequired < 2) {
        return { ok: false, error: "Define cada cuántas compras se completa un ciclo.", status: 400 };
      }

      const tierRewardTypes = formData.getAll("tierRewardType") as string[];
      const tierPercentages = formData.getAll("tierPercentage") as string[];
      const tierGiftDescriptions = formData.getAll("tierGiftDescription") as string[];

      const tiers = tierRewardTypes
        .map((rewardType, i) => {
          if (rewardType === "gift") {
            return { rewardType: "gift" as const, giftDescription: (tierGiftDescriptions[i] ?? "").trim() };
          }
          return { rewardType: "discount" as const, percentage: Number(tierPercentages[i]) || 0 };
        })
        .filter((t) => (t.rewardType === "gift" ? t.giftDescription : t.percentage > 0));

      if (tiers.length === 0) {
        return { ok: false, error: "Define al menos una recompensa (descuento o regalo).", status: 400 };
      }

      doc.loyalty = { purchasesRequired, tiers };
      break;
    }
    case "by_requirement": {
      const condition = String(formData.get("requirementCondition") ?? "product_in_cart") as
        | "product_in_cart"
        | "product_spend"
        | "first_purchase";
      const rewardDiscountPercentage = Number(formData.get("requirementRewardPercentage") ?? 0) || undefined;
      const rewardGiftSku = String(formData.get("requirementRewardGiftSku") ?? "") || undefined;

      if (!rewardDiscountPercentage && !rewardGiftSku) {
        return { ok: false, error: "Define al menos una recompensa: % de descuento o producto de regalo.", status: 400 };
      }
      if (rewardGiftSku && !(rewardGiftSku in PRODUCTS)) {
        return { ok: false, error: "El producto de regalo no es válido.", status: 400 };
      }

      const byRequirement: Record<string, unknown> = { condition, rewardDiscountPercentage, rewardGiftSku };

      if (condition !== "first_purchase") {
        const targetSku = String(formData.get("requirementTargetSku") ?? "");
        if (!targetSku || !(targetSku in PRODUCTS)) {
          return { ok: false, error: "Elige el producto o paquete requerido.", status: 400 };
        }
        byRequirement.targetSku = targetSku;

        if (condition === "product_in_cart") {
          byRequirement.minQuantity = Number(formData.get("requirementMinQuantity") ?? 1) || 1;
        } else {
          const minSpendMxn = Number(formData.get("requirementMinSpendMxn") ?? 0);
          if (!minSpendMxn) {
            return { ok: false, error: "Define el gasto mínimo requerido.", status: 400 };
          }
          byRequirement.minSpendMxn = minSpendMxn;
        }
      }

      doc.byRequirement = byRequirement;
      break;
    }
  }

  return { ok: true, doc };
}
