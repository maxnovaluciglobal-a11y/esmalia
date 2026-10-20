// Config de Vite propia (sin `@lovable.dev/vite-tanstack-config`).
// Replica lo que ese preset armaba FUERA del sandbox de Lovable: sus plugins de
// sandbox, HMR gate, dev-server bridge y assets proxy sólo se activaban dentro
// del editor, así que acá no hacen falta. Ver docs/DESACOPLE_LOVABLE.md.
import { defineConfig, loadEnv, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// Fuera de Lovable (p. ej. Vercel) el preset de Nitro se toma de NITRO_PRESET;
// si no está definido, Nitro autodetecta la plataforma (Vercel/Netlify/Cloudflare).
const nitroPreset = process.env.NITRO_PRESET;

export default defineConfig(async ({ command, mode }) => {
  const plugins: PluginOption[] = [];

  // Devtools primero y sólo en dev, igual que hacía el preset.
  if (mode === "development") {
    const { devtools } = await import("@tanstack/devtools-vite");
    plugins.push(
      devtools({
        logging: false,
        eventBusConfig: { enabled: false },
        enhancedLogs: { enabled: false },
        consolePiping: { enabled: false },
        removeDevtoolsOnBuild: false,
        injectSource: { enabled: true },
      }),
    );
  }

  plugins.push(tailwindcss());
  plugins.push(
    tanstackStart({
      // security-review 01-sep: acá había un `client: { files: ["**/server/**"] }`
      // custom — el glob no matchea nada real (los archivos server-only del
      // repo son `*.server.ts` sueltos, no viven en un directorio `server/`)
      // y, peor, el plugin REEMPLAZA (no extiende) el default `files` cuando
      // el usuario define uno propio — así que esto anulaba la protección
      // real de TanStack Start contra bundlear `*.server.ts` en el cliente.
      // Sacado por completo: el default ya cubre exactamente ese patrón.
      importProtection: { behavior: "error" },
      // Redirige el server entry de TanStack Start a src/server.ts (wrapper de errores SSR).
      server: { entry: "server" },
    }),
  );

  // Nitro sólo participa del build, nunca del dev server.
  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(
      nitro({
        ...(nitroPreset ? { preset: nitroPreset } : {}),
        // Ronda de fix 1 sobre Task 13 (revisión rigurosa, CRITICAL):
        // `serverAssets` es el mecanismo documentado de Nitro para bundlear
        // un binario no-JS de forma que quede disponible en runtime dentro
        // de una función serverless — ver src/routes/api.recurso.$slug.ts
        // para el porqué (`new URL(..., import.meta.url)` sin esto, que era
        // el intento anterior dentro de esta misma ronda, se confirmó roto
        // por inspección directa de `npm run build:vercel`: el literal
        // sobrevivía sin procesar y el PDF no aparecía en ningún lado de
        // `.vercel/output`). Mapea `assets-privados/` bajo el mount
        // `assets:recursos` — accesible en runtime vía
        // `useStorage("assets:recursos")` (import de `nitro/storage`).
        serverAssets: [{ baseName: "recursos", dir: "assets-privados" }],
      }),
    );
  }

  plugins.push(viteReact());

  // Inyección explícita de las VITE_* (el preset hacía esto para que lleguen al bundle SSR).
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), "VITE_"))) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  return {
    define: envDefine,
    build: {
      rollupOptions: {
        output: {
          // Rollup iza al chunk de entrada todo lo que comparten varios
          // chunks. Con los imports de Supabase ya diferidos, esto lo deja
          // además en un archivo propio: se descarga sólo cuando hace falta y
          // sobrevive a los deploys en la caché del navegador, porque no
          // cambia cuando cambia el código de la app.
          manualChunks(id: string) {
            // El helper de precarga de Vite va aparte: si no, Rolldown lo
            // mete en el primer chunk manual (este de Supabase) y la landing,
            // que necesita el helper, terminaba precargando supabase-js
            // entero (~53 KB gzip) sin usarlo (auditoría 07-oct-2026).
            if (id.includes("vite/preload-helper")) return "preload-helper";
            if (id.includes("node_modules/@supabase/")) return "supabase";
            return undefined;
          },
        },
      },
    },
    css: { transformer: "lightningcss" as const },
    resolve: {
      // Vite 8 resolves tsconfig `paths` natively (replaces vite-tsconfig-paths).
      tsconfigPaths: true,
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      ignoreOutdatedRequests: true,
    },
    server: { host: "::", port: Number(process.env.PORT) || 8080 },
    plugins,
  };
});
