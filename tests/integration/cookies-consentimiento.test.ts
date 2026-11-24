import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { asResponse } from "../helpers/http";

type RouteArgs = { request: Request; params: object; context: object };
type Action = (args: RouteArgs) => Promise<Response>;

/**
 * Sin permiso no se mide nada: ni se crean las cookies de estadísticas ni se registran visitas.
 * Estas pruebas ejecutan de verdad la ruta que guarda la elección y la que registra eventos.
 */
describe.skipIf(!hasTestDb)("cookies: consentimiento", () => {
  let consent: Action;
  let track: Action;
  let AnalyticsEventModel: typeof import("~/models/analyticsEvent.server").AnalyticsEventModel;
  let ConsentLogModel: typeof import("~/models/consentLog.server").ConsentLogModel;
  let connectDB: typeof import("~/lib/db.server").connectDB;
  let readConsent: typeof import("~/lib/consent.server").readConsent;
  let expireAnalyticsCookies: typeof import("~/lib/consent.server").expireAnalyticsCookies;
  let getLegalSettings: typeof import("~/models/legalSettings.server").getLegalSettings;

  beforeAll(async () => {
    assertDisposableDb();
    consent = asResponse(((await import("~/routes/api.consent")) as never as { action: Action }).action);
    track = asResponse(((await import("~/routes/api.track")) as never as { action: Action }).action);
    ({ AnalyticsEventModel } = await import("~/models/analyticsEvent.server"));
    ({ ConsentLogModel } = await import("~/models/consentLog.server"));
    ({ connectDB } = await import("~/lib/db.server"));
    ({ readConsent, expireAnalyticsCookies } = await import("~/lib/consent.server"));
    ({ getLegalSettings } = await import("~/models/legalSettings.server"));
    await connectDB();
  });

  afterAll(async () => {
    await dropDb();
  });

  beforeEach(async () => {
    await wipeDb();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  let ipCounter = 0;
  const freshIp = () => `10.9.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

  const args = (request: Request): RouteArgs => ({ request, params: {}, context: {} });

  function postConsent(fields: Record<string, string>, cookie?: string) {
    const headers = new Headers({ "x-forwarded-for": freshIp() });
    if (cookie) headers.set("cookie", cookie);
    return new Request("https://stopee.test/api/consent", { method: "POST", headers, body: new URLSearchParams(fields) });
  }

  function postTrack(type: string, cookie?: string) {
    const headers = new Headers({ "x-forwarded-for": freshIp(), "content-type": "application/json" });
    if (cookie) headers.set("cookie", cookie);
    return new Request("https://stopee.test/api/track", { method: "POST", headers, body: JSON.stringify({ type }) });
  }

  /** Todas las cookies que la respuesta pide guardar, como "nombre=valor". */
  const setCookies = (response: Response) => response.headers.getSetCookie().map((c) => c.split(";")[0]);
  const consentCookieOf = (response: Response) => setCookies(response).find((c) => c.startsWith("__stopee_consent="))!;

  it("«aceptar todas» guarda la elección en una cookie y deja prueba en la base", async () => {
    const response = await consent(args(postConsent({ choice: "all", path: "/tienda?utm_source=x" })));
    expect(response.status).toBe(200);

    const cookie = consentCookieOf(response);
    expect(cookie).toBeTruthy();
    const state = await readConsent(new Request("https://stopee.test/", { headers: { cookie } }));
    expect(state).toMatchObject({ analytics: true, marketing: true });

    const logs = await ConsentLogModel.find().lean();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ choice: "all", analytics: true, marketing: true, path: "/tienda", consentId: state!.id });
  });

  it("«rechazar» no permite nada y manda borrar las cookies de medición que ya hubiera", async () => {
    const response = await consent(
      args(postConsent({ choice: "none" }, "__stopee_vid=abc; __stopee_attribution=xyz; __stopee_cart=guardada")),
    );
    const state = await readConsent(
      new Request("https://stopee.test/", { headers: { cookie: consentCookieOf(response) } }),
    );
    expect(state).toMatchObject({ analytics: false, marketing: false });

    const expired = response.headers.getSetCookie().filter((c) => /Max-Age=0/i.test(c));
    expect(expired.map((c) => c.split("=")[0]).sort()).toEqual(["__stopee_attribution", "__stopee_vid"]);
    // El carrito es una cookie necesaria: no se toca.
    expect(response.headers.getSetCookie().some((c) => c.startsWith("__stopee_cart"))).toBe(false);
  });

  it("al cambiar de opinión se conserva el mismo identificador de elección", async () => {
    const first = await consent(args(postConsent({ choice: "all" })));
    const second = await consent(args(postConsent({ choice: "custom", analytics: "true", marketing: "false" }, consentCookieOf(first))));

    const a = await readConsent(new Request("https://stopee.test/", { headers: { cookie: consentCookieOf(first) } }));
    const b = await readConsent(new Request("https://stopee.test/", { headers: { cookie: consentCookieOf(second) } }));
    expect(b!.id).toBe(a!.id);
    expect(b).toMatchObject({ analytics: true, marketing: false });
    expect(await ConsentLogModel.countDocuments({ consentId: a!.id })).toBe(2);
  });

  it("una elección inválida no guarda nada", async () => {
    const response = await consent(args(postConsent({ choice: "quizás" })));
    expect(response.status).toBe(400);
    expect(setCookies(response)).toEqual([]);
    expect(await ConsentLogModel.countDocuments()).toBe(0);
  });

  it("sin elección, los eventos no se registran ni se crea el identificador de visitante", async () => {
    const response = await track(args(postTrack("view_item")));
    expect(response.status).toBe(200);
    expect(setCookies(response)).toEqual([]);
    expect(await AnalyticsEventModel.countDocuments()).toBe(0);
  });

  it("rechazando las estadísticas tampoco se registra nada", async () => {
    const rejected = consentCookieOf(await consent(args(postConsent({ choice: "none" }))));
    await track(args(postTrack("add_to_cart", rejected)));
    expect(await AnalyticsEventModel.countDocuments()).toBe(0);
  });

  it("con las estadísticas aceptadas, los eventos sí se registran", async () => {
    const accepted = consentCookieOf(await consent(args(postConsent({ choice: "custom", analytics: "true", marketing: "false" }))));
    const response = await track(args(postTrack("view_item", accepted)));
    expect(response.status).toBe(200);
    expect(await AnalyticsEventModel.countDocuments({ type: "view_item" })).toBe(1);
    expect(setCookies(response).some((c) => c.startsWith("__stopee_vid="))).toBe(true);
  });

  it("solo manda borrar las cookies de medición que el navegador realmente trae", () => {
    expect(expireAnalyticsCookies(new Request("https://stopee.test/"))).toEqual([]);
    const only = expireAnalyticsCookies(new Request("https://stopee.test/", { headers: { cookie: "__stopee_vid=1; otra=2" } }));
    expect(only).toHaveLength(1);
    expect(only[0]).toMatch(/^__stopee_vid=;.*Max-Age=0/);
  });

  it("los datos legales guardados antes de existir la política de cookies siguen leyéndose", async () => {
    const { LegalSettingsModel } = await import("~/models/legalSettings.server");
    await LegalSettingsModel.collection.insertOne({ razonSocial: "STOPee SA de CV", privacyPolicyMarkdown: "viejo" });
    const settings = await getLegalSettings();
    expect(settings.privacyPolicyMarkdown).toBe("viejo");
    expect(settings.cookiesMarkdown).toBeUndefined();
  });
});
