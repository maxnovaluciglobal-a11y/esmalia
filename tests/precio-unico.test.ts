import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// El precio de lista de Esmalia es US$19,99 (Solo) y US$49,99 (Clínica) desde
// el 27-oct-2026. Esta guardia impide que vuelva a colarse el precio viejo
// (US$29 / US$69) en la web, los textos de venta o las comparativas. Los
// precios de COMPETIDORES con esos montos (Doctocliq: US$19, US$29, US$49) se
// reconocen por la línea: nombra al competidor o los lista junto a US$19.
const RAIZ = path.resolve(__dirname, "../src");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.(ts|tsx|md)$/.test(nombre) ? [ruta] : [];
  });
}

describe("precio de lista único", () => {
  it("ninguna página ni componente de Esmalia nombra US$29 ni US$69 como su precio", () => {
    const sospechosas: string[] = [];
    for (const ruta of archivos(RAIZ)) {
      const lineas = readFileSync(ruta, "utf8").split("\n");
      lineas.forEach((linea, i) => {
        if (!/US\$(29|69)\b/.test(linea)) return;
        const esCompetidor = /Doctocliq|US\$19\b|US\$49\b|Básico/.test(linea);
        const esTabla = /^\s*"US\$29",\s*$/.test(linea); // fila del plan Básico de Doctocliq
        if (esCompetidor || esTabla) return;
        sospechosas.push(`${path.relative(RAIZ, ruta)}:${i + 1}`);
      });
    }
    expect(sospechosas).toEqual([]);
  });
});
