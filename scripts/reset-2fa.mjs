// Reinicia la verificación en dos pasos de una cuenta de administrador.
//
// Para cuando alguien perdió el celular Y sus códigos de recuperación (o cuando cambia
// SESSION_SECRET, que invalida los secretos guardados). La persona entra con su contraseña y el
// panel la lleva a activar la verificación otra vez, con un secreto nuevo.
//
// Uso:
//   npm run reset-2fa -- correo@ejemplo.com
//
// Apunta a la base que diga MONGODB_URI; para producción, ejecútalo con la URI de producción:
//   MONGODB_URI="mongodb+srv://..." node scripts/reset-2fa.mjs correo@ejemplo.com
//
// Solo quien tiene acceso a la base de datos puede hacerlo, a propósito: no existe un botón en el
// panel para desactivarla, porque quien robara una sesión podría apagarla.

import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("Falta MONGODB_URI en el entorno.");
  process.exit(1);
}

const email = process.argv.slice(2).find((arg) => !arg.startsWith("--"))?.toLowerCase().trim();
if (!email || !email.includes("@")) {
  console.error("Uso: npm run reset-2fa -- correo@ejemplo.com");
  process.exit(1);
}

await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
try {
  const users = mongoose.connection.collection("users");
  const user = await users.findOne({ email });
  if (!user) {
    console.error(`No existe una cuenta con el correo ${email}.`);
    process.exitCode = 1;
  } else if (!user.twoFactor) {
    console.log(`${email} no tenía la verificación en dos pasos activa. No se cambió nada.`);
  } else {
    await users.updateOne({ _id: user._id }, { $unset: { twoFactor: "" } });
    console.log(`Listo: se reinició la verificación en dos pasos de ${email}. Al entrar a /admin/login tendrá que activarla de nuevo.`);
    console.log(JSON.stringify({ level: "info", context: "audit", action: "2fa.reset_from_cli", email, at: new Date().toISOString() }));
  }
} finally {
  await mongoose.disconnect();
}
