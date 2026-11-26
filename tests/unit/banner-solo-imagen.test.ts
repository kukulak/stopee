import { describe, expect, it } from "vitest";
import { isImageOnlyBanner } from "~/lib/heroBanner";

describe("banner solo imagen", () => {
  const base = { text: "", subtitle: "", ctaText: "", imageUrl: "https://cdn.example/a.webp" };

  it("sin texto, frase ni botón, y con imagen, es solo imagen: toda ella es el enlace", () => {
    expect(isImageOnlyBanner(base)).toBe(true);
  });

  it("con texto, frase de apoyo o botón ya no lo es (el enlace es el botón)", () => {
    expect(isImageOnlyBanner({ ...base, text: "Hola" })).toBe(false);
    expect(isImageOnlyBanner({ ...base, subtitle: "Apoyo" })).toBe(false);
    expect(isImageOnlyBanner({ ...base, ctaText: "Ver" })).toBe(false);
  });

  it("sin imagen no es un banner solo imagen", () => {
    expect(isImageOnlyBanner({ ...base, imageUrl: null })).toBe(false);
  });
});
