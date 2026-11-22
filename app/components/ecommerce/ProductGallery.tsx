import { useState } from "react";

/**
 * Foto principal con miniaturas debajo: al elegir una miniatura se cambia la
 * grande. Con una sola foto (o ninguna) no se muestran miniaturas.
 */
export function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [selected, setSelected] = useState(0);
  const current = images[Math.min(selected, images.length - 1)];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-lima/20 to-bosque/10">
        {current ? (
          <img src={current} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="font-display text-2xl font-black text-bosque/40">STOPee</div>
        )}
      </div>

      {images.length > 1 && (
        <ul className="flex flex-wrap gap-2" aria-label="Fotos del producto">
          {images.map((url, index) => {
            const isSelected = index === selected;
            return (
              <li key={url}>
                <button
                  type="button"
                  onClick={() => setSelected(index)}
                  aria-label={`Ver foto ${index + 1} de ${images.length}`}
                  aria-current={isSelected}
                  className={`block h-16 w-16 overflow-hidden rounded-2xl border-2 transition-colors sm:h-20 sm:w-20 ${
                    isSelected ? "border-carbon" : "border-transparent opacity-70 hover:opacity-100"
                  }`}
                >
                  <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
