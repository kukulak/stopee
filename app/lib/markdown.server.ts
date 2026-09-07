import { marked } from "marked";

marked.setOptions({ breaks: true });

/** Convierte el markdown guardado en BlogPost.content a HTML para renderizar en el artículo público. */
export function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string;
}
