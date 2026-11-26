import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimitMemory as checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { applySecurityHeaders, buildContentSecurityPolicy } from "~/lib/securityHeaders.server";
import { renderMarkdown } from "~/lib/markdown.server";
import { siteOrigin } from "~/lib/siteOrigin.server";
import {
  DEFAULT_SUBSCRIPTION_CONFIG,
  defaultFrequencyKey,
  frequencyKey,
  frequencyLabel,
  isOfferedFrequency,
  stripeIntervalFor,
  weeksFromKey,
  type SubscriptionConfig,
} from "~/lib/subscriptionConfig";

describe("límite de intentos", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("deja pasar hasta el máximo y bloquea el siguiente", () => {
    const key = "login:prueba-1";
    for (let i = 0; i < 3; i++) expect(checkRateLimit(key, { max: 3, windowMs: 60_000 }).allowed).toBe(true);
    const blocked = checkRateLimit(key, { max: 3, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("vuelve a permitir cuando termina la ventana", () => {
    const key = "login:prueba-2";
    for (let i = 0; i < 2; i++) checkRateLimit(key, { max: 2, windowMs: 60_000 });
    expect(checkRateLimit(key, { max: 2, windowMs: 60_000 }).allowed).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit(key, { max: 2, windowMs: 60_000 }).allowed).toBe(true);
  });

  it("cada acción y cada IP llevan su propio contador", () => {
    for (let i = 0; i < 2; i++) checkRateLimit("login:1.1.1.1", { max: 2, windowMs: 60_000 });
    expect(checkRateLimit("login:1.1.1.1", { max: 2, windowMs: 60_000 }).allowed).toBe(false);
    expect(checkRateLimit("login:2.2.2.2", { max: 2, windowMs: 60_000 }).allowed).toBe(true);
    expect(checkRateLimit("registro:1.1.1.1", { max: 2, windowMs: 60_000 }).allowed).toBe(true);
  });

  it("el mensaje usa minutos cuando la espera es larga", () => {
    expect(rateLimitMessage(30)).toBe("Demasiados intentos. Espera un minuto y vuelve a intentar.");
    expect(rateLimitMessage(600)).toBe("Demasiados intentos. Espera 10 minutos y vuelve a intentar.");
  });
});

describe("IP del cliente", () => {
  const request = (headers: Record<string, string>) => new Request("https://stopee.test/", { headers });

  afterEach(() => {
    delete process.env.K_SERVICE;
  });

  it("en desarrollo toma la primera entrada de X-Forwarded-For", () => {
    expect(getClientIp(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("sin cabeceras no inventa una IP", () => {
    expect(getClientIp(request({}))).toBe("unknown");
  });

  it("en Cloud Run no confía en lo que el cliente escribió al inicio de la cadena", () => {
    process.env.K_SERVICE = "stopee";
    // El cliente mandó una IP falsa; el frente de Google agregó la real al final.
    expect(getClientIp(request({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("detrás de Cloudflare usa la IP que Cloudflare anotó del visitante", () => {
    process.env.K_SERVICE = "stopee";
    // Último salto = rango de Cloudflare (104.16.0.0/13); el anterior es el visitante real.
    expect(getClientIp(request({ "x-forwarded-for": "198.51.100.20, 104.16.5.5" }))).toBe("198.51.100.20");
  });
});

describe("cabeceras de seguridad", () => {
  it("la política de contenido exige el nonce y no permite scripts en línea sin él", () => {
    const csp = buildContentSecurityPolicy("abc123");
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(scriptSrc).toContain("'nonce-abc123'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("las páginas con datos personales no se guardan en cachés compartidas", () => {
    for (const path of ["/cuenta", "/cuenta/registro", "/admin", "/admin/orders", "/gracias", "/acceso-privado"]) {
      const headers = new Headers();
      applySecurityHeaders(headers, "n", path);
      expect(headers.get("Cache-Control"), path).toBe("private, no-store");
    }
  });

  it("las páginas públicas conservan su caché", () => {
    for (const path of ["/", "/tienda", "/blog/mi-articulo", "/cuentas-claras"]) {
      const headers = new Headers();
      applySecurityHeaders(headers, "n", path);
      expect(headers.get("Cache-Control"), path).toBeNull();
    }
  });

  it("siempre impide incrustar el sitio y adivinar tipos de archivo", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "n", "/tienda");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Content-Security-Policy")).toContain("'nonce-n'");
  });

  it("sin nonce no manda política (desarrollo con Vite) para no bloquear la hidratación", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "", "/tienda");
    expect(headers.get("Content-Security-Policy")).toBeNull();
  });

  it("HSTS solo en producción", () => {
    const original = process.env.NODE_ENV;
    try {
      const dev = new Headers();
      applySecurityHeaders(dev, "n", "/");
      expect(dev.get("Strict-Transport-Security")).toBeNull();

      (process.env as Record<string, string>).NODE_ENV = "production";
      const prod = new Headers();
      applySecurityHeaders(prod, "n", "/");
      expect(prod.get("Strict-Transport-Security")).toContain("max-age=");
    } finally {
      (process.env as Record<string, string>).NODE_ENV = original!;
    }
  });
});

describe("markdown de blog y páginas legales", () => {
  it("convierte el formato normal", () => {
    expect(renderMarkdown("**hola**")).toContain("<strong>hola</strong>");
  });

  it("elimina scripts y manejadores de eventos inyectados", () => {
    const html = renderMarkdown('Texto <script>alert(1)</script> <img src="x" onerror="alert(2)"> [clic](javascript:alert(3))');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });
});

describe("dirección pública del sitio", () => {
  const original = process.env.APP_URL;
  afterEach(() => {
    process.env.APP_URL = original;
  });

  it("usa APP_URL aunque la petición llegue por la dirección interna", () => {
    process.env.APP_URL = "https://stopee.com.mx/";
    expect(siteOrigin(new Request("http://interno.run.app/tienda"))).toBe("https://stopee.com.mx");
  });

  it("si APP_URL está mal escrita, cae a la de la petición en vez de romper", () => {
    process.env.APP_URL = "esto no es una url";
    expect(siteOrigin(new Request("http://localhost:4827/tienda"))).toBe("http://localhost:4827");
  });

  it("sin APP_URL usa la de la petición", () => {
    delete process.env.APP_URL;
    expect(siteOrigin(new Request("http://localhost:4827/tienda"))).toBe("http://localhost:4827");
  });
});

describe("frecuencias del auto-envío", () => {
  it("solo reconoce el formato guardado y el rango de 1 a 52 semanas", () => {
    expect(weeksFromKey("4-semanas")).toBe(4);
    expect(weeksFromKey("52-semanas")).toBe(52);
    for (const bad of ["0-semanas", "53-semanas", "4-meses", "cuatro", "4-semanas; DROP", "-4-semanas", ""]) {
      expect(weeksFromKey(bad), bad).toBeNull();
    }
  });

  it("le dice a Stripe un intervalo en semanas exactas", () => {
    expect(stripeIntervalFor("6-semanas")).toEqual({ interval: "week", intervalCount: 6 });
    expect(stripeIntervalFor("invalida")).toBeNull();
  });

  it("redacta la frecuencia en singular y plural", () => {
    expect(frequencyLabel("1-semanas")).toBe("Cada semana");
    expect(frequencyLabel("8-semanas")).toBe("Cada 8 semanas");
    expect(frequencyLabel("rara")).toBe("rara");
  });

  it("solo ofrece las frecuencias activas", () => {
    const config: SubscriptionConfig = {
      ...DEFAULT_SUBSCRIPTION_CONFIG,
      frequencies: [
        { weeks: 4, hint: "", recommended: true, isActive: true },
        { weeks: 6, hint: "", recommended: false, isActive: false },
      ],
    };
    expect(isOfferedFrequency(config, frequencyKey(4))).toBe(true);
    expect(isOfferedFrequency(config, frequencyKey(6))).toBe(false); // apagada: ya no se vende, aunque exista
    expect(isOfferedFrequency(config, frequencyKey(12))).toBe(false);
    expect(isOfferedFrequency(config, "4-semanas; x")).toBe(false);
  });

  it("preselecciona la recomendada, o la primera activa si no hay", () => {
    expect(defaultFrequencyKey(DEFAULT_SUBSCRIPTION_CONFIG)).toBe("4-semanas");
    const sinRecomendada: SubscriptionConfig = {
      ...DEFAULT_SUBSCRIPTION_CONFIG,
      frequencies: [
        { weeks: 8, hint: "", recommended: false, isActive: true },
        { weeks: 6, hint: "", recommended: false, isActive: true },
      ],
    };
    expect(defaultFrequencyKey(sinRecomendada)).toBe("6-semanas");
  });
});
