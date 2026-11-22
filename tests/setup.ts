/**
 * Variables que los módulos del servidor exigen al cargarse. Todas son de relleno:
 * ninguna prueba habla con Stripe, con Brevo ni con la base de producción.
 *
 * Las pruebas con base de datos solo corren si TEST_MONGODB_URI apunta a un Mongo
 * desechable (ver tests/helpers/db.ts). Sin esa variable se omiten.
 */
process.env.NODE_ENV = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_relleno_para_pruebas";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_relleno_para_pruebas";
process.env.SESSION_SECRET = "secreto-de-pruebas-que-no-es-real-0123456789";
process.env.APP_URL = "https://stopee.test";
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI ?? "mongodb://127.0.0.1:1/no_se_usa";
// Sin llaves de Brevo: los correos se omiten solos, salvo en las pruebas que los intercepten.
delete process.env.BREVO_API_KEY;
delete process.env.MAIL_FROM_EMAIL;
// Evita que K_SERVICE (Cloud Run) altere cómo se lee la IP del cliente.
delete process.env.K_SERVICE;
