import { LINK_TARGET_ERROR, normalizeLinkTarget } from "~/lib/inputValidation";

/**
 * La portada se arma con bloques. Cada bloque tiene un tipo fijo (qué es y cómo se ve), pero su
 * orden, si se muestra y sus textos se guardan en la base de datos y se editan en /admin/inicio,
 * sin volver a subir el sitio. Este archivo es la lista de bloques posibles, sus textos por
 * defecto y las reglas de validación; lo usan la portada, el panel y las pruebas.
 *
 * Los textos que se guardan son solo los que el panel haya cambiado: lo que falte se completa con
 * los de aquí, así que agregar un campo nuevo en el futuro no rompe lo ya guardado.
 */

export const HOME_BLOCK_TYPES = ["banner", "start", "identity", "steps", "testimonials", "blog", "cta"] as const;
export type HomeBlockType = (typeof HOME_BLOCK_TYPES)[number];

/** text = una línea; textarea = varias; link = ruta del sitio o https://; product = producto o paquete del catálogo. */
export type HomeFieldKind = "text" | "textarea" | "link" | "product";

export type HomeField = {
  key: string;
  label: string;
  kind: HomeFieldKind;
  max: number;
  /** Los obligatorios no pueden quedar vacíos; los demás, si se vacían, simplemente no se muestran. */
  required?: boolean;
  hint?: string;
};

export type HomeFieldGroup = { title: string; fields: HomeField[] };

export type HomeBlockDef = {
  type: HomeBlockType;
  /** Nombre que ve quien administra. */
  name: string;
  description: string;
  /** Los bloques nuevos nacen apagados para que la portada no cambie sola. */
  defaultEnabled: boolean;
  defaults: Record<string, string>;
  groups: HomeFieldGroup[];
  /** Bloques cuyo contenido se edita en otra pantalla. */
  editElsewhere?: { to: string; label: string };
};

const text = (key: string, label: string, max: number, extra: Partial<HomeField> = {}): HomeField => ({
  key,
  label,
  kind: "text",
  max,
  ...extra,
});
const textarea = (key: string, label: string, max: number, extra: Partial<HomeField> = {}): HomeField => ({
  key,
  label,
  kind: "textarea",
  max,
  ...extra,
});

