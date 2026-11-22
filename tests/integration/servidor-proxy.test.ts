import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Arranca server.js de verdad (el sitio compilado) y le manda envíos de formulario con las cabeceras
 * que añaden Cloud Run y Cloudflare. Existe porque este error solo aparece detrás del proxy: en
 * local todo es "http://" y todo coincide, así que ninguna otra prueba lo ve. Una vez rompió TODOS
 * los formularios de producción (login, pagar…): Express creía que la visita era http://, React Router
 * lo comparaba con el Origin https:// del navegador y rechazaba el envío como falsificación.
 *
 * Necesita el sitio compilado (`npm run build`); sin él se omite.
 */
const built = existsSync("build/server/index.js");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function send(port: number, opts: { method?: string; path: string; headers: Record<string, string>; body?: string }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path, headers: opts.headers },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe.skipIf(!built)("sitio compilado detrás del proxy de Cloud Run y Cloudflare", () => {
  let child: ChildProcess;
  let port: number;
  const GOOGLE_HOST = "stopee-prueba-xxxxx.a.run.app";

  /** Envío del formulario de login (sin datos): si llega a la acción responde con su propio mensaje de validación. */
  const submitLogin = (headers: Record<string, string>) =>
    send(port, {
      method: "POST",
      path: "/cuenta/entrar.data",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: "email=&password=",
    });

  const REACHED_ACTION = "Ingresa tu correo y contraseña.";

  beforeAll(async () => {
    port = await freePort();
    child = spawn("node", ["server.js"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(port),
        APP_URL: "https://stopee.com.mx",
        MONGODB_URI: "mongodb://127.0.0.1:1/no_se_usa",
        STRIPE_SECRET_KEY: "sk_test_relleno_para_pruebas",
        STRIPE_WEBHOOK_SECRET: "whsec_relleno_para_pruebas",
        SESSION_SECRET: "secreto-de-pruebas-que-no-es-real-0123456789",
        K_SERVICE: "",
      },
      stdio: "ignore",
    });
    // Espera a que el servidor responda.
    for (let i = 0; i < 60; i++) {
      try {
        await send(port, { path: "/robots.txt", headers: { host: "localhost" } });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new Error("El servidor no arrancó a tiempo.");
  }, 30_000);

  afterAll(() => {
    child?.kill();
  });

  it("un formulario desde la dirección de Google (https detrás del proxy) llega a su acción", async () => {
    const r = await submitLogin({ host: GOOGLE_HOST, origin: `https://${GOOGLE_HOST}`, "x-forwarded-proto": "https" });
    expect(r.body).toContain(REACHED_ACTION);
    expect(r.body).not.toContain("Unexpected Server Error");
  });

  it("un formulario desde el dominio real, aunque al contenedor llegue con la dirección interna, llega a su acción", async () => {
    for (const origin of ["https://stopee.com.mx", "https://www.stopee.com.mx"]) {
      const r = await submitLogin({ host: GOOGLE_HOST, origin, "x-forwarded-proto": "https", "x-forwarded-host": GOOGLE_HOST });
      expect(r.body, origin).toContain(REACHED_ACTION);
    }
  });

  it("sin proxy (desarrollo) sigue funcionando", async () => {
    const r = await submitLogin({ host: `localhost:${port}`, origin: `http://localhost:${port}` });
    expect(r.body).toContain(REACHED_ACTION);
  });

  it("un formulario enviado desde OTRO sitio se rechaza (403), con o sin proxy", async () => {
    for (const origin of ["https://sitio-malo.com", "http://stopee.com.mx.sitio-malo.com", "null"]) {
      const r = await submitLogin({ host: GOOGLE_HOST, origin, "x-forwarded-proto": "https" });
      expect(r.status, origin).toBe(403);
      expect(r.body, origin).not.toContain(REACHED_ACTION);
    }
  });
});
