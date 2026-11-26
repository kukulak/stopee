import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { firstNameOf } from "~/lib/names";
import { describeLoyaltyReward, resolveLoyaltyTier } from "~/lib/loyalty";
import { BrandText } from "~/components/ui/BrandText";
import { buildOgMeta, DEFAULT_OG_IMAGE } from "~/lib/seo";
import { DEFAULT_SUBSCRIPTION_CONFIG } from "~/lib/subscriptionConfig";
import { DEFAULT_GATE_COPY } from "~/lib/passwordGateCopy";

function sourceFiles(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith("._")) return []; // archivos fantasma de macOS en discos externos
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path, extensions);
    return extensions.some((ext) => name.endsWith(ext)) ? [path] : [];
  });
}

describe("saludo con el primer nombre", () => {
  it("usa solo el primer nombre, sin apellidos", () => {
    expect(firstNameOf("Christian Valderrama")).toBe("Christian");
    expect(firstNameOf("  Ana   María  López ")).toBe("Ana");
    expect(firstNameOf("Rocket")).toBe("Rocket");
  });

  it("sin nombre no inventa nada", () => {
    expect(firstNameOf("")).toBe("");
    expect(firstNameOf(undefined)).toBe("");
    expect(firstNameOf(null)).toBe("");
  });
});

describe("recompensa de fidelidad en palabras", () => {
  it("descuento y regalo se leen claro", () => {
    expect(describeLoyaltyReward({ rewardType: "discount", percentage: 10 })).toBe("10% de descuento en tu siguiente pedido");
    expect(describeLoyaltyReward({ rewardType: "gift", giftDescription: "Una botella aplicadora" })).toBe("Una botella aplicadora");
  });

  it("con datos incompletos no muestra 'undefined' ni '0%'", () => {
    expect(describeLoyaltyReward({ rewardType: "gift", giftDescription: "" })).toBe("una recompensa para tu siguiente pedido");
    expect(describeLoyaltyReward({})).toBe("una recompensa para tu siguiente pedido");
  });

  it("muestra la recompensa del ciclo en el que va la persona", () => {
    const tiers = [
      { rewardType: "discount" as const, percentage: 10 },
      { rewardType: "gift" as const, giftDescription: "Atomizador" },
    ];
    expect(describeLoyaltyReward(resolveLoyaltyTier(0, tiers))).toContain("10%");
    expect(describeLoyaltyReward(resolveLoyaltyTier(1, tiers))).toBe("Atomizador");
    expect(describeLoyaltyReward(resolveLoyaltyTier(7, tiers))).toBe("Atomizador");
  });
});

describe("el nombre de la marca: siempre «STOPee»", () => {
  it("BrandText corrige cualquier variante y la protege del estilo en mayúsculas", () => {
    const html = renderToStaticMarkup(createElement(BrandText, null, "Acceso privado · Comunidad STOPEE y stopee"));
    expect(html).toContain('<span class="normal-case">STOPee</span>');
    expect(html).not.toMatch(/STOPEE|stopee/);
    expect(html.match(/STOPee/g)).toHaveLength(2);
  });

  it("los textos por defecto (aviso de acceso, club) usan la forma correcta", () => {
    expect(DEFAULT_GATE_COPY.kicker).toContain("STOPee");
    expect(DEFAULT_GATE_COPY.kicker).not.toMatch(/STOPEE/);
    expect(DEFAULT_SUBSCRIPTION_CONFIG.programName).toBe("Club STOPee");
  });

  it("en el código no hay ni «STOPEE» ni «Stopee» escritos como texto", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("app", [".ts", ".tsx"])) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (/\bSTOPEE\b|\bStopee\b/.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 90)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("ninguna etiqueta con 'uppercase' lleva el nombre sin BrandText (se vería «STOPEE»)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("app", [".tsx"])) {
      const source = readFileSync(file, "utf8");
      const opening = /className=(?:"[^"]*\buppercase\b[^"]*"|\{`[^`]*\buppercase\b[^`]*`\})[^>]*>/g;
      for (const match of source.matchAll(opening)) {
        const start = (match.index ?? 0) + match[0].length;
        const text = source.slice(start, source.indexOf("</", start));
        const protectedByBrandText = text.includes("<BrandText");
        if (/stopee|programEyebrow|programDisplayName|programName/i.test(text) && !protectedByBrandText) {
          offenders.push(`${file}: ${text.trim().slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("imagen al compartir en WhatsApp", () => {
  it("la imagen por defecto es la de 1200×630 con el logo con margen, y avisa sus medidas", () => {
    expect(DEFAULT_OG_IMAGE).toBe("/elementos-design/og-STOPee.png");
    const tags = buildOgMeta({
      title: "t",
      description: "d",
      url: "https://stopee.com.mx",
      image: `https://stopee.com.mx${DEFAULT_OG_IMAGE}`,
    });
    expect(tags).toContainEqual({ property: "og:image:width", content: "1200" });
    expect(tags).toContainEqual({ property: "og:image:height", content: "630" });
  });

  it("una foto propia (producto, artículo) no hereda las medidas de la imagen por defecto", () => {
    const tags = buildOgMeta({ title: "t", description: "d", url: "https://stopee.com.mx/x", image: "https://stopee.com.mx/foto.jpg" });
    expect(tags.some((tag) => "property" in tag && tag.property === "og:image:width")).toBe(false);
  });
});

describe("textos de la tienda", () => {
  it("el Club ya no promete 'sin pensarlo' ni precio congelado, y habla de paseos", () => {
    const config = DEFAULT_SUBSCRIPTION_CONFIG;
    expect(config.headline).toBe("Arma tu caja y recíbela con {descuento}% de descuento");
    expect(config.benefits.join(" ")).not.toMatch(/congelado/i);
    expect(config.benefits).toContain("Nunca te quedas sin STOPee para tus paseos");
  });

  it("no queda 'Squishable' en el código visible para clientes", () => {
    const offenders = sourceFiles("app/routes", [".tsx"])
      .concat(sourceFiles("app/components", [".tsx"]))
      .filter((file) => !file.includes("/admin"))
      .filter((file) => /squishable/i.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