export const HOME_BLOCKS: Record<HomeBlockType, HomeBlockDef> = {
  banner: {
    type: "banner",
    name: "Banner principal",
    description: "La primera imagen o mensaje de la portada. Si no hay un banner activo para Inicio, se muestra uno por defecto.",
    defaultEnabled: true,
    defaults: {},
    groups: [],
    editElsewhere: { to: "/admin/banners", label: "Editar el banner en Banners" },
  },

  start: {
    type: "start",
    name: "Empieza con tu paquete",
    description: "El producto o paquete destacado con su precio y botón de compra, y la tarjeta de suscripción.",
    defaultEnabled: true,
    defaults: {
      title: "Empieza con tu paquete inicial",
      linkLabel: "Ver todo el catálogo",
      badge: "Recomendado para empezar",
      featuredSku: "",
      buttonLabel: "Comprar ahora",
      subTitle: "¿Ya sabes cuánto te dura tu litro?",
      subText: "",
      subButton: "Configurar suscripción",
    },
    groups: [
      {
        title: "Producto destacado",
        fields: [
          text("title", "Título de la sección", 80, { required: true }),
          text("linkLabel", "Texto del enlace al catálogo", 40),
          text("badge", "Etiqueta sobre el producto", 40),
          {
            key: "featuredSku",
            label: "Producto o paquete a destacar",
            kind: "product",
            max: 60,
            hint: "En automático se muestra el primer paquete del catálogo.",
          },
          text("buttonLabel", "Texto del botón de compra", 30, { required: true }),
        ],
      },
      {
        title: "Tarjeta de suscripción",
        fields: [
          text("subTitle", "Título", 80, { hint: "Si lo dejas vacío, la tarjeta no se muestra." }),
          textarea("subText", "Texto", 240, {
            hint: "Vacío = texto automático con tu descuento y frecuencias de suscripción.",
          }),
          text("subButton", "Texto del botón", 40),
        ],
      },
    ],
  },

  identity: {
    type: "identity",
    name: "Identidad y beneficios",
    description: "Sección oscura que explica por qué importa: un mensaje principal y tres tarjetas de beneficios.",
    defaultEnabled: true,
    defaults: {
      eyebrow: "El nuevo estándar cívico",
      title: "Recoger la popó ya es costumbre. Ahora toca limpiar la pipí.",
      body: "La cultura ciudadana adoptó exitosamente la recolección de heces. El siguiente paso lógico de la convivencia comunitaria es atender las manchas y olores de la orina en fachadas, banquetas y postes.",
      card1Title: "Para ti y tu perro",
      card1Text: "Paseos agradables, sin malos olores retenidos en arneses, calzado o ropa.",
      card2Title: "Para tus vecinos y comercios",
      card2Text: "Fachadas preservadas, calles ventiladas y banquetas seguras para todos.",
      card3Title: "Para la ciudad",
      card3Text: "Conservación del mobiliario urbano y microbiología activa benéfica.",
    },
    groups: [
      {
        title: "Mensaje principal",
        fields: [
          text("eyebrow", "Frase pequeña sobre el título", 60),
          text("title", "Título", 140, { required: true }),
          textarea("body", "Párrafo", 400),
        ],
      },
      ...[1, 2, 3].map((n) => ({
        title: `Tarjeta ${n}`,
        fields: [
          text(`card${n}Title`, "Título", 60, { hint: n === 1 ? "Si lo dejas vacío, la tarjeta no se muestra." : undefined }),
          textarea(`card${n}Text`, "Texto", 200),
        ],
      })),
    ],
  },

  steps: {
    type: "steps",
    name: "Cómo se usa en 3 pasos",
    description: "Tres pasos cortos que muestran lo fácil que es usarlo. Nace apagado; enciéndelo cuando quieras probarlo.",
    defaultEnabled: false,
    defaults: {
      eyebrow: "Así se usa",
      title: "Tres pasos y listo",
      step1Title: "Dosifica y diluye",
      step1Text: "1 tapita del concentrado por cada 500 ml de agua. Un litro rinde 30 litros.",
      step2Title: "Aplica con chorro directo",
      step2Text: "Directo sobre la orina en banquetas, cantera, adoquín o postes.",
      step3Title: "Deja que actúe",
      step3Text: "Sin tallar ni enjuagar: la fórmula penetra, degrada y se seca sola.",
      linkLabel: "Ver cómo funciona",
    },
    groups: [
      {
        title: "Encabezado",
        fields: [text("eyebrow", "Frase pequeña sobre el título", 60), text("title", "Título", 100, { required: true })],
      },
      ...[1, 2, 3].map((n) => ({
        title: `Paso ${n}`,
        fields: [
          text(`step${n}Title`, "Título", 60, { hint: n === 1 ? "Si lo dejas vacío, el paso no se muestra." : undefined }),
          textarea(`step${n}Text`, "Texto", 200),
        ],
      })),
      { title: "Enlace", fields: [text("linkLabel", "Texto del enlace a «Cómo funciona»", 40)] },
    ],
  },

  testimonials: {
    type: "testimonials",
    name: "Testimonios",
    description: "Lo que dicen los clientes (se editan en Testimonios). Sin testimonios publicados, la sección no aparece.",
    defaultEnabled: true,
    defaults: {
      eyebrow: "Lo que dicen quienes ya lo usan",
      title: "Clientes reales, resultados reales",
    },
    groups: [
      {
        title: "Encabezado",
        fields: [text("eyebrow", "Frase pequeña sobre el título", 60), text("title", "Título", 100, { required: true })],
      },
    ],
    editElsewhere: { to: "/admin/testimonials", label: "Editar los testimonios en Testimonios" },
  },

  blog: {
    type: "blog",
    name: "Blog",
    description: "Los tres artículos más recientes del blog. Sin artículos publicados, la sección no aparece.",
    defaultEnabled: true,
    defaults: {
      eyebrow: "Blog cívico",
      title: "Convivencia urbana, un hábito a la vez",
      linkLabel: "Ver todos los artículos",
    },
    groups: [
      {
        title: "Encabezado",
        fields: [
          text("eyebrow", "Frase pequeña sobre el título", 60),
          text("title", "Título", 100, { required: true }),
          text("linkLabel", "Texto del enlace al blog", 40),
        ],
      },
    ],
  },

  cta: {
    type: "cta",
    name: "Llamado final",
    description: "Un último mensaje con un botón, para quien llegó hasta abajo. Nace apagado.",
    defaultEnabled: false,
    defaults: {
      title: "Hagamos de tu calle un mejor lugar para pasear",
      text: "Un litro de concentrado rinde 30 litros de solución lista para usar.",
      buttonLabel: "Ver la tienda",
      buttonHref: "/tienda",
    },
    groups: [
      {
        title: "Mensaje y botón",
        fields: [
          text("title", "Título", 100, { required: true }),
          textarea("text", "Texto de apoyo", 200),
          text("buttonLabel", "Texto del botón", 30, { required: true }),
          {
            key: "buttonHref",
            label: "Destino del botón",
            kind: "link",
            max: 200,
            hint: 'Una ruta del sitio (por ejemplo "/tienda") o una dirección https://.',
          },
        ],
      },
    ],
  },
};

