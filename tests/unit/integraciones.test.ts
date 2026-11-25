import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INTEGRATIONS,
  INTEGRATION_IDS,
  configuredPixelIds,
  cspDomainsFor,
  integrationsIn,
  joinNames,
} from "~/lib/integrations";
import { TAG_LOADERS } from "~/lib/consentTags";
import { applySecurityHeaders, buildContentSecurityPolicy } from "~/lib/securityHeaders.server";
import { parseCspReport, resetViolationMemory, shouldLogViolation } from "~/lib/cspReport.server";
import { DEFAULT_COOKIES_MARKDOWN, DEFAULT_PRIVACY_MARKDOWN } from "~/models/legalSettings.server";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("herramientas de terceros: un solo registro", () => {
  it("cada herramienta registrada tiene su cargador, y no sobra ninguno", () => {
    expect(Object.keys(TAG_LOADERS).sort()).toEqual([...INTEGRATION_IDS].sort());
    expect(INTEGRATIONS.map((i) => i.id).sort()).toEqual([...INTEGRATION_IDS].sort());
  });

  it("cada herramienta pide permiso de estadísticas o de marketing, y guarda su ID en un campo propio", () => {
    const fields = INTEGRATIONS.map((i) => i.settingsField);
    expect(new Set(fields).size).toBe(fields.length);
    for (const integration of INTEGRATIONS) expect(["analytics", "marketing"]).toContain(integration.category);
  });

  it("solo toma los IDs con el formato exacto y deja fuera los vacíos o raros", () => {
    expect(
      configuredPixelIds({ googlePixelId: "G-ABCD1234", metaPixelId: "12345abc", tiktokPixelId: "" }),
    ).toEqual({ google: "G-ABCD1234" });
    expect(configuredPixelIds({ tiktokPixelId: "C4ABCDEFGHIJ1234567" })).toEqual({ tiktok: "C4ABCDEFGHIJ1234567" });
    expect(configuredPixelIds({ googlePixelId: "G-1');alert(1);//" })).toEqual({});
    expect(configuredPixelIds({})).toEqual({});
  });

  it("separa las herramientas por categoría, y con IDs solo deja las configuradas", () => {
    expect(integrationsIn("analytics").map((i) => i.id)).toEqual(["google"]);
    expect(integrationsIn("marketing").map((i) => i.id)).toEqual(["meta", "tiktok"]);
    expect(integrationsIn("marketing", { tiktok: "C4ABCDEFGHIJ1234567" }).map((i) => i.id)).toEqual(["tiktok"]);
  });

  it("junta los nombres para el texto del panel", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A y B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B y C");
  });
});

describe("política de seguridad: solo abre lo que está configurado", () => {
  it("sin ninguna herramienta configurada no abre ningún dominio de terceros", () => {
    const csp = buildContentSecurityPolicy("n1");
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'nonce-n1'");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self'");
    // (Las tipografías de Google Fonts sí están permitidas, por eso se revisan solo scripts y conexiones.)
    for (const name of ["script-src", "connect-src"]) {
      for (const domain of ["tiktok", "facebook", "google", "googletagmanager"]) expect(directive(csp, name)).not.toContain(domain);
    }
  });

  it("con solo TikTok, abre solo los dominios de TikTok", () => {
    const csp = buildContentSecurityPolicy("n1", { tiktok: "C4ABCDEFGHIJ1234567" });
    expect(directive(csp, "script-src")).toContain("https://analytics.tiktok.com");
    expect(directive(csp, "connect-src")).toContain("https://analytics.tiktok.com");
    expect(csp).not.toContain("facebook");
    expect(csp).not.toContain("googletagmanager");
  });

  it("con todas, abre los de todas, sin repetir", () => {
    const csp = buildContentSecurityPolicy("n1", { google: "G-ABCD1234", meta: "123456789012345", tiktok: "C4ABCDEFGHIJ1234567" });
    expect(directive(csp, "script-src")).toContain("https://www.googletagmanager.com");
    expect(directive(csp, "script-src")).toContain("https://connect.facebook.net");
    const connect = directive(csp, "connect-src").split(" ");
    expect(new Set(connect).size).toBe(connect.length);
    const { script } = cspDomainsFor({ google: "G-ABCD1234" });
    expect(script).toEqual(["https://www.googletagmanager.com"]);
  });

  it("nunca abre scripts en línea ni eval, tenga o no herramientas", () => {
    const csp = buildContentSecurityPolicy("n1", { google: "G-ABCD1234", meta: "123456789012345", tiktok: "C4ABCDEFGHIJ1234567" });
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
  });

  it("manda los bloqueos a /api/csp-report", () => {
    expect(buildContentSecurityPolicy("n1")).toContain("report-uri /api/csp-report");
  });

  it("las cabeceras de la respuesta usan los IDs que se les pasan", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "n1", "/", { meta: "123456789012345" });
    expect(headers.get("Content-Security-Policy")).toContain("https://connect.facebook.net");
    expect(headers.get("Content-Security-Policy")).not.toContain("tiktok");
  });
});

