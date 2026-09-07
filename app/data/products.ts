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
  /** Presentación (cantidad + unidad) mostrada en la tarjeta de producto — ver ~/lib/productUnit. */
  unitValue?: number;
  unit?: string;
  /** Markdown con especificaciones técnicas, ingredientes y modo de uso — se muestra en /tienda/:sku. */
  longDescription?: string;
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
    unitValue: 1,
    unit: "L",
    longDescription: `Concentrado biotecnológico que neutraliza y degrada los residuos de orina canina desde su raíz molecular, en vez de solo enmascarar el olor.

## Ingredientes activos

- **Bacillus subtilis** — microorganismo benéfico que degrada los compuestos orgánicos de la orina.
- **Ricinoleato de zinc** — neutraliza el amoniaco responsable del mal olor y ataca el ácido úrico que daña concreto, cantera y metal.

## Rendimiento

1 litro de concentrado rinde **30 litros** de solución activa lista para usar — se diluye en tu botella Squishable con agua de la llave.

## Modo de uso

1. Agita el envase un poco antes de abrir.
2. Destapa y llena la tapa dosificadora de concentrado STOPee.
3. Vacía la tapa en tu botella Squishable de 500 ml.
4. Completa con agua de la llave y agita suavemente.
5. Rocía sobre la zona afectada después de cada paseo.

## Recomendaciones

Guarda el envase bien cerrado, lejos de la luz solar directa. Un litro te dura semanas con el uso diario recomendado de un paseo promedio.`,
  },
  squishable: {
    sku: "squishable",
    name: "Botella Squishable 500 ml",
    shortDescription: "Botella flexible ergonómica con boquilla dosificadora y clip para correa.",
    priceMxn: 249,
    image: "/images/squishable.png",
    unitValue: 1,
    unit: "pieza",
    longDescription: `Botella flexible de 500 ml diseñada para llevar tu solución STOPee ya diluida en cada paseo.

## Características

- Cuerpo squishable (compresible) para dosificar con una sola mano.
- Boquilla dosificadora que evita derrames.
- Clip integrado para engancharla a la correa o al cinturón.

## Modo de uso

1. Llena la botella con tu solución STOPee ya preparada (ver la ficha del Concentrado 1L).
2. Engancha el clip a la correa antes de salir.
3. Al detectar orina en la vía pública, aprieta suavemente para rociar la zona.
4. Al llegar a casa, enjuaga la boquilla con agua para evitar residuos secos.

Una sola botella te acompaña en decenas de paseos antes de necesitar rellenarse.`,
  },
  "pack-basico": {
    sku: "pack-basico",
    name: "Pack Básico Urbano",
    shortDescription: "1L STOPee Concentrado + 1 Botella Squishable.",
    priceMxn: 649,
    image: "/images/pack-basico.png",
    bundle: { concentradoLitros: 1, incluyeSquishable: true },
    longDescription: `El punto de entrada ideal si nunca has usado STOPee: todo lo necesario para empezar en un solo pedido.

## Incluye

- 1 L de Concentrado STOPee (Bacillus subtilis + ricinoleato de zinc) — rinde 30 L de solución activa.
- 1 Botella Squishable de 500 ml con boquilla dosificadora y clip para correa.

## Modo de uso

Diluye el concentrado en la botella Squishable siguiendo la proporción de la tapa dosificadora, completa con agua y rocía después de cada paseo. Con el rendimiento del concentrado, este pack te dura semanas antes de necesitar reabastecer.`,
  },
  "pack-duo": {
    sku: "pack-duo",
    name: "Pack Dúo Convivencia",
    shortDescription: "2L STOPee Concentrado + 1 Botella Squishable.",
    priceMxn: 1049,
    image: "/images/pack-duo.png",
    bundle: { concentradoLitros: 2, incluyeSquishable: true },
    longDescription: `Pensado para hogares con más de un perro o paseos más frecuentes: el doble de concentrado con la misma botella squishable.

## Incluye

- 2 L de Concentrado STOPee — rinde hasta 60 L de solución activa en total.
- 1 Botella Squishable de 500 ml con boquilla dosificadora y clip para correa.

## Modo de uso

Igual que el Concentrado 1L: dosifica con la tapa, diluye en la botella squishable con agua de la llave y rocía después de cada paseo. Tener 2 L de reserva evita quedarte sin producto entre resurtidos.`,
  },
  "pack-manada": {
    sku: "pack-manada",
    name: "Pack Manada / Alto Rendimiento",
    shortDescription: "3L STOPee Concentrado + 1 Botella Squishable.",
    priceMxn: 1399,
    image: "/images/pack-manada.png",
    bundle: { concentradoLitros: 3, incluyeSquishable: true },
    longDescription: `La presentación de mayor rendimiento — para manadas de varios perros, paseadores profesionales o negocios de hospedaje canino.

## Incluye

- 3 L de Concentrado STOPee — rinde hasta 90 L de solución activa en total.
- 1 Botella Squishable de 500 ml con boquilla dosificadora y clip para correa.

## Modo de uso

Mismo proceso de dilución que el Concentrado 1L. Con 3 L de reserva, este pack está pensado para minimizar la frecuencia de resurtido en operaciones con varios perros o paseos diarios múltiples.`,
  },
};

export const PRODUCT_LIST = Object.values(PRODUCTS);

// El umbral y porcentaje de lealtad ("camino a la Nª compra") ahora se
// configuran en /admin/discounts (Promotion type "loyalty") — ver
// ~/models/promotion.server.ts#getActiveLoyaltyConfig. Estos valores ya no
// se usan; se dejó SUBSCRIPTION_DISCOUNT_PERCENT porque el flujo de
// suscripción todavía no tiene su propia promoción configurable.
export const SUBSCRIPTION_DISCOUNT_PERCENT = 10;
