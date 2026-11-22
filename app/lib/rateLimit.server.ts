/**
 * Rate limiting en memoria, por proceso — suficiente para un solo servidor
 * (que es como corre STOPee hoy). Si en algún momento se despliega en
 * varias instancias detrás de un balanceador, esto habría que moverlo a
 * Redis o Mongo para que el conteo se comparta entre procesos; mientras
 * tanto, esto ya cierra la puerta a fuerza bruta y spam automatizado, que
 * es el riesgo real de no tener nada.
 */
import { BlockList, isIP } from "node:net";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function cleanupExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Registra un intento bajo `key` y dice si debe permitirse. `key` debe
 * incluir tanto el identificador del cliente (IP) como la acción que se
 * está limitando (ej. "login:203.0.113.4"), para que un límite no se mezcle
 * con otro.
 */
export function checkRateLimit(
  key: string,
  { max, windowMs }: { max: number; windowMs: number },
): { allowed: boolean; retryAfterSeconds: number } {
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
