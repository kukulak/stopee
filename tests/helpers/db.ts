import mongoose from "mongoose";

/**
 * Las pruebas con base de datos usan un Mongo desechable indicado en TEST_MONGODB_URI
 * (por ejemplo mongodb://127.0.0.1:27018/stopee_test_ci). Sin esa variable se omiten.
 *
 * Seguridad: estas pruebas BORRAN las colecciones entre un caso y otro. Por eso se niegan
 * a correr contra cualquier base cuyo nombre no contenga "test", para que nunca apunten
 * por error a la base de desarrollo ni a la de producción.
 */
export const TEST_DB_URI = process.env.TEST_MONGODB_URI;
export const hasTestDb = Boolean(TEST_DB_URI);

export function assertDisposableDb() {
  const name = /\/([^/?]+)(\?|$)/.exec(TEST_DB_URI ?? "")?.[1] ?? "";
  if (!/test/i.test(name)) {
    throw new Error(
      `TEST_MONGODB_URI debe apuntar a una base cuyo nombre contenga "test" (recibí "${name}"). ` +
        "Las pruebas borran sus datos y no deben tocar desarrollo ni producción.",
    );
  }
}

/** Vacía todas las colecciones de la base de pruebas. */
export async function wipeDb() {
  assertDisposableDb();
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

/** Borra la base de pruebas completa al terminar. */
export async function dropDb() {
  assertDisposableDb();
  await mongoose.connection.dropDatabase();
}