export type HomeBlockState = {
  type: HomeBlockType;
  enabled: boolean;
  content: Record<string, string>;
};

export function isHomeBlockType(value: unknown): value is HomeBlockType {
  return typeof value === "string" && (HOME_BLOCK_TYPES as readonly string[]).includes(value);
}

/**
 * Orden de fábrica: banner, luego el paquete para empezar (quien quiere comprar ya lo tiene a la
 * mano), luego la explicación, y después la confianza (testimonios) y el blog. Los bloques nuevos
 * van al final y apagados.
 */
export const DEFAULT_HOME_ORDER: readonly HomeBlockType[] = [
  "banner",
  "start",
  "identity",
  "testimonials",
  "blog",
  "steps",
  "cta",
];

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Limpia un texto: sin caracteres de control y, si es de una línea, sin saltos. */
function cleanText(value: string, multiline: boolean): string {
  const noControl = value.replace(CONTROL_CHARS, "").replace(/\r\n?/g, "\n");
  return (multiline ? noControl.replace(/\n{3,}/g, "\n\n") : noControl.replace(/\s+/g, " ")).trim();
}

function allFields(def: HomeBlockDef): HomeField[] {
  return def.groups.flatMap((g) => g.fields);
}

function defaultBlock(type: HomeBlockType): HomeBlockState {
  const def = HOME_BLOCKS[type];
  return { type, enabled: def.defaultEnabled, content: { ...def.defaults } };
}

/** La portada de fábrica: todos los bloques en su orden, textos y estado originales. */
export function defaultHomeBlocks(): HomeBlockState[] {
  return DEFAULT_HOME_ORDER.map(defaultBlock);
}

/**
 * Convierte lo guardado en la base (que puede estar vacío, incompleto o venir de una versión
 * anterior) en la lista completa de bloques lista para mostrar: ignora lo desconocido o repetido,
 * completa con los textos de fábrica y agrega al final los bloques que aún no estaban guardados.
 */
