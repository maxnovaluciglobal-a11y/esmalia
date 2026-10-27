import { describe, expect, it } from "vitest";

import {
  FDI_ALL_ADULT,
  FDI_ALL_PRIMARY,
  separarObservaciones,
  type OdontogramMark,
} from "@/lib/clinical/odontogram";
import {
  SEXTANTES,
  piezasDelSextante,
  rangoDelSextante,
  resumenPorSextante,
  sextanteDePieza,
} from "@/lib/clinical/odontograma-sextantes";
import { marcasQueReemplaza } from "@/lib/clinical/odontograma-reglas";

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

describe("sextanteDePieza (ODO-04)", () => {
  it("divide la dentición permanente en los seis sextantes clásicos", () => {
    expect([18, 17, 16, 15, 14].map(sextanteDePieza)).toEqual([1, 1, 1, 1, 1]);
    expect([13, 12, 11, 21, 22, 23].map(sextanteDePieza)).toEqual([2, 2, 2, 2, 2, 2]);
    expect([24, 25, 26, 27, 28].map(sextanteDePieza)).toEqual([3, 3, 3, 3, 3]);
    expect([34, 35, 36, 37, 38].map(sextanteDePieza)).toEqual([4, 4, 4, 4, 4]);
    expect([33, 32, 31, 41, 42, 43].map(sextanteDePieza)).toEqual([5, 5, 5, 5, 5, 5]);
    expect([44, 45, 46, 47, 48].map(sextanteDePieza)).toEqual([6, 6, 6, 6, 6]);
  });

  it("en la temporal el anterior va de canino a canino y los molares son posteriores", () => {
    expect([55, 54].map(sextanteDePieza)).toEqual([1, 1]);
    expect([53, 52, 51, 61, 62, 63].map(sextanteDePieza)).toEqual([2, 2, 2, 2, 2, 2]);
    expect([64, 65].map(sextanteDePieza)).toEqual([3, 3]);
    expect([74, 75].map(sextanteDePieza)).toEqual([4, 4]);
    expect([73, 83].map(sextanteDePieza)).toEqual([5, 5]);
    expect([84, 85].map(sextanteDePieza)).toEqual([6, 6]);
  });

  it("devuelve null para números que no son FDI", () => {
    expect(sextanteDePieza(10)).toBeNull();
    expect(sextanteDePieza(19)).toBeNull();
    expect(sextanteDePieza(56)).toBeNull();
    expect(sextanteDePieza(91)).toBeNull();
  });

  it("cada pieza permanente y temporal cae en exactamente un sextante", () => {
    for (const t of [...FDI_ALL_ADULT, ...FDI_ALL_PRIMARY]) {
      expect(SEXTANTES).toContain(sextanteDePieza(t));
    }
    const total = SEXTANTES.reduce((s, x) => s + piezasDelSextante(x, FDI_ALL_ADULT).length, 0);
    expect(total).toBe(32);
  });

  it("rango del sextante según el orden en pantalla", () => {
    const visibles = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
    expect(rangoDelSextante(1, visibles)).toBe("18–14");
    expect(rangoDelSextante(2, visibles)).toBe("13–23");
    expect(rangoDelSextante(4, visibles)).toBe("—");
  });
});

describe("resumenPorSextante", () => {
  it("cuenta piezas, no marcas, y separa patológico, por realizar y ausente", () => {
    const marcas = [
      marca({ toothNumber: 16, surface: "oclusal" }),
      marca({ toothNumber: 16, surface: "mesial" }),
      marca({ toothNumber: 17, condition: "corona", status: "planificado" }),
      marca({ toothNumber: 18, condition: "ausente" }),
      marca({ toothNumber: 15, condition: "corona", conservation: "bueno" }),
      marca({ toothNumber: 14, condition: "sano" }),
      // Reemplazada: no cuenta.
      marca({ toothNumber: 11, supersededAt: "2026-10-01T00:00:00Z" }),
    ];
    const [s1, s2] = resumenPorSextante(marcas, FDI_ALL_ADULT);
    expect(s1).toEqual({
      sextante: 1,
      piezas: 5,
      conHallazgos: 4,
      patologicas: 1,
      porRealizar: 1,
      ausentes: 1,
    });
    expect(s2.conHallazgos).toBe(0);
  });

  it("ignora piezas que no están en la dentición en pantalla", () => {
    const r = resumenPorSextante([marca({ toothNumber: 54 })], FDI_ALL_ADULT);
    expect(r.every((s) => s.conHallazgos === 0)).toBe(true);
  });
});

describe("observación por pieza (ODO-08)", () => {
  it("separa la observación vigente con texto de las marcas clínicas", () => {
    const vieja = marca({
      toothNumber: 21,
      condition: "observacion",
      notes: "antes",
      supersededAt: "2026-10-02T00:00:00Z",
    });
    const vigente = marca({ toothNumber: 21, condition: "observacion", notes: "Sensible al frío" });
    const vacia = marca({ toothNumber: 22, condition: "observacion", notes: null });
    const caries = marca({ toothNumber: 21, surface: "oclusal" });
    const { clinicas, observaciones } = separarObservaciones([vieja, vigente, vacia, caries]);
    expect(clinicas).toEqual([caries]);
    expect(observaciones.get(21)?.notes).toBe("Sensible al frío");
    expect(observaciones.has(22)).toBe(false);
  });

  it("una observación solo reemplaza a la observación de la misma pieza y no toca lo clínico", () => {
    const obs = marca({ toothNumber: 21, condition: "observacion", notes: "x" });
    const sano = marca({ toothNumber: 21, condition: "sano" });
    const caries = marca({ toothNumber: 21, surface: "oclusal" });
    const otra = marca({ toothNumber: 22, condition: "observacion", notes: "y" });
    const nueva = {
      toothNumber: 21,
      surface: "whole" as const,
      condition: "observacion" as const,
      status: "existente" as const,
    };
    expect(marcasQueReemplaza([obs, sano, caries, otra], nueva)).toEqual([obs.id]);
  });

  it("ni 'sano' ni 'ausente' cierran la observación de la pieza", () => {
    const obs = marca({ toothNumber: 36, condition: "observacion", notes: "x" });
    const caries = marca({ toothNumber: 36, surface: "oclusal" });
    const ausente = {
      toothNumber: 36,
      surface: "whole" as const,
      condition: "ausente" as const,
      status: "existente" as const,
    };
    expect(marcasQueReemplaza([obs, caries], ausente)).toEqual([caries.id]);
    expect(marcasQueReemplaza([obs, caries], { ...ausente, condition: "sano" })).toEqual([
      caries.id,
    ]);
  });
});
