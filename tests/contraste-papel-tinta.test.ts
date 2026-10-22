import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Papel y tinta A+ (19-oct-2026): el texto llega a AA (4,5:1) y los bordes de
// control a 3:1 (WCAG 1.4.11) sobre papel, superficie, tarjeta y muted, en
// claro y en oscuro. La tarjeta se sigue separando del papel (auditoría del
// 07-oct: antes todo se leía como un mismo gris).

const CSS = readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8");

type Tokens = { hex: Record<string, string>; mezcla: Record<string, [string, number]> };

function bloque(selector: string): Tokens {
  const inicio = CSS.indexOf(`\n${selector} {`);
  const fin = CSS.indexOf("\n}", inicio);
  const texto = CSS.slice(inicio, fin);
  const hex: Record<string, string> = {};
  for (const m of texto.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) hex[m[1]] = m[2];
  const mezcla: Record<string, [string, number]> = {};
  for (const m of texto.matchAll(/--([\w-]+):\s*color-mix\(in srgb, (#[0-9a-f]{6}) (\d+)%/gi))
    mezcla[m[1]] = [m[2], Number(m[3]) / 100];
  return { hex, mezcla };
}

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lineal = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminancia = (c: number[]) => {
  const [r, g, b] = c.map(lineal);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a: number[], b: number[]) => {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const sobre = (frente: string, alfa: number, fondo: string) => {
  const [f, b] = [rgb(frente), rgb(fondo)];
  return f.map((v, i) => v * alfa + b[i] * (1 - alfa));
};

const claro = bloque(":root");
const oscuroPropio = bloque(".dark");
const oscuro: Tokens = {
  hex: { ...claro.hex, ...oscuroPropio.hex },
  mezcla: { ...claro.mezcla, ...oscuroPropio.mezcla },
};

const FONDOS = ["background", "surface", "card", "muted"];
const TEXTOS = [
  "foreground",
  "muted-foreground",
  "brand-700",
  "primary",
  "destructive",
  "success",
  "warning",
  "info",
  "neutral",
  "ai",
];

describe.each([
  ["claro", claro],
  ["oscuro", oscuro],
] as const)("papel y tinta (%s)", (_modo, t) => {
  it.each(TEXTOS)("%s llega a 4,5:1 sobre papel, superficie, tarjeta y muted", (texto) => {
    for (const fondo of FONDOS) {
      expect(contraste(rgb(t.hex[texto]), rgb(t.hex[fondo]))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("los bordes de control llegan a 3:1", () => {
    for (const token of ["input", "control"]) {
      const [base, alfa] = t.mezcla[token];
      for (const fondo of FONDOS) {
        const borde = sobre(base, alfa, t.hex[fondo]);
        expect(contraste(borde, rgb(t.hex[fondo]))).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("los derivados mezclan con la tinta vigente", () => {
    for (const token of ["border", "divider", "hairline", "input", "control"]) {
      expect(t.mezcla[token][0].toLowerCase()).toBe(t.hex.foreground.toLowerCase());
    }
  });
});

describe("valores A+", () => {
  it("claro usa el papel, la tarjeta y la tinta del prototipo", () => {
    expect(claro.hex.background).toBe("#f4f2ee");
    expect(claro.hex.card).toBe("#fcfbf9");
    expect(claro.hex.foreground).toBe("#15120f");
  });

  it("la tarjeta se separa del papel (≥ 1,08:1) en claro", () => {
    expect(contraste(rgb(claro.hex.card), rgb(claro.hex.background))).toBeGreaterThanOrEqual(1.08);
  });
});

// UX-12 (Ola 0): el esquema de superficies del odontograma se pinta sobre la
// tarjeta, así que tiene su propio par claro/oscuro. Las marcas (azul
// "existente", rojo "patología o por hacer") se distinguen del neutro con
// ≥ 3:1 (WCAG 1.4.11), y en oscuro el neutro ya no es un cuadro gris claro.
describe.each([
  ["claro", claro],
  ["oscuro", oscuro],
] as const)("esquema del odontograma (%s)", (modo, t) => {
  it("azul y rojo se separan del neutro (≥ 3:1)", () => {
    for (const marca of ["odonto-azul", "odonto-rojo"]) {
      expect(contraste(rgb(t.hex[marca]), rgb(t.hex["odonto-neutro"]))).toBeGreaterThanOrEqual(3);
    }
  });

  it("el neutro acompaña el modo de la tarjeta", () => {
    const neutro = luminancia(rgb(t.hex["odonto-neutro"]));
    if (modo === "oscuro") expect(neutro).toBeLessThan(0.1);
    else expect(neutro).toBeGreaterThan(0.6);
  });
});
