/**
 * Celda de CSV segura. Excel, Numbers y Google Sheets ejecutan como fórmula
 * cualquier celda de texto que empiece con = + - @ (o con tabulador / retorno
 * de carro): un correo como "=HYPERLINK(...)@x.com" escrito en el formulario
 * público de lista de espera se ejecutaría al abrir la exportación. Se antepone
 * una comilla simple, que las hojas de cálculo muestran como texto literal.
 */
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
