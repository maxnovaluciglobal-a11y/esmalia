import { describe, expect, it } from "vitest";

import {
  EXPLICACION_CONSERVACION,
  FILTROS_DE_ARCHIVO,
  parseFiltroDeArchivo,
} from "../src/lib/patients/archivo";
import {
  alergiasConFusionadas,
  destinoFinal,
  fichasAbsorbidas,
  unirSinRepetir,
} from "../src/lib/patients/fusion";

/**
 * Pruebas puras (sin base) de LEG-08/CLI-05 (archivo de fichas) y CLI-06
 * (lo que una ficha fusionada le sigue mostrando a la que quedó).
 */
describe("archivo de fichas", () => {
  it("sin filtro o con un valor desconocido muestra solo las fichas activas", () => {
    expect(parseFiltroDeArchivo(undefined)).toBe("activas");
    expect(parseFiltroDeArchivo("")).toBe("activas");
    expect(parseFiltroDeArchivo("borradas")).toBe("activas");
  });

  it("acepta los tres filtros válidos", () => {
    for (const f of FILTROS_DE_ARCHIVO) expect(parseFiltroDeArchivo(f)).toBe(f);
  });

  it("el texto de archivar explica la conservación legal y que se puede restaurar", () => {
    expect(EXPLICACION_CONSERVACION).toMatch(/no se elimina/);
    expect(EXPLICACION_CONSERVACION).toMatch(/15/);
    expect(EXPLICACION_CONSERVACION).toMatch(/restaurar/);
  });
});

describe("fichas fusionadas", () => {
  const filas = [
    { id: "A", merged_into: "B" },
    { id: "B", merged_into: "C" },
    { id: "D", merged_into: "C" },
    { id: "C", merged_into: null },
    { id: "E", merged_into: null },
  ];

  it("encuentra las fichas absorbidas directa e indirectamente", () => {
    expect(fichasAbsorbidas("C", filas).sort()).toEqual(["A", "B", "D"]);
    expect(fichasAbsorbidas("B", filas)).toEqual(["A"]);
    expect(fichasAbsorbidas("E", filas)).toEqual([]);
  });

  it("no se cuelga con un ciclo (datos corruptos)", () => {
    const ciclo = [
      { id: "X", merged_into: "Y" },
      { id: "Y", merged_into: "X" },
    ];
    expect(fichasAbsorbidas("X", ciclo)).toEqual(["Y"]);
    expect(destinoFinal(ciclo).size).toBe(2);
  });

  it("cada ficha absorbida apunta a la que quedó al final de la cadena", () => {
    const destinos = destinoFinal(filas);
    expect(destinos.get("A")).toBe("C");
    expect(destinos.get("B")).toBe("C");
    expect(destinos.get("D")).toBe("C");
    expect(destinos.has("C")).toBe(false);
  });

  it("une alergias sin repetir, sin distinguir mayúsculas ni espacios", () => {
    expect(unirSinRepetir(["Penicilina"], [" penicilina ", "Látex"], [""])).toEqual([
      "Penicilina",
      "Látex",
    ]);
  });

  it("la agenda avisa en la ficha que quedó las alergias de la absorbida", () => {
    const propias = { A: ["Penicilina"], C: ["Látex"], E: ["AINE"] };
    const resultado = alergiasConFusionadas(propias, filas);
    expect(resultado.C).toEqual(["Látex", "Penicilina"]);
    // La absorbida conserva las suyas (su ficha se sigue pudiendo abrir).
    expect(resultado.A).toEqual(["Penicilina"]);
    expect(resultado.E).toEqual(["AINE"]);
  });

  it("una ficha que absorbió otra sin alergias propias igual recibe la alerta", () => {
    const resultado = alergiasConFusionadas({ A: ["Penicilina"] }, filas);
    expect(resultado.C).toEqual(["Penicilina"]);
  });
});
