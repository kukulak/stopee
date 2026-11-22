import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

declare module "@remix-run/node" {
  interface Future {
    v3_singleFetch: true;
  }
}

// El puerto sale de PORT en .env (el default de Vite, 5173, chocaba con otros
// proyectos locales). strictPort: si está ocupado, falla en vez de saltar
// en silencio a otro puerto — así la URL de STOPee nunca cambia sola.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const port = Number(env.PORT) || 4827;

  return {
    server: { port, strictPort: true },
    preview: { port, strictPort: true },
    plugins: [
      remix({
        future: {
          v3_fetcherPersist: true,
          v3_relativeSplatPath: true,
          v3_throwAbortReason: true,
          v3_singleFetch: true,
          v3_lazyRouteDiscovery: true,
        },
      }),
      tsconfigPaths(),
    ],
  };
});
