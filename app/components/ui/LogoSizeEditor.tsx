import { useControls, button } from "leva";
import { useEffect } from "react";

/**
 * Agrega una carpeta "Logo" al panel de Leva ya abierto por
 * EditableBrandSwirls (comparten el mismo panel <Leva> global — ver
 * EditableLogo). Solo se monta en desarrollo con ?editar=1 en la URL.
 *
 * El schema se pasa como función (en vez de un objeto) para que Leva lo
 * registre una sola vez al montar y no lo vuelva a crear en cada render —
 * si no, el valor inicial y el botón "Copiar clase" quedan leyendo una
 * copia vieja de `heightPx` en vez del valor real del slider.
 */
export function LogoSizeEditor({
  heightPx,
  onChange,
}: {
  heightPx: number;
  onChange: (next: number) => void;
}) {
  const [values, , get] = useControls("Logo", () => ({
    heightPx: { value: heightPx, min: 24, max: 240, step: 1, label: "altura (px)" },
    "Copiar clase": button(() => {
      const code = `h-[${Math.round(get("heightPx"))}px]`;
      navigator.clipboard.writeText(code).then(
        () => {
          // eslint-disable-next-line no-alert
          alert(`Copiado: ${code} — pégalo reemplazando la clase h-* actual del logo.`);
        },
        () => {
          // eslint-disable-next-line no-alert
          alert(`No se pudo copiar automáticamente. Cópialo manualmente: ${code}`);
        }
      );
    }),
  }));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    onChange(values.heightPx);
  }, [values.heightPx]);

  return null;
}
