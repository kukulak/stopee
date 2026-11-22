/** Aviso arriba del catálogo: cuál es la estrella actual y cómo cambiarla. */
export function StarNote({ currentStarName }: { currentStarName: string | null }) {
  return (
    <p className="mt-4 rounded-2xl bg-bosque/5 p-4 text-sm text-carbon/70">
      {currentStarName ? (
        <>
          Estrella actual de la tienda: <span className="font-semibold text-carbon">{currentStarName}</span>.{" "}
        </>
      ) : (
        <>Ahora no hay ninguna estrella. </>
      )}
      Solo puede haber una (entre productos y paquetes): al marcar otra con “Hacer estrella”, la anterior se desmarca sola.
    </p>
  );
}
