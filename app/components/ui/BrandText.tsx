/**
 * Escribe el nombre de la marca SIEMPRE como «STOPee» (STOP en mayúsculas, ee en
 * minúsculas), aunque el texto venga de la base de datos con otra forma o el
 * estilo de la etiqueta sea `uppercase`, que pondría el nombre completo en mayúsculas.
 * Úsalo en cualquier etiqueta en mayúsculas que pueda contener el nombre.
 */
export function BrandText({ children }: { children: string }) {
  return (
    <>
      {children.split(/(stopee)/gi).map((part, index) =>
        /^stopee$/i.test(part) ? (
          <span key={index} className="normal-case">
            STOPee
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
