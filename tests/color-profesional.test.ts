import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  colorDePaleta,
  colorProfesional,
  contraste,
  COLOR_PROFESIONAL_POR_DEFECTO,
  PALETA_PROFESIONALES,
} from "@/lib/clinic-operations/color-profesional";

// AGE-06: color por profesional con una paleta de tokens accesible.

const css = readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8");

/** Valor de una variable dentro del primer bloque que empieza con `selector {`. */
function valorEn(selector: string, variable: string): string | undefined {
  const inicio = css.indexOf(`\n${selector} {`);
  if (inicio < 0) return undefined;
  const fin = css.indexOf("\n}", inicio);
  const bloque = css.slice(inicio, fin);
  return new RegExp(`--${variable}:\\s*(#[0-9a-fA-F]{6})`).exec(bloque)?.[1];
}

const FONDOS_CLAROS = [valorEn(":root", "card"), valorEn(":root", "background")];
const FONDOS_OSCUROS = [valorEn(".dark", "card"), valorEn(".dark", "background")];

describe("paleta de colores por profesional", () => {
  it("styles.css define cada token en claro y en oscuro con los mismos valores", () => {
    for (const c of PALETA_PROFESIONALES) {
      expect(valorEn(":root", c.token)?.toLowerCase(), c.token).toBe(c.claro);
      expect(valorEn(".dark", c.token)?.toLowerCase(), c.token).toBe(c.oscuro);
    }
  });

  it("cada color pasa 3:1 contra la tarjeta y el fondo, en los dos modos (WCAG 1.4.11)", () => {
    expect(FONDOS_CLAROS.every(Boolean)).toBe(true);
    expect(FONDOS_OSCUROS.every(Boolean)).toBe(true);
    for (const c of PALETA_PROFESIONALES) {
      for (const fondo of FONDOS_CLAROS) {
        expect(contraste(c.claro, fondo!), `${c.nombre} claro`).toBeGreaterThanOrEqual(3);
      }
      for (const fondo of FONDOS_OSCUROS) {
        expect(contraste(c.oscuro, fondo!), `${c.nombre} oscuro`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("los ocho son distintos y con nombre", () => {
    expect(new Set(PALETA_PROFESIONALES.map((c) => c.claro)).size).toBe(8);
    expect(new Set(PALETA_PROFESIONALES.map((c) => c.nombre)).size).toBe(8);
  });

  it("un color de la paleta cae exacto en su token", () => {
    for (const c of PALETA_PROFESIONALES) {
      expect(colorDePaleta(c.claro).token).toBe(c.token);
      expect(colorDePaleta(c.claro.toUpperCase()).token).toBe(c.token);
      expect(colorProfesional(c.claro)).toBe(`var(--${c.token})`);
    }
  });

  it("un hex libre de antes cae en el token más parecido", () => {
    // El verde azulado que traía la base por defecto → petróleo.
    expect(colorDePaleta("#0d9488").token).toBe("prof-2");
    // Un rojo → terracota o frambuesa, nunca un verde.
    expect(["prof-3", "prof-8"]).toContain(colorDePaleta("#c62828").token);
    // El ocre de la marca → ocre.
    expect(colorDePaleta("#a8772c").token).toBe("prof-1");
    expect(colorDePaleta("#36c").token).toBe("prof-6");
  });

  it("un valor ilegible cae en el primero, sin romper", () => {
    expect(colorDePaleta("").token).toBe("prof-1");
    expect(colorDePaleta(null).token).toBe("prof-1");
    expect(colorDePaleta("teal").token).toBe("prof-1");
    expect(COLOR_PROFESIONAL_POR_DEFECTO).toBe(PALETA_PROFESIONALES[0].claro);
  });
});

describe("paleta de la base (migración 20261023200200)", () => {
  it("public.paleta_profesionales() tiene los mismos colores y en el mismo orden que PALETA_PROFESIONALES", () => {
    const sql = readFileSync(
      path.resolve(
        __dirname,
        "../supabase/migrations/20261023200200_colores_distintos_por_profesional.sql",
      ),
      "utf8",
    );
    const enSql = /select array\[([^\]]+)\]/.exec(sql)?.[1].match(/#[0-9a-f]{6}/gi) ?? [];
    expect(enSql).toEqual(PALETA_PROFESIONALES.map((c) => c.claro));
  });
});
