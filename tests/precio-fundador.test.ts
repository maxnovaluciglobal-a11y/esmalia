import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PRECIO_FUNDADOR_EXPLICACION,
  PRECIO_FUNDADOR_TITULO,
} from "@/lib/marketing/precio-fundador";

// El precio fundador es 50 % durante 12 meses y después el precio de lista
// (decisión de Walter, 20-oct-2026). Ninguna página pública puede volver a
// prometer "de por vida" o "mientras sean clientes".

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : [p];
  });
}

const RAIZ = path.resolve(__dirname, "../src");
const FUENTES = archivos(RAIZ).filter(
  (f) => /\.(ts|tsx|md)$/.test(f) && !f.endsWith("routeTree.gen.ts"),
);

const PROHIBIDAS = [
  /precio fundador,? de por vida/i,
  /precio fundador de por vida/i,
  /mientras sean clientes/i,
  /conservan (este |el )?precio/i,
  /conservan el precio de su plan/i,
];

describe("precio fundador", () => {
  it("ninguna fuente promete conservar el precio de por vida", () => {
    const hallazgos: string[] = [];
    for (const f of FUENTES) {
      const texto = readFileSync(f, "utf8");
      for (const re of PROHIBIDAS) {
        if (re.test(texto)) hallazgos.push(`${path.relative(RAIZ, f)} → ${re}`);
      }
    }
    expect(hallazgos).toEqual([]);
  });

  it("la definición dice 50 %... la mitad, 12 meses, precio de lista y aviso de 30 días", () => {
    expect(PRECIO_FUNDADOR_TITULO).toMatch(/mitad/i);
    expect(PRECIO_FUNDADOR_EXPLICACION).toMatch(/mitad/);
    expect(PRECIO_FUNDADOR_EXPLICACION).toMatch(/12 meses/);
    expect(PRECIO_FUNDADOR_EXPLICACION).toMatch(/precio de lista/);
    expect(PRECIO_FUNDADOR_EXPLICACION).toMatch(/30 días/);
  });

  it("/precios usa la definición en el FAQ y en el encabezado", () => {
    const rutaPrecios = readFileSync(path.join(RAIZ, "routes/precios.tsx"), "utf8");
    const planes = readFileSync(path.join(RAIZ, "components/marketing/precios.tsx"), "utf8");
    expect(rutaPrecios).toContain("PRECIO_FUNDADOR_EXPLICACION");
    expect(planes).toContain("PRECIO_FUNDADOR_TITULO");
    expect(planes).toContain("PRECIO_FUNDADOR_EXPLICACION");
  });

  it("los Términos describen lo mismo que la oferta", () => {
    const t = readFileSync(path.join(RAIZ, "routes/terminos.tsx"), "utf8").replace(/\s+/g, " ");
    expect(t).toContain("descuento del 50 % sobre el precio del plan durante 12 meses");
    expect(t).toContain("Versión 4");
  });
});
