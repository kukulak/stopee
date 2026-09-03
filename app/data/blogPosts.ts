export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  content: string[];
  publishedAt: string;
  readingMinutes: number;
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "manejo-consciente-de-residuos",
    title: "Manejo consciente de residuos: la bolsa no es el final del camino",
    excerpt:
      "Recoger la popa con bolsa es solo el primer paso. Te explicamos por qué depositarla en el drenaje domiciliario es la forma correcta de cerrar el círculo.",
    publishedAt: "2026-01-12",
    readingMinutes: 4,
    content: [
      "Como comunidad ya adoptamos un hábito clave: recoger las heces de nuestros perros con una bolsa durante el paseo. Ese es un logro real de convivencia urbana. El siguiente paso, el que todavía no completamos como ciudad, es la disposición final correcta de esa bolsa.",
      "Dejar bolsas cerradas en botes de basura abiertos, expuestas al sol durante horas, acelera la descomposición y libera bacterias y olores hacia el entorno. La recomendación es simple y directa: al llegar a casa, vacía el contenido de la bolsa directamente en el escusado o coladera domiciliaria y desecha la bolsa por separado en el bote de basura.",
      "Este pequeño ajuste de rutina reduce la carga bacteriana en la vía pública, mejora el manejo higiénico de residuos y evita que otros vecinos, niños o mascotas tengan contacto indirecto con material orgánico expuesto.",
      "En STOPee creemos que la higiene urbana canina se resuelve con hábitos claros y accesibles para todos, no con reglas complicadas. Popa a la coladera, orina neutralizada con STOPee: dos acciones, una ciudad más limpia.",
    ],
  },
  {
    slug: "la-regla-de-oro-de-la-correa",
    title: "La regla de oro de la correa urbana",
    excerpt:
      "Aunque tu perro sea el más tranquilo del mundo, la correa siempre debe estar puesta en la vía pública. Aquí te contamos por qué.",
    publishedAt: "2026-01-19",
    readingMinutes: 3,
    content: [
      "\"Mi perro es súper tranquilo, no necesita correa\" es una de las frases que más incidentes evitables genera en la vía pública. La correa no es un juicio sobre el temperamento de tu perro: es una garantía de control ante lo impredecible del entorno urbano.",
      "Un ruido fuerte, otro perro, una bicicleta o simplemente un olor interesante pueden hacer que cualquier perro, sin importar su entrenamiento, reaccione de forma repentina. La correa firme y bien ajustada te da el margen de control necesario para proteger a tu perro, a otros perros y a las personas que comparten la banqueta contigo.",
      "Además, muchas personas sienten temor genuino hacia los perros, incluso los más pequeños. Ver una correa puesta, sujeta con firmeza, transmite respeto hacia esas personas y hacia el espacio compartido.",
      "El paseo responsable empieza con dos cosas: correa siempre puesta y STOPee siempre a la mano. Así garantizamos seguridad y limpieza en cada cuadra.",
    ],
  },
  {
    slug: "protocolos-de-acercamiento-canino",
    title: "Protocolos de acercamiento canino: pide permiso antes de saludar",
    excerpt:
      "No todos los perros quieren socializar en cada paseo. Te compartimos las buenas prácticas para acercamientos seguros entre perros y tutores.",
    publishedAt: "2026-01-26",
    readingMinutes: 3,
    content: [
      "Ver a otro perro en la banqueta no siempre significa que ambos quieren o pueden saludarse. Algunos perros están en entrenamiento, se están recuperando de una cirugía, tienen ansiedad o simplemente no disfrutan la interacción con otros perros, aunque se vean tranquilos.",
      "La buena práctica de convivencia es simple: antes de acercar a tu perro a otro, pregunta en voz alta al tutor del otro perro si su perro puede saludar. Un \"¿se puede acercar?\" evita la gran mayoría de los incidentes entre perros en espacios públicos.",
      "Si la respuesta es no, respétala sin insistir. Mantén a tu perro con la correa corta y continúa el paseo con normalidad. No es un rechazo personal, es una decisión responsable del otro tutor sobre el bienestar de su perro.",
      "Estas pequeñas señales de respeto construyen colonias donde pasear con perro es una experiencia segura y agradable para todos, con o sin correa larga, con o sin ganas de socializar ese día.",
    ],
  },
  {
    slug: "por-que-la-orina-daña-el-mobiliario-urbano",
    title: "Por qué la orina daña el mobiliario urbano (y cómo la biotecnología lo resuelve)",
    excerpt:
      "El ácido úrico ataca directamente concreto, metal y cantera. Te explicamos la ciencia detrás del deterioro urbano y cómo STOPee lo neutraliza.",
    publishedAt: "2026-02-02",
    readingMinutes: 5,
    content: [
      "La orina canina contiene ácido úrico y sales de amonio que, al secarse sobre superficies porosas como concreto, cantera y algunos metales, provocan reacciones químicas persistentes. Estas reacciones no solo generan el mal olor característico de postes y fachadas, también deterioran progresivamente el material con cada exposición repetida.",
      "A diferencia de un limpiador tradicional que solo enmascara el olor temporalmente con fragancia, STOPee actúa mediante biotecnología activa: Bacillus subtilis, un microorganismo benéfico, junto con ricinoleato de zinc, trabajan en conjunto para degradar los compuestos orgánicos de la orina desde su raíz molecular, no solo en la superficie.",
      "El resultado es una neutralización real del olor, no un enmascaramiento, y una reducción directa del desgaste químico sobre el mobiliario urbano: postes, banquetas, muros y fachadas de comercios y vecinos.",
      "Cuidar el mobiliario urbano es cuidar el patrimonio compartido de la colonia. Cada aplicación de STOPee después del paseo es una contribución directa a calles más duraderas y agradables para todos.",
    ],
  },
];

export function getBlogPostBySlug(slug: string) {
  return BLOG_POSTS.find((post) => post.slug === slug) ?? null;
}
