import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOME_ORDER,
  HOME_BLOCKS,
  HOME_BLOCK_TYPES,
  defaultHomeBlocks,
  parseHomeBlocksPayload,
  resolveHomeBlocks,
  serializeHomeBlocks,
} from "~/lib/homeBlocks";

const payloadOf = (blocks: unknown) => JSON.stringify(blocks);

describe("portada: bloques de fábrica", () => {
  it("el orden de fábrica incluye cada bloque exactamente una vez", () => {
    expect([...DEFAULT_HOME_ORDER].sort()).toEqual([...HOME_BLOCK_TYPES].sort());
  });

  it("el paquete para empezar va justo después del banner y la confianza antes que el blog", () => {
    const order = defaultHomeBlocks().map((b) => b.type);
    expect(order.slice(0, 2)).toEqual(["banner", "start"]);
    expect(order.indexOf("testimonials")).toBeLessThan(order.indexOf("blog"));
  });

  it("los bloques nuevos nacen apagados para que la portada no cambie sola", () => {
    const enabled = Object.fromEntries(defaultHomeBlocks().map((b) => [b.type, b.enabled]));
    expect(enabled).toMatchObject({ banner: true, start: true, identity: true, testimonials: true, blog: true });
    expect(enabled.steps).toBe(false);
    expect(enabled.cta).toBe(false);
  });

  it("cada campo tiene su texto de fábrica y los obligatorios no están vacíos", () => {
    for (const def of Object.values(HOME_BLOCKS)) {
      for (const field of def.groups.flatMap((g) => g.fields)) {
        expect(def.defaults, `${def.type}.${field.key}`).toHaveProperty(field.key);
        if (field.required) expect(def.defaults[field.key], `${def.type}.${field.key}`).not.toBe("");
        expect(def.defaults[field.key].length, `${def.type}.${field.key}`).toBeLessThanOrEqual(field.max);
      }
    }
  });
});

describe("portada: lo guardado se completa y se limpia", () => {
  it("sin nada guardado, da la portada de fábrica", () => {
    expect(resolveHomeBlocks(undefined)).toEqual(defaultHomeBlocks());
    expect(resolveHomeBlocks([])).toEqual(defaultHomeBlocks());
    expect(resolveHomeBlocks("basura")).toEqual(defaultHomeBlocks());
  });

  it("respeta el orden guardado y agrega al final los bloques que faltan", () => {
    const blocks = resolveHomeBlocks([
      { type: "testimonials", enabled: true, content: {} },
      { type: "banner", enabled: true, content: {} },
    ]);
    const order = blocks.map((b) => b.type);
    expect(order.slice(0, 2)).toEqual(["testimonials", "banner"]);
    expect(order).toHaveLength(HOME_BLOCK_TYPES.length);
    expect(new Set(order).size).toBe(HOME_BLOCK_TYPES.length);
  });

  it("completa con el texto de fábrica lo que no se guardó, pero respeta un texto vaciado a propósito", () => {
    const [start] = resolveHomeBlocks([{ type: "start", enabled: true, content: { badge: "", buttonLabel: "Lo quiero" } }]);
    expect(start.content.badge).toBe("");
    expect(start.content.buttonLabel).toBe("Lo quiero");
    expect(start.content.title).toBe(HOME_BLOCKS.start.defaults.title);
  });

  it("ignora bloques desconocidos o repetidos y campos que no existen", () => {
    const blocks = resolveHomeBlocks([
      { type: "inventado", enabled: true, content: {} },
      { type: "blog", enabled: false, content: { title: "Primero", campoFalso: "x" } },
      { type: "blog", enabled: true, content: { title: "Repetido" } },
    ]);
    const blogs = blocks.filter((b) => b.type === "blog");
    expect(blogs).toHaveLength(1);
    expect(blogs[0].enabled).toBe(false);
    expect(blogs[0].content.title).toBe("Primero");
    expect(blogs[0].content).not.toHaveProperty("campoFalso");
    expect(blocks.some((b) => (b.type as string) === "inventado")).toBe(false);
  });

  it("recorta lo que excede el máximo y quita caracteres de control", () => {
    const [blog] = resolveHomeBlocks([
      { type: "blog", enabled: true, content: { title: `Hola\u0000 mundo${"x".repeat(500)}` } },
    ]);
    expect(blog.content.title.length).toBeLessThanOrEqual(100);
    expect(blog.content.title.startsWith("Hola mundo")).toBe(true);
  });
});

