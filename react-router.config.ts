import type { Config } from "@react-router/dev/config";

// Con React Router 7 el renderizado en servidor y los antiguos "future flags" de Remix 2
// (single fetch, descubrimiento perezoso de rutas, etc.) ya son el comportamiento normal.
export default {
  ssr: true,
} satisfies Config;
