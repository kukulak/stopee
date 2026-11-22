// Convierte una cuenta existente en SUPER ADMINISTRADORA (o le quita el rol).
//
// El super administrador es el único que puede, desde el panel (Clientes →
// Nuevo usuario), crear cuentas y dar o quitar el rol de administrador. Este
// rol solo se otorga aquí, desde la terminal, nunca desde el panel.
//
// Uso:
//   npm run make-admin -- correo@ejemplo.com           (da el rol de super administrador)
//   npm run make-admin -- correo@ejemplo.com --revoke  (lo deja como cliente)
//
// La cuenta debe existir ya (se crea en /cuenta/registro). Apunta a la base
// que diga MONGODB_URI; para producción, ejecútalo con la URI de producción:
//   MONGODB_URI="mongodb+srv://..." node scripts/make-admin.mjs correo@ejemplo.com
//
// Antes esto pasaba solo: la cuenta registrada con el correo de ADMIN_EMAIL se
// volvía administradora al entrar a /admin/login. Eso permitía que cualquiera
// que se registrara primero con ese correo (que está escrito en la
// documentación) se quedara con el panel, así que ahora es un paso explícito.

import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("Falta MONGODB_URI en el entorno.");
  process.exit(1);
}

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const email = args.find((arg) => !arg.startsWith("--"))?.toLowerCase().trim();
if (!email || !email.includes("@")) {
  console.error("Uso: npm run make-admin -- correo@ejemplo.com [--revoke]");
  process.exit(1);
}

await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
try {
  const users = mongoose.connection.collection("users");
  const user = await users.findOne({ email });
  if (!user) {
    console.error(`No existe una cuenta con el correo ${email}. Créala primero en /cuenta/registro.`);
    process.exitCode = 1;
  } else {
    const role = revoke ? "customer" : "superadmin";
    // Quien corre este comando tiene acceso a la base: se da por confirmado el correo
    // para no dejar fuera a la persona a la que se le acaba de dar el rol.
    const set = revoke ? { role } : { role, ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }) };
    await users.updateOne({ _id: user._id }, { $set: set });
    console.log(
      revoke
        ? `${email} ya no tiene acceso al panel (quedó como cliente).`
        : `${email} ahora es super administradora. Entra en /admin/login.`,
    );
  }
} finally {
  await mongoose.disconnect();
}