describe("portada: lo que manda el panel al guardar", () => {
  const valid = () => defaultHomeBlocks();

  it("acepta la portada de fábrica y devuelve los mismos bloques", () => {
    const result = parseHomeBlocksPayload(payloadOf(valid()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(serializeHomeBlocks(result.blocks)).toBe(serializeHomeBlocks(valid()));
  });

  it("acepta cambiar el orden, apagar bloques y editar textos", () => {
    const blocks = valid().reverse();
    blocks.find((b) => b.type === "cta")!.enabled = true;
    blocks.find((b) => b.type === "identity")!.content.title = "  Un título   nuevo ";
    const result = parseHomeBlocksPayload(payloadOf(blocks));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks[0].type).toBe("cta");
    expect(result.blocks.find((b) => b.type === "cta")!.enabled).toBe(true);
    expect(result.blocks.find((b) => b.type === "identity")!.content.title).toBe("Un título nuevo");
  });

  it("rechaza texto ilegible o que no es una lista", () => {
    expect(parseHomeBlocksPayload("{no es json").ok).toBe(false);
    expect(parseHomeBlocksPayload(payloadOf({ type: "blog" })).ok).toBe(false);
    expect(parseHomeBlocksPayload(null).ok).toBe(false);
  });

  it("rechaza bloques repetidos, desconocidos o faltantes", () => {
    const base = valid();
    expect(parseHomeBlocksPayload(payloadOf([...base, base[0]])).ok).toBe(false);
    expect(parseHomeBlocksPayload(payloadOf([...base, { type: "x", enabled: true, content: {} }])).ok).toBe(false);
    expect(parseHomeBlocksPayload(payloadOf(base.slice(1))).ok).toBe(false);
  });

  it("no deja vacío un texto obligatorio y dice cuál", () => {
    const blocks = valid();
    blocks.find((b) => b.type === "start")!.content.title = "   ";
    const result = parseHomeBlocksPayload(payloadOf(blocks));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Empieza con tu paquete");
  });

  it("deja vaciar un texto opcional (esa parte simplemente no se muestra)", () => {
    const blocks = valid();
    blocks.find((b) => b.type === "identity")!.content.eyebrow = "";
    const result = parseHomeBlocksPayload(payloadOf(blocks));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.blocks.find((b) => b.type === "identity")!.content.eyebrow).toBe("");
  });

  it("rechaza un texto más largo que el máximo", () => {
    const blocks = valid();
    blocks.find((b) => b.type === "blog")!.content.title = "x".repeat(101);
    expect(parseHomeBlocksPayload(payloadOf(blocks)).ok).toBe(false);
  });

  it.each(["javascript:alert(1)", "//sitio-falso.com", "http://inseguro.com", "/con espacio"])(
    "rechaza el destino de botón peligroso %s",
    (href) => {
      const blocks = valid();
      blocks.find((b) => b.type === "cta")!.content.buttonHref = href;
      expect(parseHomeBlocksPayload(payloadOf(blocks)).ok).toBe(false);
    },
  );

  it("acepta rutas del sitio y https, y un destino vacío vuelve al de fábrica", () => {
    const blocks = valid();
    const cta = blocks.find((b) => b.type === "cta")!;
    cta.content.buttonHref = "/tienda#paquetes";
    expect(parseHomeBlocksPayload(payloadOf(blocks)).ok).toBe(true);
    cta.content.buttonHref = "https://stopee.com.mx/blog";
    expect(parseHomeBlocksPayload(payloadOf(blocks)).ok).toBe(true);
    cta.content.buttonHref = "";
    const result = parseHomeBlocksPayload(payloadOf(blocks));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.blocks.find((b) => b.type === "cta")!.content.buttonHref).toBe("/tienda");
  });

  it("un enabled que no es exactamente true cuenta como apagado", () => {
    const blocks = valid().map((b) => ({ ...b, enabled: "true" }));
    const result = parseHomeBlocksPayload(payloadOf(blocks));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.blocks.every((b) => !b.enabled)).toBe(true);
  });
});
