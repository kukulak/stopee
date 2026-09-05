import { Form, useNavigation } from "@remix-run/react";
import { Logo } from "~/components/ui/Logo";
import { FluidWaves } from "~/components/ui/FluidWaves";

type ActionData = { ok?: boolean; error?: string } | undefined;

const BONDADES = [
  {
    title: "Bacillus subtilis",
    detail:
      "Microorganismo benéfico que degrada los compuestos orgánicos del olor desde la raíz, no solo los enmascara.",
  },
  {
    title: "Ricinoleato de zinc",
    detail:
      "Encapsula instantáneamente las moléculas causantes del mal olor al hacer contacto con la superficie.",
  },
  {
    title: "1 litro rinde 30 litros",
    detail:
      "Fórmula concentrada de alto rendimiento: un envase te acompaña en decenas de paseos activados.",
  },
];

const CONVIVENCIA = [
  {
    audience: "Para ti y tu perro",
    detail: "Paseos frescos, sin malos olores retenidos en arneses, calzado o ropa.",
  },
  {
    audience: "Para tus vecinos y comercios",
    detail: "Fachadas preservadas, calles ventiladas y banquetas seguras para todos.",
  },
  {
    audience: "Para la ciudad",
    detail: "Conservación del mobiliario urbano y microbiología activa benéfica.",
  },
];

export function PrelaunchLanding({ actionData }: { actionData: ActionData }) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <div className="flex min-h-screen flex-col bg-carbon text-hueso">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-6 sm:px-6">
        <Logo className="h-10 w-auto" />
        <a
          href="#lista-de-espera"
          className="min-h-11 rounded-full border-2 border-hueso/25 px-5 py-2 text-sm font-bold text-hueso transition-colors hover:border-hueso/50"
        >
          Notificarme
        </a>
      </header>

      <main className="flex-1">
        {/* HERO + CAPTURA */}
        <section id="lista-de-espera" className="relative overflow-hidden">
          <FluidWaves tone="dark" className="absolute inset-0 h-full w-full opacity-50" />
          <div className="relative mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-24">
            <p className="font-body text-sm font-bold uppercase tracking-widest text-lima">
              Estamos preparando el lanzamiento oficial de STOPee
            </p>
            <h1 className="mt-4 font-display text-4xl font-black leading-[1.05] sm:text-5xl">
              Ciudades limpias, paseos impecables.
            </h1>
            <p className="mx-auto mt-5 max-w-lg text-hueso/75">
              El concentrado biotecnológico que neutraliza al instante y degrada los residuos
              del paseo canino. Un litro rinde 30 litros de solución activa. Sé de los primeros
              en recibirlo.
            </p>

            {actionData?.ok ? (
              <div className="mx-auto mt-8 max-w-md rounded-3xl border border-lima/30 bg-lima/10 p-6">
                <p className="font-display text-lg font-bold text-lima">
                  ¡Listo! Ya estás en la lista.
                </p>
                <p className="mt-1 text-sm text-hueso/75">
                  Te avisaremos en cuanto abramos la tienda y tendrás un descuento de
                  bienvenida reservado en tu correo.
                </p>
              </div>
            ) : (
              <Form
                method="post"
                className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row"
                noValidate
              >
                <label htmlFor="email" className="sr-only">
                  Correo electrónico
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="tu@correo.com"
                  autoComplete="email"
                  className="min-h-11 flex-1 rounded-full border border-hueso/20 bg-hueso/5 px-5 text-hueso placeholder:text-hueso/40 focus:border-lima focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-h-11 rounded-full bg-lima px-7 text-sm font-bold text-carbon transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
                >
                  {isSubmitting ? "Enviando…" : "Notificarme"}
                </button>
              </Form>
            )}

            {actionData?.error && (
              <p className="mt-3 text-sm font-semibold text-red-400">{actionData.error}</p>
            )}
            {!actionData?.ok && (
              <p className="mt-3 text-xs text-hueso/50">
                Sin spam. Solo un correo cuando abramos, con tu descuento de bienvenida.
              </p>
            )}
          </div>
        </section>

        {/* BONDADES BIOTECNOLÓGICAS */}
        <section className="border-t border-hueso/10 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-center font-body text-sm font-bold uppercase tracking-widest text-oliva">
              Biotecnología activa
            </p>
            <h2 className="mt-2 text-center font-display text-3xl font-black sm:text-4xl">
              Elimina el olor desde la raíz, no lo disimula
            </h2>

            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
              {BONDADES.map((b) => (
                <div key={b.title} className="rounded-3xl border border-hueso/10 bg-hueso/5 p-6">
                  <p className="font-display text-lg font-bold text-lima">{b.title}</p>
                  <p className="mt-2 text-sm text-hueso/70">{b.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CONVIVENCIA URBANA */}
        <section className="border-t border-hueso/10 bg-hueso/[0.03] py-20">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
            <p className="font-body text-sm font-bold uppercase tracking-widest text-lima">
              El nuevo estándar cívico
            </p>
            <h2 className="mt-3 font-display text-3xl font-black sm:text-4xl">
              Levantar la popa ya es un hábito. Atender la orina es el siguiente paso.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-hueso/70">
              La cultura ciudadana adoptó exitosamente la recolección de heces. El siguiente
              paso lógico de la convivencia comunitaria es atender las manchas y olores de la
              orina en fachadas, banquetas y postes.
            </p>

            <div className="mt-12 grid grid-cols-1 gap-6 text-left sm:grid-cols-3">
              {CONVIVENCIA.map((c) => (
                <div key={c.audience} className="rounded-3xl border border-hueso/10 bg-hueso/5 p-6">
                  <p className="font-display font-bold text-lima">{c.audience}</p>
                  <p className="mt-2 text-sm text-hueso/70">{c.detail}</p>
                </div>
              ))}
            </div>

            <a
              href="#lista-de-espera"
              className="mt-12 inline-block min-h-11 rounded-full bg-lima px-8 py-3 text-sm font-bold text-carbon transition-transform hover:scale-105"
            >
              Quiero mi acceso anticipado ↑
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-hueso/10 px-4 py-8 text-center text-xs text-hueso/40 sm:px-6">
        © {new Date().getFullYear()} STOPee.com.mx — Todos los derechos reservados.
      </footer>
    </div>
  );
}
