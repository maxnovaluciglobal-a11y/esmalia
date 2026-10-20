import { describe, expect, it } from "vitest";

import {
  CONDITION_CATALOG,
  TOOTH_CONDITIONS,
  type ToothCondition,
} from "@/lib/clinical/odontogram";
import type { Procedure, Quote, QuoteItem, QuoteStatus } from "@/lib/finance/finance";
import {
  FASE_INICIAL,
  PALABRAS_POR_CONDICION,
  debeSugerir,
  fasesParaSugerir,
  marcasYaPresupuestadas,
  nombreDelItem,
  normalizar,
  presupuestoBorrador,
  procedimientoSugerido,
  type ContextoSugerencia,
} from "@/lib/finance/sugerencia-presupuesto";

function proc(over: Partial<Procedure> & { id: string; name: string }): Procedure {
  return {
    code: null,
    category: null,
    defaultPriceCents: 10000,
    currency: "CLP",
    durationMin: null,
    isActive: true,
    allowsDiscount: true,
    referencePriceCents: null,
    labCostCents: null,
    position: 0,
    ...over,
  };
}

function item(over: Partial<QuoteItem> = {}): QuoteItem {
  return {
    id: crypto.randomUUID(),
    procedureId: null,
    nameSnapshot: "Ítem",
    toothNumber: null,
    surface: null,
    quantity: 1,
    unitPriceCents: 1000,
    discountCents: 0,
    discountPct: null,
    totalCents: 1000,
    coverageCents: null,
    patientCents: null,
    phaseLabel: null,
    phasePosition: 0,
    position: 0,
    notes: null,
    odontogramMarkId: null,
    ...over,
  };
}

function quote(status: QuoteStatus, items: QuoteItem[], over: Partial<Quote> = {}): Quote {
  return {
    id: crypto.randomUUID(),
    number: "P-2026-0001",
    status,
    currency: "CLP",
    subtotalCents: 0,
    discountCents: 0,
    commercialDiscountPct: null,
    totalCents: 0,
    agreementId: null,
    agreementNameSnapshot: null,
    coverageTotalCents: null,
    notes: null,
    validUntil: null,
    sentAt: null,
    acceptedAt: null,
    rejectedAt: null,
    acceptedByName: null,
    createdAt: "2026-10-19T12:00:00Z",
    items,
    ...over,
  };
}

const ARANCEL = [
  proc({ id: "ctrl", name: "Control y limpieza", position: 0 }),
  proc({ id: "endo", name: "Endodoncia molar", code: "END-01", position: 1 }),
  proc({ id: "obt", name: "Obturación resina", position: 2 }),
  proc({ id: "corona", name: "Corona cerámica", position: 3 }),
  proc({ id: "vieja", name: "Implante (antiguo)", isActive: false, position: 4 }),
];

describe("procedimientoSugerido: condición → prestación del arancel", () => {
  it("encuentra la prestación por nombre, sin importar tildes ni mayúsculas", () => {
    expect(procedimientoSugerido("endodoncia", ARANCEL)?.id).toBe("endo");
    expect(procedimientoSugerido("obturacion", ARANCEL)?.id).toBe("obt");
    expect(procedimientoSugerido("corona", ARANCEL)?.id).toBe("corona");
  });

  it("también reconoce un sinónimo (resina = obturación)", () => {
    const arancel = [proc({ id: "r", name: "Resina compuesta clase II" })];
    expect(procedimientoSugerido("obturacion", arancel)?.id).toBe("r");
  });

  it("busca en el código de la prestación", () => {
    const arancel = [proc({ id: "x", name: "Tratamiento", code: "ENDODONCIA-1" })];
    expect(procedimientoSugerido("endodoncia", arancel)?.id).toBe("x");
  });

  it("ignora prestaciones dadas de baja", () => {
    expect(procedimientoSugerido("implante", ARANCEL)).toBeNull();
  });

  it("sin coincidencia devuelve null (la ficha pide elegir del arancel)", () => {
    expect(procedimientoSugerido("carilla", ARANCEL)).toBeNull();
  });

  it("solo hay palabras para tratamientos: lo que se puede dejar por realizar", () => {
    for (const c of Object.keys(PALABRAS_POR_CONDICION) as ToothCondition[]) {
      expect(CONDITION_CATALOG[c].categoria, c).toBe("tratamiento");
    }
    // Y todo tratamiento tiene sus palabras.
    for (const c of TOOTH_CONDITIONS) {
      if (CONDITION_CATALOG[c].categoria === "tratamiento") {
        expect(PALABRAS_POR_CONDICION[c]?.length, c).toBeGreaterThan(0);
      }
    }
  });

  it("normalizar quita tildes", () => {
    expect(normalizar(" Obturación PRÓTESIS ")).toBe("obturacion protesis");
  });
});

