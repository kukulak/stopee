import { useState } from "react";
import { PROMOTION_TYPES, type PromotionType } from "~/data/promotionTypes";
import { PRODUCT_LIST } from "~/data/products";

export const TYPE_LABELS: Record<PromotionType, string> = {
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
  by_requirement: "Por requisito",
};

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

function toDateInputValue(value?: string | Date | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export type PromotionDefaults = {
  name?: string;
  type?: PromotionType;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  usageLimit?: number | null;
  coupon?: { code?: string; percentage?: number } | null;
  bogo?: { buyQuantity?: number; getQuantity?: number; getDiscountPercentage?: number; applicableSku?: string } | null;
  freeGift?: { minSpendMxn?: number; giftProduct?: string } | null;
  newCustomer?: { percentage?: number } | null;
  tieredSpend?: { tiers?: { minSpendMxn: number; percentage: number }[] } | null;
  custom?: { percentage?: number | null; description?: string } | null;
  flashSale?: { percentage?: number } | null;
  vipEarly?: { percentage?: number; maxCustomers?: number | null } | null;
  buyTogether?: { productIds?: string[]; percentage?: number } | null;
  loyalty?: { purchasesRequired?: number; percentage?: number } | null;
  byRequirement?: {
    condition?: "product_in_cart" | "product_spend" | "first_purchase";
    targetSku?: string;
    minQuantity?: number | null;
    minSpendMxn?: number | null;
    rewardDiscountPercentage?: number | null;
    rewardGiftSku?: string;
  } | null;
  banner?: { enabled?: boolean; text?: string; ctaText?: string; ctaHref?: string; imageUrl?: string } | null;
};

/**
 * Campos específicos por estrategia, compartidos entre el formulario de
 * creación y el de edición — el `type` inicial viene de `defaults` y solo
 * cambia si el admin lo cambia (editar el tipo de una promo existente no
 * suele tener sentido, pero no lo bloqueamos).
 */
export function PromotionFormFields({
  products,
  defaults,
}: {
  products: { id: string; name: string }[];
  defaults?: PromotionDefaults;
}) {
  const [type, setType] = useState<PromotionType>(defaults?.type ?? "coupon");
  const tiers = defaults?.tieredSpend?.tiers ?? [];
  const selectedBuyTogether = new Set(defaults?.buyTogether?.productIds ?? []);
  const [requirementCondition, setRequirementCondition] = useState<"product_in_cart" | "product_spend" | "first_purchase">(
    defaults?.byRequirement?.condition ?? "product_in_cart",
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nombre interno" htmlFor="name">
          <input id="name" name="name" required defaultValue={defaults?.name} placeholder="Descuento lanzamiento" className={inputClass} />
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

      {type === "coupon" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Código" htmlFor="code">
            <input id="code" name="code" required defaultValue={defaults?.coupon?.code} placeholder="BIENVENIDA10" className={`${inputClass} uppercase`} />
          </Field>
          <Field label="% de descuento" htmlFor="percentage">
            <input id="percentage" name="percentage" type="number" min={1} max={100} required defaultValue={defaults?.coupon?.percentage} className={inputClass} />
          </Field>
        </div>
      )}

      {type === "bogo" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field label="Compra (cantidad)" htmlFor="buyQuantity">
            <input id="buyQuantity" name="buyQuantity" type="number" min={1} defaultValue={defaults?.bogo?.buyQuantity ?? 1} className={inputClass} />
          </Field>
          <Field label="Llévate (cantidad)" htmlFor="getQuantity">
            <input id="getQuantity" name="getQuantity" type="number" min={1} defaultValue={defaults?.bogo?.getQuantity ?? 1} className={inputClass} />
          </Field>
          <Field label="% desc. en el regalo" htmlFor="getDiscountPercentage">
            <input id="getDiscountPercentage" name="getDiscountPercentage" type="number" min={1} max={100} defaultValue={defaults?.bogo?.getDiscountPercentage ?? 100} className={inputClass} />
          </Field>
          <Field label="SKU aplicable" htmlFor="applicableSku">
            <input id="applicableSku" name="applicableSku" defaultValue={defaults?.bogo?.applicableSku} placeholder="concentrado-1l" className={inputClass} />
          </Field>
        </div>
      )}

      {type === "free_gift" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Gasto mínimo (MXN)" htmlFor="minSpendMxn">
            <input id="minSpendMxn" name="minSpendMxn" type="number" min={0} required defaultValue={defaults?.freeGift?.minSpendMxn} className={inputClass} />
          </Field>
          <Field label="Producto de regalo" htmlFor="giftProductId">
            <select id="giftProductId" name="giftProductId" required defaultValue={defaults?.freeGift?.giftProduct ?? ""} className={inputClass}>
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
          <input id="percentage" name="percentage" type="number" min={1} max={100} required defaultValue={defaults?.newCustomer?.percentage} className={inputClass} />
        </Field>
      )}

      {type === "tiered_spend" && (
        <div>
          <p className="text-sm font-semibold text-carbon">Escalones (deja en 0 los que no uses)</p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="rounded-xl border border-carbon/10 p-3">
                <p className="text-xs font-semibold text-carbon/50">Escalón {n}</p>
                <input name={`tier${n}MinSpend`} type="number" min={0} defaultValue={tiers[n - 1]?.minSpendMxn} placeholder="Gasto mín. MXN" className={inputClass} />
                <input name={`tier${n}Percentage`} type="number" min={0} max={100} defaultValue={tiers[n - 1]?.percentage} placeholder="% descuento" className={inputClass} />
              </div>
            ))}
          </div>
        </div>
      )}

      {type === "custom" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="% de descuento (opcional)" htmlFor="percentage">
            <input id="percentage" name="percentage" type="number" min={1} max={100} defaultValue={defaults?.custom?.percentage ?? undefined} className={inputClass} />
          </Field>
          <Field label="Descripción" htmlFor="description">
            <input id="description" name="description" defaultValue={defaults?.custom?.description} placeholder="Descripción de la promo" className={inputClass} />
          </Field>
        </div>
      )}

      {type === "flash_sale" && (
        <Field label="% de descuento" htmlFor="percentage">
          <input id="percentage" name="percentage" type="number" min={1} max={100} required defaultValue={defaults?.flashSale?.percentage} className={inputClass} />
        </Field>
      )}

      {type === "vip_early" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="% de descuento" htmlFor="percentage">
            <input id="percentage" name="percentage" type="number" min={1} max={100} required defaultValue={defaults?.vipEarly?.percentage} className={inputClass} />
          </Field>
          <Field label="Primeros N compradores" htmlFor="usageLimit">
            <input id="usageLimit" name="usageLimit" type="number" min={1} placeholder="100" defaultValue={defaults?.vipEarly?.maxCustomers ?? undefined} className={inputClass} />
          </Field>
        </div>
      )}

      {type === "buy_together" && (
        <div>
          <Field label="% de descuento" htmlFor="percentage">
            <input id="percentage" name="percentage" type="number" min={1} max={100} required defaultValue={defaults?.buyTogether?.percentage} className={inputClass} />
          </Field>
          <p className="mt-3 text-sm font-semibold text-carbon">Productos incluidos (elige 2 o más)</p>
          <div className="mt-2 flex flex-col gap-1">
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm text-carbon">
                <input
                  type="checkbox"
                  name="buyTogetherProductIds"
                  value={p.id}
                  defaultChecked={selectedBuyTogether.has(p.id)}
                  className="h-5 w-5 accent-lima"
                />
                {p.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {type === "loyalty" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Cada cuántas compras" htmlFor="purchasesRequired">
            <input id="purchasesRequired" name="purchasesRequired" type="number" min={2} defaultValue={defaults?.loyalty?.purchasesRequired ?? 5} required className={inputClass} />
          </Field>
          <Field label="% de descuento permanente" htmlFor="percentage">
            <input id="percentage" name="percentage" type="number" min={1} max={100} defaultValue={defaults?.loyalty?.percentage ?? 10} required className={inputClass} />
          </Field>
          <p className="text-xs text-carbon/50 sm:col-span-2">
            Esto controla el "camino a la Nª compra": activa esta promoción y el dashboard/tienda
            usarán el número y porcentaje que definas aquí.
          </p>
        </div>
      )}

      {type === "by_requirement" && (
        <div className="flex flex-col gap-4">
          <Field label="Condición" htmlFor="requirementCondition">
            <select
              id="requirementCondition"
              name="requirementCondition"
              value={requirementCondition}
              onChange={(e) => setRequirementCondition(e.target.value as typeof requirementCondition)}
              className={inputClass}
            >
              <option value="product_in_cart">Tiene cierto producto o paquete en el carrito</option>
              <option value="product_spend">Gasta cierto monto en un producto o paquete</option>
              <option value="first_purchase">Es su primera compra</option>
            </select>
          </Field>

          {requirementCondition !== "first_purchase" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Producto o paquete requerido" htmlFor="requirementTargetSku">
                <select
                  id="requirementTargetSku"
                  name="requirementTargetSku"
                  required
                  defaultValue={defaults?.byRequirement?.targetSku ?? ""}
                  className={inputClass}
                >
                  <option value="">Selecciona...</option>
                  {PRODUCT_LIST.map((item) => (
                    <option key={item.sku} value={item.sku}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              {requirementCondition === "product_in_cart" ? (
                <Field label="Cantidad mínima" htmlFor="requirementMinQuantity">
                  <input
                    id="requirementMinQuantity"
                    name="requirementMinQuantity"
                    type="number"
                    min={1}
                    defaultValue={defaults?.byRequirement?.minQuantity ?? 1}
                    className={inputClass}
                  />
                </Field>
              ) : (
                <Field label="Gasto mínimo (MXN)" htmlFor="requirementMinSpendMxn">
                  <input
                    id="requirementMinSpendMxn"
                    name="requirementMinSpendMxn"
                    type="number"
                    min={0}
                    defaultValue={defaults?.byRequirement?.minSpendMxn ?? undefined}
                    className={inputClass}
                  />
                </Field>
              )}
            </div>
          )}

          <div className="rounded-xl border border-carbon/10 p-3">
            <p className="text-sm font-semibold text-carbon">Recompensa (define al menos una)</p>
            <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="% de descuento (opcional)" htmlFor="requirementRewardPercentage">
                <input
                  id="requirementRewardPercentage"
                  name="requirementRewardPercentage"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={defaults?.byRequirement?.rewardDiscountPercentage ?? undefined}
                  className={inputClass}
                />
              </Field>
              <Field label="Producto de regalo (opcional)" htmlFor="requirementRewardGiftSku">
                <select
                  id="requirementRewardGiftSku"
                  name="requirementRewardGiftSku"
                  defaultValue={defaults?.byRequirement?.rewardGiftSku ?? ""}
                  className={inputClass}
                >
                  <option value="">Sin regalo</option>
                  {PRODUCT_LIST.map((item) => (
                    <option key={item.sku} value={item.sku}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Inicia (opcional)" htmlFor="startsAt">
          <input id="startsAt" name="startsAt" type="date" defaultValue={toDateInputValue(defaults?.startsAt)} className={inputClass} />
        </Field>
        <Field label="Termina (opcional)" htmlFor="endsAt">
          <input id="endsAt" name="endsAt" type="date" defaultValue={toDateInputValue(defaults?.endsAt)} className={inputClass} />
        </Field>
      </div>

      <div className="rounded-2xl border border-carbon/10 p-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-carbon">
          <input type="checkbox" name="bannerEnabled" defaultChecked={defaults?.banner?.enabled} className="h-5 w-5 accent-lima" />
          Mostrar banner en el hero de la tienda
        </label>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input name="bannerText" defaultValue={defaults?.banner?.text} placeholder="Texto del banner" className={inputClass} />
          <input name="bannerCtaText" defaultValue={defaults?.banner?.ctaText} placeholder="Texto del botón (opcional)" className={inputClass} />
          <input name="bannerCtaHref" defaultValue={defaults?.banner?.ctaHref} placeholder="/tienda" className={inputClass} />
          <div>
            <input name="bannerImage" type="file" accept="image/*" className={inputClass} />
            {defaults?.banner?.imageUrl && (
              <div className="mt-2 flex items-center gap-2">
                <img src={defaults.banner.imageUrl} alt="" className="h-12 w-20 rounded-lg object-cover" />
                <label className="flex items-center gap-1 text-xs text-carbon/60">
                  <input type="checkbox" name="removeBannerImage" className="h-4 w-4 accent-red-500" />
                  Quitar imagen actual
                </label>
              </div>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-carbon/50">
          Sube una imagen para el fondo del banner, o déjala vacía para un banner solo de texto.
        </p>
      </div>
    </>
  );
}
