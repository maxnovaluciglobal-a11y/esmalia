import { describe, expect, it } from "vitest";

import type { OdontogramMark } from "@/lib/clinical/odontogram";
import {
  MAX_PIEZAS_POR_LOTE,
  alternarPieza,
  describirAplicacion,
  planDeMarcas,
  rangoEnFila,
  seleccionConClic,
} from "@/lib/clinical/odontograma-seleccion";

const SUPERIOR = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const INFERIOR = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

function marca(p: Partial<OdontogramMark> & Pick<OdontogramMark, "toothNumber">): OdontogramMark {
  return {
    id: crypto.randomUUID(),
    surface: "whole",
    condition: "caries",
    status: "existente",
    conservation: null,
    material: null,
    notes: null,
    supersededAt: null,
    recordedAt: "2026-10-27T12:00:00Z",
    recordedById: "u",
    recordedByName: null,
    ...p,
  };
}

let n = 0;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

describe("selección múltiple (ODO-05)", () => {
  it("Ctrl/Cmd alterna una pieza", () => {
    const s = alternarPieza(new Set([16]), 26);
    expect([...s].sort()).toEqual([16, 26]);
    expect([...alternarPieza(s, 16)]).toEqual([26]);
  });

  it("Shift suma el rango de la fila desde la última pieza, en cualquier sentido", () => {
    expect(rangoEnFila(SUPERIOR, 16, 13)).toEqual([16, 15, 14, 13]);
    expect(rangoEnFila(SUPERIOR, 22, 12)).toEqual([12, 11, 21, 22]);
  });

  it("un rango entre arcadas no se arma: solo suma la pieza tocada", () => {
    expect(rangoEnFila(SUPERIOR, 16, 46)).toEqual([46]);
    const s = seleccionConClic({
      seleccion: new Set([16]),
      tooth: 46,
      mods: { rango: true },
      ancla: 16,
      filas: [SUPERIOR, INFERIOR],
    });
    expect([...s].sort()).toEqual([16, 46]);
  });

  it("Shift sin ancla se comporta como alternar", () => {
    const s = seleccionConClic({
      seleccion: new Set(),
      tooth: 36,
      mods: { rango: true },
      ancla: null,
      filas: [SUPERIOR, INFERIOR],
    });
    expect([...s]).toEqual([36]);
  });
});

describe("planDeMarcas", () => {
  it("arma una marca por pieza con lo que cada una reemplaza", () => {
    const sellante = marca({ toothNumber: 16, surface: "oclusal", condition: "sellante" });
    const plan = planDeMarcas({
      piezas: [26, 16, 16],
      surface: "oclusal",
      condition: "caries",
      status: "existente",
      conservation: "bueno",
      vigentesPorPieza: new Map([[16, [sellante]]]),
      nuevoId: ids,
    });
    expect(plan.error).toBeNull();
    expect(plan.marcas.map((m) => m.toothNumber)).toEqual([16, 26]);
    // La caries reemplaza al sellante de la misma cara (grupo "superficie").
    expect(plan.marcas[0].baseMarkIds).toEqual([sellante.id]);
    // Bueno/malo no aplica a una patología: no viaja.
    expect(plan.marcas.every((m) => m.conservation === null)).toBe(true);
  });

  it("omite las piezas que ya tienen exactamente esa marca y las ausentes", () => {
    const plan = planDeMarcas({
      piezas: [36, 46, 47],
      surface: "whole",
      condition: "corona",
      status: "planificado",
      conservation: null,
      vigentesPorPieza: new Map([
        [36, [marca({ toothNumber: 36, condition: "corona", status: "planificado" })]],
        [46, [marca({ toothNumber: 46, condition: "ausente" })]],
      ]),
      nuevoId: ids,
    });
    expect(plan.marcas.map((m) => m.toothNumber)).toEqual([47]);
    expect(plan.omitidas).toEqual([
      { tooth: 36, motivo: "ya la tiene" },
      { tooth: 46, motivo: "está ausente" },
    ]);
  });

  it("un implante sí se planifica sobre una pieza ausente", () => {
    const plan = planDeMarcas({
      piezas: [46],
      surface: "whole",
      condition: "implante",
      status: "planificado",
      conservation: null,
      vigentesPorPieza: new Map([[46, [marca({ toothNumber: 46, condition: "ausente" })]]]),
      nuevoId: ids,
    });
    expect(plan.marcas).toHaveLength(1);
  });

  it("rechaza el lote entero si la condición no va en esa zona", () => {
    const plan = planDeMarcas({
      piezas: [11, 21],
      surface: "oclusal",
      condition: "corona",
      status: "existente",
      conservation: null,
      vigentesPorPieza: new Map(),
    });
    expect(plan.error).toMatch(/pieza completa/);
    expect(plan.marcas).toEqual([]);
  });

  it("rechaza un hallazgo por realizar y los lotes demasiado grandes", () => {
    expect(
      planDeMarcas({
        piezas: [11],
        surface: "whole",
        condition: "giroversion",
        status: "planificado",
        conservation: null,
        vigentesPorPieza: new Map(),
      }).error,
    ).toMatch(/por realizar/);
    expect(
      planDeMarcas({
        piezas: Array.from({ length: MAX_PIEZAS_POR_LOTE + 1 }, (_, i) => i),
        surface: "whole",
        condition: "corona",
        status: "existente",
        conservation: null,
        vigentesPorPieza: new Map(),
      }).error,
    ).toMatch(/máximo/);
  });

  it("describe lo que se va a aplicar para la confirmación", () => {
    expect(
      describirAplicacion({ condition: "caries", surface: "oclusal", status: "existente" }),
    ).toBe("Caries en oclusal / incisal");
    expect(
      describirAplicacion({ condition: "corona", surface: "whole", status: "planificado" }),
    ).toBe("Corona por realizar");
  });
});
