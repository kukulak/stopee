import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// El puerto sale de PORT en .env (el default de Vite, 5173, chocaba con otros
// proyectos locales). strictPort: si está ocupado, falla en vez de saltar
// en silencio a otro puerto — así la URL de STOPee nunca cambia sola.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const port = Number(env.PORT) || 4827;

  return {
    server: { port, strictPort: true },
    preview: { port, strictPort: true },
    // Las opciones del framework (antes aquí, bajo `remix({...})`) viven en react-router.config.ts.
    plugins: [reactRouter(), tsconfigPaths()],
  };
});
