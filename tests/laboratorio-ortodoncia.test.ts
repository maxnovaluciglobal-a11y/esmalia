import { describe, expect, it } from "vitest";

import {
  COLORES_POR_GUIA,
  chipsDetalle,
  colorValido,
  detalleDesdeFila,
  fechaComprometidaSugerida,
  hoyEnZona,
  precargaDesdeCatalogo,
} from "@/lib/clinic-operations/lab-orden-detalle";
import { ordenAtrasada, type LabOrder } from "@/lib/finance/finance";
import {
  etapaVigente,
  kindDelSistema,
  mesesCompletos,
  progresoOrtodoncia,
  proximoCambioAlineador,
  diasParaCambio,
} from "@/lib/clinical/ortho";
import { nombreDelSistema, textoCambioAlineador } from "@/lib/clinical/ortho-vistas";

/** Ola 9 · Frente C: lo puro de laboratorio (LAB-03 a LAB-07) y ortodoncia (ORT-02 a ORT-06). */

describe("LAB-03 · color VITA", () => {
  it("las guías tienen sus 16 y 29 colores", () => {
    expect(COLORES_POR_GUIA.vita_classical).toHaveLength(16);
    expect(COLORES_POR_GUIA.vita_3d_master).toHaveLength(29);
  });

  it("el color tiene que existir en la guía elegida", () => {
    expect(colorValido("vita_classical", "A3.5")).toBe(true);
    expect(colorValido("vita_3d_master", "2M2")).toBe(true);
    // A2 es classical, no 3D-Master; 2M2 al revés.
    expect(colorValido("vita_3d_master", "A2")).toBe(false);
    expect(colorValido("vita_classical", "2M2")).toBe(false);
  });

  it("sin color vale con o sin guía; un color sin guía no", () => {
    expect(colorValido(null, null)).toBe(true);
    expect(colorValido("vita_classical", null)).toBe(true);
    expect(colorValido(null, "A2")).toBe(false);
  });
});

describe("LAB-03/04/05 · detalle desde la base y chips", () => {
  it("descarta valores desconocidos en vez de mostrarlos", () => {
    expect(
      detalleDesdeFila({ shade_guide: "otra", shade: "A2", material: "oro", margin_type: "x" }),
    ).toEqual({ shadeGuide: null, shade: null, material: null, marginType: null });
  });

  it("arma los chips en el orden color, material, margen", () => {
    expect(
      chipsDetalle({
        shadeGuide: "vita_classical",
        shade: "A2",
        material: "zirconia",
        marginType: "chaflan",
      }),
    ).toEqual(["A2 · VITA classical", "Zirconia", "Margen chaflán"]);
    expect(
      chipsDetalle({ shadeGuide: null, shade: null, material: null, marginType: null }),
    ).toEqual([]);
  });
});

describe("LAB-06 · plazo y atraso con la zona de la clínica", () => {
  it("la fecha comprometida sugerida es envío + días típicos", () => {
    expect(fechaComprometidaSugerida("2026-10-27", 7)).toBe("2026-11-03");
    expect(fechaComprometidaSugerida("2026-12-28", 5)).toBe("2027-01-02");
    expect(fechaComprometidaSugerida("2026-10-27", 0)).toBe("2026-10-27");
  });

  it("sin plazo típico no inventa una fecha", () => {
    expect(fechaComprometidaSugerida("2026-10-27", null)).toBeNull();
  });

  it("a las 23:00 de Santiago ya es mañana en UTC, pero hoy para la clínica", () => {
    const ahora = new Date("2026-10-28T02:00:00Z"); // 27-oct 23:00 en Santiago (UTC-3)
    expect(hoyEnZona("America/Santiago", ahora)).toBe("2026-10-27");
    expect(hoyEnZona("UTC", ahora)).toBe("2026-10-28");
    expect(hoyEnZona("America/Mexico_City", ahora)).toBe("2026-10-27");
  });

  it("una orden que vence hoy en la clínica no está atrasada aunque en UTC sea mañana", () => {
    const orden = {
      dueOn: "2026-10-27",
      status: "enviado",
    } as LabOrder;
    const ahora = new Date("2026-10-28T02:00:00Z");
    expect(ordenAtrasada(orden, hoyEnZona("America/Santiago", ahora))).toBe(false);
    expect(ordenAtrasada(orden, hoyEnZona("UTC", ahora))).toBe(true);
  });
});

describe("LAB-07 · el catálogo precarga la orden", () => {
  it("completa trabajo, costo, material y fecha comprometida", () => {
    expect(
      precargaDesdeCatalogo(
        {
          name: "Corona de zirconia",
          costCents: 95_000,
          typicalDays: 10,
          material: "zirconia",
        },
        "2026-10-27",
      ),
    ).toEqual({
      descripcion: "Corona de zirconia",
      costoCents: 95_000,
      material: "zirconia",
      comprometido: "2026-11-06",
    });
  });

  it("sin precio visible ni plazo deja esos campos en null (no en cero)", () => {
    const p = precargaDesdeCatalogo(
      { name: "Provisorio", costCents: null, typicalDays: null, material: null },
      "2026-10-27",
    );
    expect(p.costoCents).toBeNull();
    expect(p.comprometido).toBeNull();
  });
});

