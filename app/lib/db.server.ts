import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Falta la variable de entorno MONGODB_URI");
}

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __stopeeMongoose: MongooseCache | undefined;
}

const cache: MongooseCache = global.__stopeeMongoose ?? { conn: null, promise: null };
global.__stopeeMongoose = cache;

export async function connectDB() {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    // Si la conexión falla (p. ej. MongoDB no estaba levantado todavía), no
    // debe quedar la promesa rechazada cacheada para siempre — eso dejaría el
    // proceso "roto" de forma permanente aunque la base vuelva a estar
    // disponible. Al fallar, se limpia la caché para que el siguiente intento
    // vuelva a conectar en vez de repetir el mismo error para siempre.
    cache.promise = mongoose.connect(MONGODB_URI as string, { bufferCommands: false }).catch((err) => {
      cache.promise = null;
      throw err;
    });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}