describe("textos legales armados desde el registro", () => {
  it("la política de cookies lista cada cookie y cada proveedor registrado", () => {
    for (const integration of INTEGRATIONS) {
      for (const cookie of integration.cookies) expect(DEFAULT_COOKIES_MARKDOWN, cookie.name).toContain(cookie.name);
      expect(DEFAULT_COOKIES_MARKDOWN, integration.owner).toContain(integration.providerPolicy.url);
    }
  });

  it("el aviso de privacidad nombra a cada proveedor registrado como transferencia", () => {
    for (const integration of INTEGRATIONS) expect(DEFAULT_PRIVACY_MARKDOWN, integration.owner).toContain(integration.transferLine);
  });
});

describe("avisos de bloqueo de la política de seguridad", () => {
  const report = (body: Record<string, unknown>) => JSON.stringify({ "csp-report": body });

  afterEach(() => resetViolationMemory());

  it("lee un reporte normal y le quita los parámetros de la dirección", () => {
    const violation = parseCspReport(
      report({
        "document-uri": "https://stopee.com.mx/tienda?utm_source=x&email=ana@correo.com",
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=ABC",
      }),
    );
    expect(violation).toEqual({
      directive: "script-src-elem",
      blocked: "https://analytics.tiktok.com/i18n/pixel/events.js",
      page: "https://stopee.com.mx/tienda",
      source: "",
    });
  });

  it("ignora el ruido de las extensiones del navegador", () => {
    expect(parseCspReport(report({ "effective-directive": "script-src", "blocked-uri": "chrome-extension://abc/x.js" }))).toBeNull();
    expect(
      parseCspReport(report({ "effective-directive": "script-src", "blocked-uri": "inline", "source-file": "moz-extension://abc/a.js" })),
    ).toBeNull();
  });

  it("deja pasar los bloqueos de scripts en línea (pueden ser un fallo del propio sitio)", () => {
    expect(parseCspReport(report({ "effective-directive": "script-src-elem", "blocked-uri": "inline" }))?.blocked).toBe("inline");
  });

  it("descarta lo que no es un reporte, lo ilegible y lo demasiado grande", () => {
    expect(parseCspReport("")).toBeNull();
    expect(parseCspReport("no es json")).toBeNull();
    expect(parseCspReport(JSON.stringify({ otra: "cosa" }))).toBeNull();
    expect(parseCspReport(report({ "blocked-uri": "https://x.com/a.js" }))).toBeNull();
    expect(parseCspReport(report({ "effective-directive": "img-src", "blocked-uri": "x".repeat(20000) }))).toBeNull();
  });

  it("un mismo bloqueo se registra una vez por hora", () => {
    const v = { directive: "connect-src", blocked: "https://otro.com/x", page: "", source: "" };
    expect(shouldLogViolation(v, 1_000)).toBe(true);
    expect(shouldLogViolation(v, 2_000)).toBe(false);
    expect(shouldLogViolation({ ...v, blocked: "https://otro.com/y" }, 3_000)).toBe(true);
    expect(shouldLogViolation(v, 1_000 + 61 * 60 * 1000)).toBe(true);
  });

  it("la ruta responde 204 y deja una sola línea en el registro por bloqueo repetido", async () => {
    const { action } = (await import("~/routes/api.csp-report")) as unknown as {
      action: (args: { request: Request; params: object; context: object }) => Promise<Response>;
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const send = () =>
      action({
        request: new Request("https://stopee.test/api/csp-report", {
          method: "POST",
          headers: { "content-type": "application/csp-report", "x-forwarded-for": "10.77.0.1" },
          body: report({ "effective-directive": "connect-src", "blocked-uri": "https://nuevo.example/p", "document-uri": "https://stopee.com.mx/" }),
        }),
        params: {},
        context: {},
      });

    expect((await send()).status).toBe(204);
    expect((await send()).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ level: "warn", context: "csp.violation", directive: "connect-src" });
    warn.mockRestore();
  });
});
