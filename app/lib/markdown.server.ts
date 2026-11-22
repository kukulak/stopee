import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

marked.setOptions({ breaks: true });

/**
 * Convierte markdown a HTML para renderizar en páginas públicas (blog,
 * producto, aviso de privacidad, términos). El markdown lo edita un admin de
 * confianza, pero se sanitiza igual como defensa en profundidad: si algún
 * día una cuenta de admin se ve comprometida (o el editor cambia y ya no es
 * un solo admin de confianza), esto evita que termine en un <script>
 * persistente en una página pública en vez de "solo" un texto raro.
 */
export function renderMarkdown(content: string): string {
  const html = marked.parse(content, { async: false }) as string;
  return DOMPurify.sanitize(html);
}
