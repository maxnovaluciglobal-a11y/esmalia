#!/usr/bin/env node
/**
 * Genera el HTML de las plantillas de autenticación de Supabase.
 *
 *   node scripts/plantillas-auth-supabase.mjs
 *
 * Escribe `.email-muestras/auth/<plantilla>.html` y un `asuntos.txt`. Cada
 * HTML se pega en Supabase → Authentication → Emails → Templates. Sale del
 * mismo `layout.ts` que los correos de ciclo de vida (ver
 * `src/lib/email/plantillas-auth.ts`). No toca la base ni manda nada.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const salida = path.join(raiz, ".email-muestras", "auth");

const vite = await createServer({
  root: raiz,
  configFile: false,
  logLevel: "error",
  resolve: { tsconfigPaths: true },
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});

try {
  const { plantillasAuth } = await vite.ssrLoadModule("/src/lib/email/plantillas-auth.ts");
  mkdirSync(salida, { recursive: true });
  const asuntos = [];
  for (const [nombre, c] of Object.entries(plantillasAuth())) {
    writeFileSync(path.join(salida, `${nombre}.html`), c.html);
    asuntos.push(`${nombre}: ${c.subject}`);
  }
  writeFileSync(path.join(salida, "asuntos.txt"), `${asuntos.join("\n")}\n`);
  console.log(`Listo: ${asuntos.length} plantillas en ${path.relative(raiz, salida)}/`);
} finally {
  await vite.close();
}
