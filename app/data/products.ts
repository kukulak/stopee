export type ProductSku =
  | "concentrado-1l"
  | "squishable"
  | "pack-basico"
  | "pack-duo"
  | "pack-manada";

export type Product = {
  sku: ProductSku;
  name: string;
  shortDescription: string;
  priceMxn: number;
  image: string;
  bundle?: {
    concentradoLitros: number;
    incluyeSquishable: boolean;
  };
};

export const PRODUCTS: Record<ProductSku, Product> = {
  "concentrado-1l": {
    sku: "concentrado-1l",
    name: "STOPee Concentrado 1L",
    shortDescription: "Rinde 30 litros de solución activa. Bacillus subtilis + ricinoleato de zinc.",
    priceMxn: 449,
    image: "/images/concentrado-1l.png",
  },
  squishable: {
    sku: "squishable",
    name: "Botella Squishable 500 ml",
    shortDescription: "Botella flexible ergonómica con boquilla dosificadora y clip para correa.",
    priceMxn: 249,
    image: "/images/squishable.png",
  },
  "pack-basico": {
    sku: "pack-basico",
    name: "Pack Básico Urbano",
    shortDescription: "1L STOPee Concentrado + 1 Botella Squishable.",
    priceMxn: 649,
    image: "/images/pack-basico.png",
    bundle: { concentradoLitros: 1, incluyeSquishable: true },
  },
  "pack-duo": {
    sku: "pack-duo",
    name: "Pack Dúo Convivencia",
    shortDescription: "2L STOPee Concentrado + 1 Botella Squishable.",
    priceMxn: 1049,
    image: "/images/pack-duo.png",
    bundle: { concentradoLitros: 2, incluyeSquishable: true },
  },
  "pack-manada": {
    sku: "pack-manada",
    name: "Pack Manada / Alto Rendimiento",
    shortDescription: "3L STOPee Concentrado + 1 Botella Squishable.",
    priceMxn: 1399,
    image: "/images/pack-manada.png",
    bundle: { concentradoLitros: 3, incluyeSquishable: true },
  },
};

export const PRODUCT_LIST = Object.values(PRODUCTS);

// El umbral y porcentaje de lealtad ("camino a la Nª compra") ahora se
// configuran en /admin/discounts (Promotion type "loyalty") — ver
// ~/models/promotion.server.ts#getActiveLoyaltyConfig. Estos valores ya no
// se usan; se dejó SUBSCRIPTION_DISCOUNT_PERCENT porque el flujo de
// suscripción todavía no tiene su propia promoción configurable.
export const SUBSCRIPTION_DISCOUNT_PERCENT = 10;
