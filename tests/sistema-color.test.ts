import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  clasePastilla,
  estiloDeCita,
  estiloEstadoCita,
  tonoDeCita,
  tonoDeEstadoCita,
} from "@/lib/clinic-operations/estado-cita-tono";

// Guardia del sistema de color (auditoría 07-oct-2026): los colores salen de
// los tokens de styles.css. Una clase de la paleta de Tailwind (amber-600,
// emerald-600, sky-50…) se salta el sistema, no tiene modo oscuro pensado y
// en dos casos no llegaba a AA.
const PALETA_TAILWIND =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration)-(?:red|green|amber|emerald|blue|yellow|sky|rose|orange|violet|purple|pink|teal|cyan|lime|indigo|fuchsia|slate|gray|zinc|stone)-\d{2,3}\b/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.(tsx?|css)$/.test(nombre) ? [ruta] : [];
  });
}

// Cobalto A+ (plan del 19-oct-2026): es un color de DATOS (ocupación, línea
// de "ahora", gráficos de caja). No es un color de estado y nunca entra al
// odontograma, donde el azul clínico (#1f5fbf) significa "existente" y un
// cobalto al lado se confundiría con él.
const USO_COBALTO =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|shadow|accent|caret|divide)-cobalt(?:-[a-z-]+)?\b|--(?:color-)?cobalt\b|#(?:2e4bff|2238d6|e4e8ff|8e9dff|a9b4ff|1e2450)\b/i;

// Dónde se puede usar el cobalto (rutas relativas a src/).
const COBALTO_PERMITIDO: RegExp[] = [
  /^styles\.css$/, // donde se definen los tokens
  /(?:^|\/)agenda-[^/]+\.tsx?$/,
  /(?:^|\/)kpis-en-filete\.tsx$/,
  /(?:^|\/)cajas\.tsx$/,
  /(?:^|\/)caja-del-dia\.tsx$/, // tarjeta en tinta de la caja: barras por hora y por medio
  /(?:^|\/)embudo-presupuestos\.tsx$/, // barras del embudo de presupuestos (A+)
  /(?:^|\/)finance-reports[^/]*\.tsx?$/,
  /^components\/marketing\//,
];

// Todo lo que pinta dientes. Ninguno puede mencionar el cobalto.
const ODONTOGRAMA = [
  "components/odontogram.tsx",
  "components/diente-anatomico.tsx",
  "components/odontograma-hallazgos.ts",
  "components/periodontal-chart.tsx",
  "components/odontograma-sugerencia-presupuesto.tsx",
  "lib/clinical/odontograma-reglas.ts",
];

function usosDeCobaltoFueraDeLugar(raiz: string, rutas: string[]): string[] {
  return rutas.flatMap((ruta) => {
    const relativa = path.relative(raiz, ruta).split(path.sep).join("/");
    if (COBALTO_PERMITIDO.some((re) => re.test(relativa))) return [];
    return readFileSync(ruta, "utf8")
      .split("\n")
      .flatMap((linea, i) => {
        const m = linea.match(USO_COBALTO);
        return m ? [`${relativa}:${i + 1} ${m[0]}`] : [];
      });
  });
}