describe("ORT-02 · sistema", () => {
  it("alineadores es aligners; el resto, brackets", () => {
    expect(kindDelSistema("alineadores")).toBe("aligners");
    expect(kindDelSistema("lingual")).toBe("brackets");
    expect(kindDelSistema("autoligado")).toBe("brackets");
  });

  it("sin sistema cargado muestra el tipo general", () => {
    expect(nombreDelSistema({ system: null, kind: "aligners" })).toBe("Alineadores");
    expect(nombreDelSistema({ system: "esteticos", kind: "brackets" })).toBe("Brackets estéticos");
  });
});

describe("ORT-03 · alineadores", () => {
  const base = {
    alignerChangedOn: "2026-10-20",
    alignerChangeDays: 14,
    alignerCurrent: 5,
    alignerTotal: 20,
  };

  it("el próximo cambio es el inicio del actual + cada cuántos días", () => {
    expect(proximoCambioAlineador(base)).toBe("2026-11-03");
    expect(diasParaCambio("2026-11-03", "2026-10-27")).toBe(7);
  });

  it("en el último alineador o sin datos no hay próximo cambio", () => {
    expect(proximoCambioAlineador({ ...base, alignerCurrent: 20 })).toBeNull();
    expect(proximoCambioAlineador({ ...base, alignerChangeDays: null })).toBeNull();
    expect(proximoCambioAlineador({ ...base, alignerChangedOn: null })).toBeNull();
  });

  it("avisa el cambio vencido o para hoy", () => {
    expect(textoCambioAlineador(base, "2026-11-03")).toEqual({
      texto: "Cambia de alineador hoy",
      vencido: true,
    });
    expect(textoCambioAlineador(base, "2026-11-05")).toEqual({
      texto: "Cambio de alineador vencido hace 2 días",
      vencido: true,
    });
    expect(textoCambioAlineador(base, "2026-10-27")?.vencido).toBe(false);
  });
});

describe("ORT-04 · progreso", () => {
  const caso = {
    status: "active" as const,
    startedOn: "2026-01-15",
    expectedEndOn: "2027-01-15",
    alignerCurrent: null,
    alignerTotal: null,
  };

  it("meses completos cuentan el día del mes", () => {
    expect(mesesCompletos("2026-01-15", "2026-03-14")).toBe(1);
    expect(mesesCompletos("2026-01-15", "2026-03-15")).toBe(2);
    expect(mesesCompletos("2026-03-15", "2026-01-15")).toBe(0);
  });

  it("con término estimado usa el tiempo transcurrido", () => {
    const p = progresoOrtodoncia(caso, "2026-07-16");
    expect(p).toEqual({ porcentaje: 50, base: "meses", mesesTranscurridos: 6, mesesEstimados: 12 });
  });

  it("con alineadores cuenta alineadores, no meses", () => {
    const p = progresoOrtodoncia({ ...caso, alignerCurrent: 6, alignerTotal: 24 }, "2026-07-16");
    expect(p.porcentaje).toBe(25);
    expect(p.base).toBe("alineadores");
  });

  it("sin término ni alineadores no inventa un porcentaje", () => {
    const p = progresoOrtodoncia({ ...caso, expectedEndOn: null }, "2026-07-16");
    expect(p.porcentaje).toBeNull();
    expect(p.mesesEstimados).toBeNull();
    expect(p.mesesTranscurridos).toBe(6);
  });

  it("no pasa de 100 % aunque el tratamiento se alargue, y finalizado es 100 %", () => {
    expect(progresoOrtodoncia(caso, "2027-06-01").porcentaje).toBe(100);
    expect(progresoOrtodoncia({ ...caso, status: "completed" }, "2026-02-01").porcentaje).toBe(100);
  });
});

describe("ORT-05 · etapa vigente", () => {
  it("es la de inicio más reciente; a igual día, la última cargada", () => {
    expect(
      etapaVigente([
        { stage: "alineacion", startedOn: "2026-01-15", createdAt: "2026-01-15T10:00:00Z" },
        { stage: "cierre_espacios", startedOn: "2026-06-01", createdAt: "2026-06-01T10:00:00Z" },
        { stage: "nivelacion", startedOn: "2026-03-01", createdAt: "2026-07-01T10:00:00Z" },
      ]),
    ).toEqual({ stage: "cierre_espacios", startedOn: "2026-06-01" });
    expect(
      etapaVigente([
        { stage: "nivelacion", startedOn: "2026-06-01", createdAt: "2026-06-01T10:00:00Z" },
        { stage: "cierre_espacios", startedOn: "2026-06-01", createdAt: "2026-06-01T11:00:00Z" },
      ])?.stage,
    ).toBe("cierre_espacios");
  });

  it("sin etapas no hay etapa vigente", () => {
    expect(etapaVigente([])).toBeNull();
  });
});
