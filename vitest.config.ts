import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Configuración aparte de vite.config.ts a propósito: aquella carga el plugin de Remix,
// que no hace falta (ni conviene) para probar funciones y rutas sueltas.
export default defineConfig({
  // Mismo alias que tsconfig.json ("~/" = app/); se declara aquí porque tests/ no entra en ese tsconfig.
  resolve: { alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "tests/**/*.test.ts"],
    // "._*" son los archivos fantasma que macOS crea en discos externos: no son pruebas.
    exclude: ["**/node_modules/**", "**/build/**", "**/._*"],
    setupFiles: ["tests/setup.ts"],
    // Las pruebas con base de datos real comparten una sola base temporal: en serie para no pisarse.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
