type Testimonial = { customerName: string; quote: string; photoUrl?: string };

/** Sin testimonios publicados, esta sección simplemente no existe — nunca se rellena con reseñas de relleno. */
export function TestimonialsSection({ testimonials }: { testimonials: Testimonial[] }) {
  if (testimonials.length === 0) return null;

  return (
    <section className="bg-hueso py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-center font-body text-sm font-bold uppercase tracking-widest text-oliva">
          Lo que dicen quienes ya lo usan
        </p>
        <h2 className="mt-2 text-center font-display text-3xl font-black text-carbon sm:text-4xl">
          Clientes reales, resultados reales
        </h2>

        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {testimonials.map((t) => (
            <div key={t.customerName} className="rounded-3xl border border-carbon/10 bg-white p-6">
              <p className="text-sm text-carbon/80">“{t.quote}”</p>
              <div className="mt-4 flex items-center gap-2">
                {t.photoUrl && <img src={t.photoUrl} alt="" className="h-9 w-9 rounded-full object-cover" loading="lazy" decoding="async" />}
                <p className="font-display font-bold text-carbon">{t.customerName}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
