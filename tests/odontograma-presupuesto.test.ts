import { describe, expect, it } from "vitest";

import type { OdontogramMark } from "@/lib/clinical/odontogram";
import {
  estadoDeLinea,
  estadoDominante,
  hallazgosPorTratar,
  motivoPorTratar,
  presupuestoPorPieza,
  resumenPorEstado,
} from "@/lib/clinical/odontograma-presupuesto";
import type { Quote, QuoteItem, QuoteStatus } from "@/lib/finance/finance";

const HOY = "2026-10-27";

function item(p: Partial<QuoteItem>): QuoteItem {
  return {
    id: crypto.randomUUID(),
    procedureId: null,
    nameSnapshot: "Prestación",
    toothNumber: null,
    surface: null,
    quantity: 1,
    unitPriceCents: 10000,
    discountCents: 0,
    discountPct: null,
    totalCents: 10000,
    coverageCents: null,
    patientCents: null,
    phaseLabel: null,
    phasePosition: 0,
    position: 0,
    notes: null,
    odontogramMarkId: null,
    accepted: null,
    packageId: null,
    packageNameSnapshot: null,
    ...p,
  };
}

function quote(status: QuoteStatus, items: QuoteItem[], validUntil: string | null = null): Quote {
  return {
    id: crypto.randomUUID(),
    number: `P-${status}`,
    status,
    validUntil,
    items,
  } as unknown as Quote;
}

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

describe("estado de cada línea sobre la pieza (ODO-06)", () => {
  it("mapea los estados del presupuesto a aceptado, por aceptar o borrador", () => {
    const it0 = item({});
    expect(estadoDeLinea(quote("accepted", []), it0, HOY)).toBe("aceptado");
    expect(estadoDeLinea(quote("converted", []), it0, HOY)).toBe("aceptado");
    expect(estadoDeLinea(quote("sent", []), it0, HOY)).toBe("por_aceptar");
    expect(estadoDeLinea(quote("draft", []), it0, HOY)).toBe("borrador");
  });

  it("rechazados, vencidos y líneas no aceptadas no cuentan", () => {
    expect(estadoDeLinea(quote("rejected", []), item({}), HOY)).toBeNull();
    expect(estadoDeLinea(quote("expired", []), item({}), HOY)).toBeNull();
    expect(estadoDeLinea(quote("sent", [], "2026-10-01"), item({}), HOY)).toBeNull();
    const parcial = quote("partially_accepted", []);
    expect(estadoDeLinea(parcial, item({ accepted: false }), HOY)).toBeNull();
    expect(estadoDeLinea(parcial, item({ accepted: true }), HOY)).toBe("aceptado");
  });

  it("agrupa por pieza, separa lo que no tiene pieza y totaliza por estado", () => {
    const p = presupuestoPorPieza(
      [
        quote("accepted", [
          item({ toothNumber: 36, totalCents: 50000 }),
          item({ totalCents: 3000 }),
        ]),
        quote("draft", [item({ toothNumber: 36, totalCents: 20000 }), item({ toothNumber: 11 })]),
        quote("rejected", [item({ toothNumber: 21 })]),
      ],
      HOY,
    );
    expect([...p.porPieza.keys()].sort()).toEqual([11, 36]);
    expect(p.sinPieza).toHaveLength(1);
    expect(estadoDominante(p.porPieza.get(36)!)).toBe("aceptado");
    expect(estadoDominante(p.porPieza.get(11)!)).toBe("borrador");
    const resumen = Object.fromEntries(resumenPorEstado(p).map((r) => [r.estado, r]));
    expect(resumen.aceptado).toEqual({
      estado: "aceptado",
      piezas: 1,
      lineas: 2,
      totalCents: 53000,
    });
    expect(resumen.borrador).toEqual({
      estado: "borrador",
      piezas: 2,
      lineas: 2,
      totalCents: 30000,
    });
    expect(resumen.por_aceptar.lineas).toBe(0);
  });
});

describe("hallazgos por tratar (ODO-07)", () => {
  it("piden tratamiento lo patológico, lo que está en mal estado y lo por realizar", () => {
    expect(motivoPorTratar(marca({ toothNumber: 16, surface: "oclusal" }))).toBe("patologia");
    expect(
      motivoPorTratar(marca({ toothNumber: 16, condition: "corona", conservation: "malo" })),
    ).toBe("mal_estado");
    expect(
      motivoPorTratar(marca({ toothNumber: 16, condition: "corona", status: "planificado" })),
    ).toBe("por_realizar");
    expect(
      motivoPorTratar(marca({ toothNumber: 16, condition: "corona", conservation: "bueno" })),
    ).toBeNull();
    expect(motivoPorTratar(marca({ toothNumber: 16, condition: "ausente" }))).toBeNull();
    expect(
      motivoPorTratar(marca({ toothNumber: 16, condition: "observacion", notes: "x" })),
    ).toBeNull();
    expect(
      motivoPorTratar(marca({ toothNumber: 16, supersededAt: "2026-10-01T00:00:00Z" })),
    ).toBeNull();
  });

  it("excluye lo vinculado a una línea y lo cubierto por una línea de la misma pieza y zona", () => {
    const vinculada = marca({ toothNumber: 46, condition: "endodoncia", status: "planificado" });
    const cubierta = marca({ toothNumber: 36, surface: "oclusal" });
    const otraCara = marca({ toothNumber: 26, surface: "mesial" });
    const libre = marca({ toothNumber: 11, surface: "vestibular" });
    const enRechazado = marca({ toothNumber: 21, condition: "fractura" });
    const p = presupuestoPorPieza(
      [
        quote("draft", [
          item({ toothNumber: 47, odontogramMarkId: vinculada.id }),
          item({ toothNumber: 36 }),
          item({ toothNumber: 26, surface: "distal" }),
        ]),
        quote("rejected", [item({ toothNumber: 21 })]),
      ],
      HOY,
    );
    const r = hallazgosPorTratar([vinculada, cubierta, otraCara, libre, enRechazado], p);
    expect(r.map((h) => h.marca.toothNumber)).toEqual([11, 21, 26]);
    expect(r.map((h) => h.motivo)).toEqual(["patologia", "patologia", "patologia"]);
  });
});
