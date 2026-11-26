import type { Collection } from "mongodb";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";

type RateLimit = typeof import("~/lib/rateLimit.server");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const WINDOW = { max: 3, windowMs: 60_000 };

/**
 * El límite de intentos vive en MongoDB (índice TTL) para que varias instancias de Cloud Run
 * compartan el mismo conteo. Se ejecuta contra un Mongo desechable, con la operación atómica real.
 */
describe.skipIf(!hasTestDb)("límite de intentos en MongoDB", () => {
  let rateLimit: RateLimit;
  let collection: Collection;

  beforeAll(async () => {
    assertDisposableDb();
    rateLimit = await import("~/lib/rateLimit.server");
    const { connectDB } = await import("~/lib/db.server");
    await connectDB();
    collection = mongoose.connection.db!.collection("ratelimits");
  });

  afterAll(async () => {
    await dropDb();
  });

  beforeEach(async () => {
    await wipeDb();
    rateLimit.resetRateLimits();
  });

  it("deja pasar hasta el máximo y bloquea el siguiente, diciendo cuánto esperar", async () => {
    for (let i = 0; i < 3; i++) expect((await rateLimit.checkRateLimit("login:a", WINDOW)).allowed).toBe(true);
    const bloqueado = await rateLimit.checkRateLimit("login:a", WINDOW);
    expect(bloqueado.allowed).toBe(false);
    expect(bloqueado.retryAfterSeconds).toBeGreaterThan(0);
    expect(bloqueado.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("cada acción y cada cliente llevan su propio contador", async () => {
    for (let i = 0; i < 3; i++) await rateLimit.checkRateLimit("login:1.1.1.1", WINDOW);
    expect((await rateLimit.checkRateLimit("login:1.1.1.1", WINDOW)).allowed).toBe(false);
    expect((await rateLimit.checkRateLimit("login:2.2.2.2", WINDOW)).allowed).toBe(true);
    expect((await rateLimit.checkRateLimit("registro:1.1.1.1", WINDOW)).allowed).toBe(true);
  });

  it("al terminar la ventana vuelve a permitir y el contador arranca de nuevo", async () => {
    const corta = { max: 2, windowMs: 250 };
    await rateLimit.checkRateLimit("corta", corta);
    await rateLimit.checkRateLimit("corta", corta);
    expect((await rateLimit.checkRateLimit("corta", corta)).allowed).toBe(false);
    await sleep(300);
    expect((await rateLimit.checkRateLimit("corta", corta)).allowed).toBe(true);
    expect((await collection.findOne({ _id: "corta" as never }))!.count).toBe(1);
  });

  it("un contador vencido que Mongo todavía no borró (el TTL tarda hasta un minuto) no bloquea a nadie", async () => {
    await collection.insertOne({ _id: "viejo" as never, count: 999, resetAt: new Date(Date.now() - 5_000) });
    expect((await rateLimit.checkRateLimit("viejo", WINDOW)).allowed).toBe(true);
    expect((await collection.findOne({ _id: "viejo" as never }))!.count).toBe(1);
  });

  it("peticiones simultáneas no se cuelan por encima del tope (la operación es atómica)", async () => {
    const resultados = await Promise.all(Array.from({ length: 60 }, () => rateLimit.checkRateLimit("rafaga", { max: 10, windowMs: 60_000 })));
    expect(resultados.filter((r) => r.allowed)).toHaveLength(10);
    expect(resultados.filter((r) => !r.allowed)).toHaveLength(50);
  });

  it("dos instancias del servidor comparten el mismo conteo", async () => {
    // Otra instancia = otro proceso: módulo nuevo, memoria vacía, misma base de datos.
    vi.resetModules();
    const otraInstancia: RateLimit = await import("~/lib/rateLimit.server");

    await rateLimit.checkRateLimit("login:compartido", { max: 4, windowMs: 60_000 });
    await otraInstancia.checkRateLimit("login:compartido", { max: 4, windowMs: 60_000 });
    await rateLimit.checkRateLimit("login:compartido", { max: 4, windowMs: 60_000 });
    await otraInstancia.checkRateLimit("login:compartido", { max: 4, windowMs: 60_000 });

    expect((await rateLimit.checkRateLimit("login:compartido", { max: 4, windowMs: 60_000 })).allowed).toBe(false);
    expect((await otraInstancia.checkRateLimit("login:compartido", { max: 4, windowMs: 60_000 })).allowed).toBe(false);
  });

  it("la colección se limpia sola: tiene un índice TTL sobre resetAt", async () => {
    const indices = await collection.indexes();
    const ttl = indices.find((i) => i.key && "resetAt" in i.key);
    expect(ttl).toBeTruthy();
    expect(ttl!.expireAfterSeconds).toBe(0);
  });

  it("si Mongo no responde, el límite sigue funcionando con el contador en memoria de ese proceso", async () => {
    vi.resetModules();
    vi.doMock("~/lib/db.server", () => ({ connectDB: async () => { throw new Error("Mongo caído"); } }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const sinMongo: RateLimit = await import("~/lib/rateLimit.server");
      for (let i = 0; i < 3; i++) expect((await sinMongo.checkRateLimit("login:respaldo", WINDOW)).allowed).toBe(true);
      expect((await sinMongo.checkRateLimit("login:respaldo", WINDOW)).allowed).toBe(false);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("rate-limit.fallback"));
    } finally {
      vi.doUnmock("~/lib/db.server");
      vi.restoreAllMocks();
    }
  });
});
