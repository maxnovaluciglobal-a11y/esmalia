// Servidor de la página de prueba de los visores (solo desarrollo).
// El dev server de la app (TanStack Start) responde todo el HTML con sus
// rutas, así que esta página se sirve con un Vite simple, aparte:
//
//   npx vite --config src/components/visores/prueba/vite.config.ts
//   → http://localhost:8096/src/components/visores/prueba/index.html
//
// No forma parte del build de producción.
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  root: process.cwd(),
  plugins: [tailwindcss(), viteReact()],
  resolve: { alias: { "@": `${process.cwd()}/src` } },
  css: { transformer: "lightningcss" },
  server: { port: 8096, strictPort: true, open: false },
});