describe("sistema de color", () => {
  it("no usa clases de la paleta de Tailwind fuera de los tokens", () => {
    const raiz = path.resolve(__dirname, "../src");
    const hallazgos = archivos(raiz).flatMap((ruta) =>
      readFileSync(ruta, "utf8")
        .split("\n")
        .flatMap((linea, i) => {
          const m = linea.match(PALETA_TAILWIND);
          return m ? [`${path.relative(raiz, ruta)}:${i + 1} ${m[0]}`] : [];
        }),
    );
    expect(hallazgos).toEqual([]);
  });

  it("el cobalto se usa solo para datos (lista blanca de archivos)", () => {
    const raiz = path.resolve(__dirname, "../src");
    expect(usosDeCobaltoFueraDeLugar(raiz, archivos(raiz))).toEqual([]);
  });

  it("la guardia del cobalto atrapa un uso fuera de la lista blanca", () => {
    // Prueba de la propia regex: si alguien la afloja, esto falla.
    for (const linea of [
      'className="text-cobalt"',
      'className="bg-cobalt-soft"',
      "stroke: var(--cobalt);",
      'fill="#2E4BFF"',
      "color: var(--color-cobalt-ink);",
    ]) {
      expect(linea).toMatch(USO_COBALTO);
    }
    expect('className="text-info"').not.toMatch(USO_COBALTO);
  });

  it("el odontograma nunca usa cobalto", () => {
    const raiz = path.resolve(__dirname, "../src");
    for (const relativa of ODONTOGRAMA) {
      const fuente = readFileSync(path.join(raiz, relativa), "utf8");
      expect(fuente, relativa).not.toMatch(/cobalt/i);
      expect(fuente, relativa).not.toMatch(USO_COBALTO);
    }
    // Ninguna lista blanca puede cubrir un archivo del odontograma.
    for (const relativa of ODONTOGRAMA) {
      expect(
        COBALTO_PERMITIDO.some((re) => re.test(relativa)),
        relativa,
      ).toBe(false);
    }
  });

  it("cada estado de cita tiene un tono distinto", () => {
    const tonos = Object.values(tonoDeEstadoCita);
    expect(new Set(tonos).size).toBe(tonos.length);
    for (const tono of tonos) expect(clasePastilla[tono]).toBeTruthy();
  });

  it("una tentativa que el paciente confirmó se ve como confirmada", () => {
    expect(tonoDeCita({ estado: "tentativa", pacienteConfirmo: true })).toBe("success");
    expect(tonoDeCita({ estado: "tentativa", pacienteConfirmo: false })).toBe("warning");
    expect(tonoDeCita({ estado: "ausente" })).toBe("danger");
  });

  it("cada estado tiene una combinación distinta de forma e ícono", () => {
    const estilos = Object.values(estiloEstadoCita);
    const combos = estilos.map((e) => `${e.forma}/${e.icono}`);
    expect(new Set(combos).size).toBe(combos.length);
    // Los íconos solos ya distinguen los cinco estados (sirve en gris).
    expect(new Set(estilos.map((e) => e.icono)).size).toBe(estilos.length);
  });

  it("en sala es el único estado sólido", () => {
    const solidos = Object.entries(estiloEstadoCita).filter(([, e]) => e.forma === "solido");
    expect(solidos.map(([estado]) => estado)).toEqual(["en-sala"]);
    expect(estiloEstadoCita["en-sala"].clase).toContain("bg-info");
    expect(estiloEstadoCita["en-sala"].clase).toContain("text-background");
  });

  it("confirmada y ausente no dependen solo del color (deuteranopía)", () => {
    const c = estiloEstadoCita.confirmada;
    const a = estiloEstadoCita.ausente;
    expect(c.icono).not.toBe(a.icono);
    expect(c.tono).toBe("success");
    expect(a.tono).toBe("danger");
  });

  it("sin respuesta va punteado con reloj y finalizada es solo texto", () => {
    expect(estiloEstadoCita.tentativa).toMatchObject({ forma: "punteado", icono: "reloj" });
    expect(estiloEstadoCita.tentativa.clase).toContain("border-dashed");
    expect(estiloEstadoCita.finalizada.forma).toBe("texto");
    expect(estiloEstadoCita.finalizada.clase).toContain("bg-transparent");
    expect(estiloEstadoCita.finalizada.clase).toContain("text-neutral");
  });

  it("el tono de cada forma sale del mapa único de tonos", () => {
    for (const [estado, e] of Object.entries(estiloEstadoCita)) {
      expect(e.tono).toBe(tonoDeEstadoCita[estado as keyof typeof tonoDeEstadoCita]);
    }
  });

  it("una tentativa que el paciente confirmó toma la forma de confirmada", () => {
    expect(estiloDeCita({ estado: "tentativa", pacienteConfirmo: true })).toBe(
      estiloEstadoCita.confirmada,
    );
    expect(estiloDeCita({ estado: "tentativa" })).toBe(estiloEstadoCita.tentativa);
  });
});
