import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Espeja el alias "@/*" -> "src/*" de tsconfig.json (vite-tanstack-config
    // lo agrega en la app real vía tsConfigPaths, pero acá vitest no carga
    // ese preset). Sin esto, cualquier test que importe algo de src/lib con
    // el alias falla en resolución de módulos.
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Aborta la corrida si alguna variable de conexión apunta a producción
    // (ver docs/TESTS.md). La suite corre solo contra la base local efímera.
    globalSetup: ["./tests/setup/guard-produccion.ts"],
    environment: "node",
    testTimeout: 30_000,
    // Las pruebas comparten una base: se ejecutan en serie con rollback por test.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
