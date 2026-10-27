import { describe, expect, it } from "vitest";

import type { PeriodontalChart, PeriodontalPoint } from "@/lib/clinical/periodontal";
import {
  UMBRAL_CAMBIO_MM,
  compararExamenes,
  nicDePieza,
  nicDeSitio,
  resumenNic,
  severidadNic,
} from "@/lib/clinical/periodontal-nic";

type Sitio = { pd: number | null; rec?: number | null; bop?: boolean | null };

function examen(
  id: string,
  recordedAt: string,
  piezas: Record<number, Partial<Record<PeriodontalPoint, Sitio>>>,
): PeriodontalChart {
  return {
    id,
    patientId: "p",
    notes: null,
    recordedById: "u",
    recordedByName: null,
    recordedAt,
    teeth: Object.entries(piezas).map(([t, sitios]) => ({
      toothNumber: Number(t),
      mobility: null,
      furcation: null,
      points: Object.entries(sitios).map(([point, s]) => ({
        point: point as PeriodontalPoint,
        pocketDepthMm: s!.pd,
        recessionMm: s!.rec ?? null,
        bleeding: s!.bop ?? null,
      })),
    })),
  };
}

describe("NIC por sitio (PER-02)", () => {
  it("es profundidad más recesión", () => {
    expect(nicDeSitio(4, 2)).toBe(6);
    expect(nicDeSitio(3, 0)).toBe(3);
  });

  it("con agrandamiento (recesión negativa) resta, sin bajar de 0", () => {
    expect(nicDeSitio(5, -2)).toBe(3);
    expect(nicDeSitio(2, -3)).toBe(0);
  });

  it("sin recesión o sin profundidad no se inventa: null (regla 11)", () => {
    expect(nicDeSitio(4, null)).toBeNull();
    expect(nicDeSitio(null, 2)).toBeNull();
    expect(nicDeSitio(Number.NaN, 1)).toBeNull();
  });

  it("severidad orientativa por rangos AAP/EFP 2017", () => {
    expect(severidadNic(null)).toBeNull();
    expect(severidadNic(0)).toBe("sin_perdida");
    expect(severidadNic(2)).toBe("leve");
    expect(severidadNic(3)).toBe("moderada");
    expect(severidadNic(4)).toBe("moderada");
    expect(severidadNic(5)).toBe("severa");
  });

  it("NIC de cada sitio de una pieza, en orden", () => {
    const e = examen("a", "2026-01-01T00:00:00Z", { 16: { mv: { pd: 5, rec: 1 }, v: { pd: 3 } } });
    expect(nicDePieza(e.teeth[0])).toEqual({
      mv: 6,
      v: null,
      dv: null,
      ml: null,
      l: null,
      dl: null,
    });
  });

  it("resumen: promedio, máximo con su sitio, severidad y sitios sin recesión", () => {
    const e = examen("a", "2026-01-01T00:00:00Z", {
      16: { mv: { pd: 5, rec: 2 }, v: { pd: 2, rec: 0 }, dv: { pd: 4 } },
      11: { v: { pd: 3, rec: 1 } },
    });
    const r = resumenNic(e);
    expect(r.sitiosConNic).toBe(3);
    expect(r.sitiosSinRecesion).toBe(1);
    expect(r.maximo).toBe(7);
    expect(r.sitioMaximo).toEqual({ toothNumber: 16, point: "mv" });
    expect(r.promedio).toBe(4.3);
    expect(r.porSeveridad).toEqual({ sin_perdida: 0, leve: 1, moderada: 1, severa: 1 });
  });

  it("un examen sin recesiones no tiene NIC", () => {
    const r = resumenNic(examen("a", "2026-01-01T00:00:00Z", { 16: { mv: { pd: 5 } } }));
    expect(r.promedio).toBeNull();
    expect(r.maximo).toBeNull();
    expect(r.sitiosSinRecesion).toBe(1);
  });
});

describe("comparar exámenes (PER-03)", () => {
  const antes = examen("antes", "2026-03-01T10:00:00Z", {
    16: {
      mv: { pd: 6, rec: 1, bop: true },
      v: { pd: 3, rec: 0, bop: false },
      dv: { pd: 4, bop: true },
    },
    26: { mv: { pd: 3, rec: 0, bop: false } },
  });
  const despues = examen("despues", "2026-09-01T10:00:00Z", {
    16: {
      mv: { pd: 3, rec: 1, bop: false },
      v: { pd: 5, rec: 1, bop: true },
      dv: { pd: 5, bop: false },
    },
    36: { v: { pd: 4, rec: 0 } },
  });

  it("el más antiguo es siempre 'antes', en cualquier orden", () => {
    const c1 = compararExamenes(antes, despues);
    const c2 = compararExamenes(despues, antes);
    expect(c1.antesId).toBe("antes");
    expect(c2.antesId).toBe("antes");
    expect(c2.sitios).toEqual(c1.sitios);
  });

  it("clasifica cada sitio con el NIC si hay recesión y si no con la profundidad", () => {
    const { sitios } = compararExamenes(antes, despues);
    const mv = sitios.find((s) => s.point === "mv")!;
    expect(mv).toMatchObject({ deltaPd: -3, deltaNic: -3, tendencia: "mejoro", base: "nic" });
    const v = sitios.find((s) => s.point === "v")!;
    expect(v).toMatchObject({
      deltaPd: 2,
      nicAntes: 3,
      nicDespues: 6,
      deltaNic: 3,
      tendencia: "empeoro",
    });
    const dv = sitios.find((s) => s.point === "dv")!;
    expect(dv).toMatchObject({ deltaPd: 1, deltaNic: null, tendencia: "estable", base: "pd" });
  });

  it(`un cambio menor a ${UMBRAL_CAMBIO_MM} mm es "sin cambio"`, () => {
    const a = examen("a", "2026-01-01T00:00:00Z", { 11: { v: { pd: 3, rec: 0 } } });
    const b = examen("b", "2026-02-01T00:00:00Z", { 11: { v: { pd: 4, rec: 0 } } });
    expect(compararExamenes(a, b).sitios[0].tendencia).toBe("estable");
  });

  it("resume mejoras, empeoramientos, sitios no comparables, sangrado y bolsas", () => {
    const { resumen } = compararExamenes(antes, despues);
    expect(resumen).toEqual({
      comparables: 3,
      mejoraron: 1,
      empeoraron: 1,
      estables: 1,
      soloAntes: 1,
      soloDespues: 1,
      pdMedioAntes: 4.3,
      pdMedioDespues: 4.3,
      sangradoAntesPct: 67,
      sangradoDespuesPct: 33,
      bolsas4Antes: 2,
      bolsas4Despues: 2,
    });
  });
});