describe("debeSugerir", () => {
  const base: ContextoSugerencia = {
    puedeFacturar: true,
    soloLectura: false,
    marca: { id: "m1", condition: "endodoncia", status: "planificado" },
    yaPresupuestadas: new Set(),
  };

  it("un tratamiento por realizar, con permiso, se sugiere", () => {
    expect(debeSugerir(base)).toBe(true);
  });

  it("sin permiso de facturar no hay sugerencia", () => {
    expect(debeSugerir({ ...base, puedeFacturar: false })).toBe(false);
  });

  it("en solo lectura no se ofrece lo que el servidor va a rechazar", () => {
    expect(debeSugerir({ ...base, soloLectura: true })).toBe(false);
  });

  it("lo existente no sugiere nada", () => {
    expect(debeSugerir({ ...base, marca: { ...base.marca, status: "existente" } })).toBe(false);
  });

  it("una patología o un hallazgo no se sugiere aunque llegue como planificado", () => {
    expect(
      debeSugerir({ ...base, marca: { id: "m", condition: "caries", status: "planificado" } }),
    ).toBe(false);
  });

  it("una marca ya presupuestada no se vuelve a sugerir (PR 11b)", () => {
    expect(debeSugerir({ ...base, yaPresupuestadas: new Set(["m1"]) })).toBe(false);
  });

  it("volver a guardar la misma indicación no la duplica en el presupuesto", () => {
    const yaPresupuestadas = new Set(["vieja"]);
    expect(
      debeSugerir({
        ...base,
        yaPresupuestadas,
        reemplaza: [{ id: "vieja", condition: "endodoncia" }],
      }),
    ).toBe(false);
  });

  it("si reemplaza otra condición presupuestada (obturación → sellante), sí se sugiere", () => {
    expect(
      debeSugerir({
        ...base,
        marca: { id: "m2", condition: "sellante", status: "planificado" },
        yaPresupuestadas: new Set(["obt"]),
        reemplaza: [{ id: "obt", condition: "obturacion" }],
      }),
    ).toBe(true);
  });
});

describe("marcasYaPresupuestadas", () => {
  it("cuenta las marcas de presupuestos vigentes, no las de rechazados o vencidos", () => {
    const ids = marcasYaPresupuestadas([
      quote("draft", [item({ odontogramMarkId: "a" }), item()]),
      quote("sent", [item({ odontogramMarkId: "b" })]),
      quote("accepted", [item({ odontogramMarkId: "c" })]),
      quote("converted", [item({ odontogramMarkId: "d" })]),
      quote("rejected", [item({ odontogramMarkId: "e" })]),
      quote("expired", [item({ odontogramMarkId: "f" })]),
    ]);
    expect([...ids].sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("presupuestoBorrador", () => {
  it("elige el borrador más reciente y nunca uno enviado", () => {
    const viejo = quote("draft", [], { id: "viejo", createdAt: "2026-10-01T10:00:00Z" });
    const nuevo = quote("draft", [], { id: "nuevo", createdAt: "2026-10-18T10:00:00Z" });
    const enviado = quote("sent", [], { id: "enviado", createdAt: "2026-10-19T10:00:00Z" });
    expect(presupuestoBorrador([viejo, enviado, nuevo])?.id).toBe("nuevo");
  });

  it("sin borrador devuelve null (el servidor crea uno)", () => {
    expect(presupuestoBorrador([quote("sent", [])])).toBeNull();
    expect(presupuestoBorrador([])).toBeNull();
  });
});

describe("fasesParaSugerir", () => {
  it("sin presupuesto ofrece Fase 1", () => {
    expect(fasesParaSugerir(null)).toEqual({
      opciones: [FASE_INICIAL],
      sugerida: FASE_INICIAL,
      nueva: FASE_INICIAL,
    });
  });

  it("un borrador sin fases también arranca en Fase 1", () => {
    expect(fasesParaSugerir(quote("draft", [item()])).sugerida).toBe("Fase 1");
  });

  it("respeta el orden del presupuesto, sugiere la primera y suma una fase nueva", () => {
    const q = quote("draft", [
      item({ phaseLabel: "Fase 2", phasePosition: 1 }),
      item({ phaseLabel: "Fase 1", phasePosition: 0 }),
      item({ phaseLabel: "Fase 1", phasePosition: 0, position: 1 }),
      item({ phaseLabel: null }),
    ]);
    expect(fasesParaSugerir(q)).toEqual({
      opciones: ["Fase 1", "Fase 2", "Fase 3"],
      sugerida: "Fase 1",
      nueva: "Fase 3",
    });
  });

  it("la fase nueva no repite un nombre que la clínica ya usa", () => {
    const q = quote("draft", [
      item({ phaseLabel: "Urgencia", phasePosition: 0 }),
      item({ phaseLabel: "Fase 3", phasePosition: 1 }),
    ]);
    // Dos fases → la nueva sería "Fase 3", que ya existe: pasa a "Fase 4".
    expect(fasesParaSugerir(q).nueva).toBe("Fase 4");
  });
});

describe("nombreDelItem", () => {
  it("usa el nombre del arancel, o el de la condición si no hay prestación", () => {
    expect(nombreDelItem(ARANCEL[1], "endodoncia")).toBe("Endodoncia molar");
    expect(nombreDelItem(null, "carilla")).toBe(CONDITION_CATALOG.carilla.label);
  });
});
