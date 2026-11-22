import { useControls, button } from "leva";
import { useEffect, useRef } from "react";
import type { SwirlPlacement } from "./BrandSwirls";

function SwirlFolder({
  label,
  initial,
  onChange,
}: {
  label: string;
  initial: SwirlPlacement;
  onChange: (next: SwirlPlacement) => void;
}) {
  const values = useControls(label, {
    vAnchor: { value: initial.vAnchor ?? "top", options: ["top", "bottom"], label: "borde vertical" },
    vOffset: { value: initial.vOffset, min: -30, max: 120, step: 1, label: "top/bottom (%)" },
    hAnchor: { value: initial.hAnchor, options: ["left", "right"], label: "borde horizontal" },
    hOffset: { value: initial.hOffset, min: -100, max: 100, step: 1, label: "left/right (%)" },
    scale: { value: initial.scale ?? 1, min: 0.2, max: 3, step: 0.05, label: "escala" },
    rotate: { value: initial.rotate ?? 0, min: -45, max: 45, step: 1, label: "rotación" },
    opacity: { value: initial.opacity ?? 1, min: 0, max: 1, step: 0.05, label: "opacidad" },
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    onChange({
      ...initial,
      vAnchor: values.vAnchor as "top" | "bottom",
      vOffset: values.vOffset,
      hAnchor: values.hAnchor as "left" | "right",
      hOffset: values.hOffset,
      scale: values.scale,
      rotate: values.rotate,
      opacity: values.opacity,
    });
  }, [values.vAnchor, values.vOffset, values.hAnchor, values.hOffset, values.scale, values.rotate, values.opacity]);

  return null;
}

function formatSwirlCode(s: SwirlPlacement) {
  return `  {
    src: "${s.src}",
    vAnchor: "${s.vAnchor ?? "top"}",
    vOffset: ${s.vOffset},
    hAnchor: "${s.hAnchor}",
    hOffset: ${s.hOffset},
    scale: ${s.scale ?? 1},
    width: ${s.width},
    speed: ${s.speed},
    rotate: ${s.rotate ?? 0},
    opacity: ${s.opacity ?? 1},
  },`;
}

/**
 * Panel de edición visual para BrandSwirls — sliders para cada remolino
 * (borde y desplazamiento vertical/horizontal, escala, rotación, opacidad)
 * en vez de editar números en el código y recargar para ver el resultado.
 * Solo se monta en desarrollo, con ?editar=1 en la URL — ver EditableBrandSwirls.
 */
export function BrandSwirlsEditor({
  swirls,
  onChange,
  onReset,
}: {
  swirls: SwirlPlacement[];
  onChange: (index: number, next: SwirlPlacement) => void;
  onReset: () => void;
}) {
  // Leva solo registra el schema de "Exportar" una vez al montar, así que
  // los botones de abajo cerrarían sobre el `swirls`/`onReset` de ESE
  // primer render y no verían ediciones posteriores. Un ref que se
  // actualiza en cada render evita ese cierre obsoleto sin depender de
  // cómo/cuándo Leva decide re-crear el schema.
  const swirlsRef = useRef(swirls);
  swirlsRef.current = swirls;
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  useControls("Exportar", () => ({
    "Copiar código": button(() => {
      const code = `const SWIRLS: SwirlPlacement[] = [\n${swirlsRef.current.map(formatSwirlCode).join("\n")}\n];`;
      navigator.clipboard.writeText(code).then(
        () => {
          // eslint-disable-next-line no-alert
          alert("Copiado — pégalo en el archivo, reemplazando el arreglo de swirls actual.");
        },
        () => {
          // eslint-disable-next-line no-alert
          alert(`No se pudo copiar automáticamente. Cópialo manualmente:\n\n${code}`);
        }
      );
    }),
    "Descartar borrador": button(() => {
      // eslint-disable-next-line no-alert
      if (confirm("Esto descarta tus ajustes sin exportar y regresa a los valores actuales del código. ¿Continuar?")) {
        onResetRef.current();
      }
    }),
  }));

  return (
    <>
      {swirls.map((s, i) => (
        <SwirlFolder
          key={i}
          label={`${i + 1}. ${s.src.split("/").pop()}`}
          initial={s}
          onChange={(next) => onChange(i, next)}
        />
      ))}
    </>
  );
}
