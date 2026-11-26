/**
 * Límite de intentos (fuerza bruta, spam de formularios, mensajes a bandejas ajenas).
 *
 * Los contadores viven en MongoDB (colección `ratelimits`, con índice TTL que los borra solos) y se
 * actualizan con UNA operación atómica, así que todas las instancias de Cloud Run comparten el mismo
 * conteo: escalar a más instancias no multiplica los intentos permitidos, ni dos peticiones a la vez
 * pueden colarse por encima del tope.
 *
 * Si Mongo no responde, se cae a un contador en memoria de ese proceso (mejor que dejar la puerta
 * abierta, y mejor que tumbar el login por un fallo del contador). Queda un aviso en los registros.
 */
import { BlockList, isIP } from "node:net";
import { RateLimitModel } from "~/models/rateLimit.server";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function cleanupExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };
type RateLimitOptions = { max: number; windowMs: number };

/**
 * Contador en la memoria de ESTE proceso. Es el respaldo cuando Mongo no está disponible; el
 * límite real es `checkRateLimit`.
 */
export function checkRateLimitMemory(key: string, { max, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  cleanupExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

const EPOCH = new Date(0);
let indexesReady: Promise<unknown> | undefined;
let lastFallbackWarning = 0;

async function checkRateLimitMongo(key: string, { max, windowMs }: RateLimitOptions): Promise<RateLimitResult> {
  // Se importa aquí (y no arriba) para que las pruebas que solo usan getClientIp no necesiten una base de datos.
  const { connectDB } = await import("~/lib/db.server");
  await connectDB();
  // Garantiza el índice TTL antes del primer uso en este proceso (es idempotente).
  indexesReady ??= RateLimitModel.init().catch((error) => {
    indexesReady = undefined;
    throw error;
  });
  await indexesReady;

  const now = new Date();
  const newResetAt = new Date(now.getTime() + windowMs);
  // Una sola operación atómica: si la ventana sigue abierta suma 1 y la conserva; si venció (o no
  // existía) arranca una nueva con 1. En una sola etapa `$set` todas las expresiones leen el
  // documento tal como estaba, así `count` y `resetAt` se deciden con el mismo valor anterior.
  const windowOpen = { $gt: [{ $ifNull: ["$resetAt", EPOCH] }, now] };
  const update = [
    {
      $set: {
        count: { $cond: [windowOpen, { $add: [{ $ifNull: ["$count", 0] }, 1] }, 1] },
        resetAt: { $cond: [windowOpen, "$resetAt", newResetAt] },
      },
    },
  ];

  const run = () =>
    RateLimitModel.collection.findOneAndUpdate({ _id: key as never }, update, {
      upsert: true,
      returnDocument: "after",
    });

  let doc;
  try {
    doc = await run();
  } catch (error) {
    // Dos peticiones a la vez crean el mismo contador: la segunda choca con el _id y basta repetirla.
    if ((error as { code?: number }).code !== 11000) throw error;
    doc = await run();
  }
  if (!doc) throw new Error("Mongo no devolvió el contador.");

  if (doc.count <= max) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((doc.resetAt.getTime() - now.getTime()) / 1000)) };
}

/**
 * Registra un intento bajo `key` y dice si debe permitirse. `key` debe
 * incluir tanto el identificador del cliente (IP) como la acción que se
 * está limitando (ej. "login:203.0.113.4"), para que un límite no se mezcle
 * con otro.
 */
export async function checkRateLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  try {
    return await checkRateLimitMongo(key, options);
  } catch (error) {
    // Un aviso por minuto como máximo: con la base caída cada petición pasaría por aquí.
    const now = Date.now();
    if (now - lastFallbackWarning > 60_000) {
      lastFallbackWarning = now;
      console.warn(
        JSON.stringify({
          level: "warn",
          context: "rate-limit.fallback",
          message: "No se pudo usar MongoDB para el límite de intentos; se usa el contador en memoria de este proceso.",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return checkRateLimitMemory(key, options);
  }
}

/** Borra todos los contadores. Solo para las pruebas: cada una debe empezar sin intentos previos. */
export function resetRateLimits() {
  buckets.clear();
}

// Rangos de IP publicados por Cloudflare (https://www.cloudflare.com/ips/).
// Sirven para saber si el último salto antes de Cloud Run fue Cloudflare. Si
// Cloudflare agrega rangos nuevos y falta alguno aquí, el efecto es el de
// antes (visitantes de ese punto comparten contador), nunca un hueco de seguridad.
const CLOUDFLARE_RANGES_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CLOUDFLARE_RANGES_V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_RANGES_V4) {
  const [net, bits] = range.split("/");
  cloudflare.addSubnet(net, Number(bits), "ipv4");
}
for (const range of CLOUDFLARE_RANGES_V6) {
  const [net, bits] = range.split("/");
  cloudflare.addSubnet(net, Number(bits), "ipv6");
}

function isCloudflareIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 0) return false;
  try {
    return cloudflare.check(ip, version === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}

/**
 * IP del cliente según el header que agrega el proxy/hosting.
 *
 * En Google Cloud Run el frente de Google AGREGA la IP del salto anterior al
 * final de X-Forwarded-For; todo lo que viene antes lo pudo escribir el propio
 * cliente (si no, bastaría mandar un header falso distinto en cada intento
 * para saltarse el límite de intentos). Por eso ahí solo se confía en el final:
 *  - si ese último salto NO es Cloudflare, es el cliente en persona (visita
 *    directa a la URL de Cloud Run): se usa tal cual;
 *  - si ES Cloudflare, la entrada anterior es la que Cloudflare anotó con la IP
 *    real del visitante. Sin esto, todos los visitantes que entran por el mismo
 *    punto de Cloudflare compartían un solo contador de intentos.
 * En cualquier otro entorno (desarrollo), la primera entrada.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const entries = forwarded.split(",").map((entry) => entry.trim()).filter(Boolean);
    if (process.env.K_SERVICE) {
      const last = entries[entries.length - 1];
      if (last && isCloudflareIp(last) && entries.length >= 2) return entries[entries.length - 2];
      if (last) return last;
    } else if (entries[0]) {
      return entries[0];
    }
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Mensaje consistente para cuando se excede el límite. */
export function rateLimitMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return minutes <= 1
    ? "Demasiados intentos. Espera un minuto y vuelve a intentar."
    : `Demasiados intentos. Espera ${minutes} minutos y vuelve a intentar.`;
}
