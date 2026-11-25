import { describe, expect, it } from "vitest";
import {
  CONSENT_VERSION,
  choicesFromForm,
  parseStoredConsent,
  revokesConsent,
  toStoredConsent,
} from "~/lib/consent";
import { DEFAULT_COOKIES_MARKDOWN, DEFAULT_PRIVACY_MARKDOWN } from "~/models/legalSettings.server";

const ID = "3f2b8a52-1d4c-4e0a-9b6f-0a1b2c3d4e5f";
const valid = () => toStoredConsent({ id: ID, analytics: true, marketing: false, decidedAt: new Date("2026-11-24T18:00:00Z") });

describe("cookies: lo que se guarda de la elección", () => {
  it("una elección válida se lee tal cual", () => {
    expect(parseStoredConsent(valid())).toEqual({
      id: ID,
      analytics: true,
      marketing: false,
      decidedAt: "2026-11-24T18:00:00.000Z",
    });
  });

  it("sin cookie, o con cualquier cosa que no es una elección, cuenta como «sin elegir»", () => {
    for (const bad of [undefined, null, "", "texto", 42, [], {}]) expect(parseStoredConsent(bad)).toBeNull();
  });

  it("una elección de otra versión del aviso se vuelve a preguntar", () => {
    expect(parseStoredConsent({ ...valid(), v: CONSENT_VERSION + 1 })).toBeNull();
    expect(parseStoredConsent({ ...valid(), v: CONSENT_VERSION - 1 })).toBeNull();
  });

  it("una elección alterada (id raro, valores que no son sí/no, fecha inválida) se descarta", () => {
    expect(parseStoredConsent({ ...valid(), id: "no-es-uuid" })).toBeNull();
    expect(parseStoredConsent({ ...valid(), a: "true" })).toBeNull();
    expect(parseStoredConsent({ ...valid(), m: 1 })).toBeNull();
    expect(parseStoredConsent({ ...valid(), t: "ayer" })).toBeNull();
    expect(parseStoredConsent({ ...valid(), t: -5 })).toBeNull();
    expect(parseStoredConsent({ ...valid(), t: Number.NaN })).toBeNull();
  });
});

describe("cookies: qué significa cada botón", () => {
  it("«aceptar todas» permite las dos categorías y «rechazar» ninguna, sin importar lo demás que llegue", () => {
    expect(choicesFromForm("all", "false", "false")).toEqual({ analytics: true, marketing: true });
    expect(choicesFromForm("none", "true", "true")).toEqual({ analytics: false, marketing: false });
  });

  it("«guardar mi elección» respeta cada casilla", () => {
    expect(choicesFromForm("custom", "true", "false")).toEqual({ analytics: true, marketing: false });
    expect(choicesFromForm("custom", "false", "true")).toEqual({ analytics: false, marketing: true });
  });

  it("en «guardar mi elección», lo que no sea exactamente «true» cuenta como no permitido", () => {
    expect(choicesFromForm("custom", "1", "yes")).toEqual({ analytics: false, marketing: false });
    expect(choicesFromForm("custom", undefined, null)).toEqual({ analytics: false, marketing: false });
  });

  it("un botón desconocido no guarda nada", () => {
    expect(choicesFromForm("quizás", "true", "true")).toBeNull();
    expect(choicesFromForm(null, "true", "true")).toBeNull();
  });
});

describe("cookies: cuándo hay que limpiar y recargar", () => {
  it("solo cuando se retira un permiso que antes estaba dado", () => {
    expect(revokesConsent({ analytics: true, marketing: true }, { analytics: false, marketing: true })).toBe(true);
    expect(revokesConsent({ analytics: true, marketing: true }, { analytics: true, marketing: false })).toBe(true);
    expect(revokesConsent({ analytics: false, marketing: false }, { analytics: true, marketing: true })).toBe(false);
    expect(revokesConsent({ analytics: true, marketing: false }, { analytics: true, marketing: false })).toBe(false);
  });

  it("la primera elección nunca es un retiro", () => {
    expect(revokesConsent(null, { analytics: false, marketing: false })).toBe(false);
  });
});

describe("cookies: los textos de fábrica dicen lo que hace el sitio", () => {
  it("la política de cookies lista cada cookie propia y las de Google y Meta", () => {
    for (const name of [
      "__stopee_consent",
      "__stopee_session",
      "__stopee_2fa",
      "__stopee_cart",
      "__stopee_gate",
      "stopee_exit_seen",
      "__stopee_vid",
      "__stopee_attribution",
      "_ga",
      "_fbp",
      "_fbc",
      "_ttp",
    ]) {
      expect(DEFAULT_COOKIES_MARKDOWN, name).toContain(name);
    }
  });

  it("el aviso de privacidad ya no promete lo contrario de lo que se hace", () => {
    expect(DEFAULT_PRIVACY_MARKDOWN).not.toContain("solo si llegaste al sitio a través de un anuncio");
    expect(DEFAULT_PRIVACY_MARKDOWN).toContain("/politica-de-cookies");
    expect(DEFAULT_PRIVACY_MARKDOWN).toContain("solo si aceptas");
  });
});