export function resolveHomeBlocks(stored: unknown): HomeBlockState[] {
  const result: HomeBlockState[] = [];
  const seen = new Set<HomeBlockType>();

  if (Array.isArray(stored)) {
    for (const entry of stored) {
      if (!entry || typeof entry !== "object") continue;
      const raw = entry as { type?: unknown; enabled?: unknown; content?: unknown };
      if (!isHomeBlockType(raw.type) || seen.has(raw.type)) continue;
      seen.add(raw.type);

      const def = HOME_BLOCKS[raw.type];
      const savedContent = raw.content && typeof raw.content === "object" ? (raw.content as Record<string, unknown>) : {};
      const content: Record<string, string> = {};
      for (const field of allFields(def)) {
        const value = savedContent[field.key];
        content[field.key] =
          typeof value === "string"
            ? cleanText(value, field.kind === "textarea").slice(0, field.max)
            : def.defaults[field.key] ?? "";
      }
      result.push({ type: raw.type, enabled: typeof raw.enabled === "boolean" ? raw.enabled : def.defaultEnabled, content });
    }
  }

  for (const type of DEFAULT_HOME_ORDER) {
    if (!seen.has(type)) result.push(defaultBlock(type));
  }
  return result;
}

/** Forma canónica (para comparar si hubo cambios sin guardar). */
export function serializeHomeBlocks(blocks: HomeBlockState[]): string {
  return JSON.stringify(
    blocks.map((b) => ({
      type: b.type,
      enabled: b.enabled,
      content: Object.fromEntries(allFields(HOME_BLOCKS[b.type]).map((f) => [f.key, b.content[f.key] ?? ""])),
    })),
  );
}

export type ParsedHomeBlocks = { ok: true; blocks: HomeBlockState[] } | { ok: false; error: string };

/**
 * Valida lo que manda el panel al guardar. Es estricto: debe venir cada bloque exactamente una
 * vez, los textos obligatorios llenos y los destinos de botones válidos. Los errores nombran el
 * bloque y el campo para que se vea qué corregir.
 */
export function parseHomeBlocksPayload(raw: unknown): ParsedHomeBlocks {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? ""));
  } catch {
    return { ok: false, error: "No se pudo leer lo que enviaste. Recarga la página e inténtalo de nuevo." };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: "No se pudo leer lo que enviaste. Recarga la página e inténtalo de nuevo." };

  const blocks: HomeBlockState[] = [];
  const seen = new Set<HomeBlockType>();

  for (const entry of parsed) {
    const item = entry as { type?: unknown; enabled?: unknown; content?: unknown } | null;
    if (!item || typeof item !== "object" || !isHomeBlockType(item.type)) {
      return { ok: false, error: "Hay un bloque desconocido. Recarga la página e inténtalo de nuevo." };
    }
    if (seen.has(item.type)) return { ok: false, error: "Hay un bloque repetido. Recarga la página e inténtalo de nuevo." };
    seen.add(item.type);

    const def = HOME_BLOCKS[item.type];
    const sent = item.content && typeof item.content === "object" ? (item.content as Record<string, unknown>) : {};
    const content: Record<string, string> = {};

    for (const field of allFields(def)) {
      const value = cleanText(typeof sent[field.key] === "string" ? (sent[field.key] as string) : "", field.kind === "textarea");

      if (value.length > field.max) {
        return { ok: false, error: `«${def.name}» → ${field.label}: máximo ${field.max} caracteres (tiene ${value.length}).` };
      }
      if (field.required && !value) {
        return { ok: false, error: `«${def.name}» → ${field.label}: no puede quedar vacío.` };
      }
      if (field.kind === "link") {
        if (!value) {
          content[field.key] = def.defaults[field.key] ?? "/tienda";
          continue;
        }
        const target = normalizeLinkTarget(value);
        if (!target) return { ok: false, error: `«${def.name}» → ${field.label}: ${LINK_TARGET_ERROR}` };
        content[field.key] = target;
        continue;
      }
      content[field.key] = value;
    }

    blocks.push({ type: item.type, enabled: item.enabled === true, content });
  }

  if (seen.size !== HOME_BLOCK_TYPES.length) {
    return { ok: false, error: "Falta algún bloque en lo que enviaste. Recarga la página e inténtalo de nuevo." };
  }
  return { ok: true, blocks };
}
