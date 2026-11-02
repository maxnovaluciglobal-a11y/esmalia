import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Esmalia habla como equipo (decisión del 02-nov-2026): la web pública y lo que
// lee la clínica no nombran a una persona. Los comentarios del código no cuentan.
const RAIZ = path.resolve(__dirname, "../src");
const SUPERFICIES = [
  "content",
  "components/marketing",
  "lib/seo.ts",
  "routes/nosotros.tsx",
  "routes/recorrido.tsx",
  "routes/precios.tsx",
  "routes/index.tsx",
  "routes/faq.tsx",
];
const PERSONA = /walter|la madriz|\bsoy\b.*fundador|con el fundador|su fundador|escr[ií]beme/i;

function archivos(ruta: string): string[] {
  if (!statSync(ruta).isDirectory()) return [ruta];
  return readdirSync(ruta).flatMap((nombre) => archivos(path.join(ruta, nombre)));
}

function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe("voz de equipo", () => {
  it("ninguna superficie pública nombra a una persona", () => {
    const hallazgos = SUPERFICIES.flatMap((s) => archivos(path.join(RAIZ, s)))
      .filter((archivo) => PERSONA.test(sinComentarios(readFileSync(archivo, "utf8"))))
      .map((archivo) => path.relative(RAIZ, archivo));
    expect(hallazgos).toEqual([]);
  });
});
