/** Imagen de respaldo para og:image (1200×630, logo centrado con margen de seguridad para que WhatsApp y otras redes no lo recorten) cuando la página no tiene una foto propia (p. ej. un producto sin fotos subidas en /admin/catalog todavía). Ruta relativa: quien la use debe anteponer el origin, igual que cualquier otra imagen de og:image. */
export const DEFAULT_OG_IMAGE = "/elementos-design/og-STOPee.png";

export const DEFAULT_OG_IMAGE_WIDTH = 1200;
export const DEFAULT_OG_IMAGE_HEIGHT = 630;

type OgMetaInput = {
  title: string;
  description: string;
  url: string;
  /** URL absoluta (con http(s)://) — og:image y twitter:image no funcionan bien con rutas relativas. */
  image: string;
  type?: "website" | "product" | "article";
};

/** Tags og: y twitter: comunes a cualquier página con una URL canónica. */
export function buildOgMeta({ title, description, url, image, type = "website" }: OgMetaInput) {
  return [
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: type },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:image", content: image },
    // Con las medidas a la mano, WhatsApp y Facebook muestran la imagen sin esperar a descargarla.
    ...(image.endsWith(DEFAULT_OG_IMAGE)
      ? [
          { property: "og:image:width", content: String(DEFAULT_OG_IMAGE_WIDTH) },
          { property: "og:image:height", content: String(DEFAULT_OG_IMAGE_HEIGHT) },
        ]
      : []),
    { property: "og:locale", content: "es_MX" },
    { property: "og:site_name", content: "STOPee" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
}

/** JSON-LD de producto (schema.org/Product) para las fichas de /tienda/:sku. */
export function buildProductJsonLd({
  name,
  description,
  image,
  url,
  priceMxn,
  sku,
}: {
  name: string;
  description: string;
  image: string;
  url: string;
  priceMxn: number;
  sku: string;
}) {
  return {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@type": "Product",
      name,
      description,
      image,
      sku,
      brand: { "@type": "Brand", name: "STOPee" },
      offers: {
        "@type": "Offer",
        url,
        priceCurrency: "MXN",
        price: priceMxn,
        availability: "https://schema.org/InStock",
      },
    },
  };
}

/** JSON-LD de migas de pan (schema.org/BreadcrumbList) para tienda/producto/blog. */
export function buildBreadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        item: item.url,
      })),
    },
  };
}

/** JSON-LD de preguntas frecuentes (schema.org/FAQPage). */
export function buildFaqJsonLd(faqs: { question: string; answer: string }[]) {
  return {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
  };
}

/** JSON-LD de artículo (schema.org/BlogPosting) para /blog/:slug. */
export function buildBlogPostingJsonLd({
  title,
  description,
  image,
  url,
  publishedAt,
}: {
  title: string;
  description: string;
  image: string;
  url: string;
  publishedAt: string | null;
}) {
  return {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: title,
      description,
      image,
      url,
      ...(publishedAt ? { datePublished: publishedAt } : {}),
      author: { "@type": "Organization", name: "STOPee" },
      publisher: { "@type": "Organization", name: "STOPee" },
    },
  };
}
