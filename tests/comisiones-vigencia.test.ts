import { describe, expect, it } from "vitest";

import {
  atribuirCobros,
  detalleParaGuardar,
  leerDetalleLiquidacion,
  liquidar,
  repartir,
  validarVigencia,
  versionDesdeReglaActual,
  versionGeneralVigente,
  type HechoCobrado,
  type HechoRealizado,
  type VersionRegla,
} from "../src/lib/finance/comisiones-vigencia";

/**
 * Ola 10 · COM-02/03/04: cálculo puro de comisiones con "rige desde",
 * base realizado/cobrado, reglas por prestación y foto de la liquidación.
 */

const PRO = "pro-1";
const OTRO = "pro-2";

function v(p: Partial<VersionRegla> & Pick<VersionRegla, "id" | "effectiveFrom">): VersionRegla {
  return {
    professionalId: PRO,
    scope: "general",
    procedureId: null,
    procedureName: null,
    kind: "percent",
    percentBps: 4000,
    fixedCents: 0,
    base: "realizado",
    ...p,
  };
}

const realizado = (id: string, fecha: string, cents: number, extra: Partial<HechoRealizado> = {}) =>
  ({
    id,
    professionalId: PRO,
    procedureId: null,
    fecha,
    cents,
    concepto: id,
    ...extra,
  }) as HechoRealizado;
const cobrado = (id: string, fecha: string, cents: number, extra: Partial<HechoCobrado> = {}) =>
  ({
    id,
    professionalId: PRO,
    procedureId: null,
    fecha,
    cents,
    concepto: id,
    ...extra,
  }) as HechoCobrado;

describe("versionGeneralVigente", () => {
  const versiones = [
    v({ id: "a", effectiveFrom: "2026-01-01" }),
    v({ id: "b", effectiveFrom: "2026-10-15", percentBps: 4500 }),
  ];
  it("toma la última que rige en la fecha", () => {
    expect(versionGeneralVigente(versiones, PRO, "2026-10-14")?.id).toBe("a");
    expect(versionGeneralVigente(versiones, PRO, "2026-10-15")?.id).toBe("b");
  });
  it("antes de la primera no hay regla", () => {
    expect(versionGeneralVigente(versiones, PRO, "2025-12-31")).toBeNull();
  });
});

describe("liquidar con rige desde", () => {
  it("cada hecho se calcula con la regla de su fecha (un cambio no reescribe lo anterior)", () => {
    const versiones = [
      v({ id: "a", effectiveFrom: "2026-01-01", percentBps: 4000 }),
      v({ id: "b", effectiveFrom: "2026-10-15", percentBps: 5000 }),
    ];
    const liq = liquidar({
      professionalId: PRO,
      desde: "2026-10-01",
      hasta: "2026-10-31",
      versiones,
      realizados: [realizado("r1", "2026-10-10", 100000), realizado("r2", "2026-10-20", 100000)],
      cobrados: [],
      currency: "CLP",
    });
    expect(liq.commissionCents).toBe(40000 + 50000);
    expect(liq.tramos.map((t) => [t.desde, t.hasta, t.comisionCents])).toEqual([
      ["2026-10-01", "2026-10-14", 40000],
      ["2026-10-15", "2026-10-31", 50000],
    ]);
    expect(liq.vigente?.id).toBe("b");
  });

  it("agregar una regla futura no cambia el cálculo de hoy", () => {
    const base = [v({ id: "a", effectiveFrom: "2026-01-01" })];
    const hechos = [realizado("r1", "2026-10-10", 100000)];
    const antes = liquidar({
      professionalId: PRO,
      desde: "2026-10-01",
      hasta: "2026-10-31",
      versiones: base,
      realizados: hechos,
      cobrados: [],
      currency: "CLP",
    });
    const despues = liquidar({
      professionalId: PRO,
      desde: "2026-10-01",
      hasta: "2026-10-31",
      versiones: [...base, v({ id: "f", effectiveFrom: "2026-11-01", percentBps: 9000 })],
      realizados: hechos,
      cobrados: [],
      currency: "CLP",
    });
    expect(despues.commissionCents).toBe(antes.commissionCents);
  });

  it("base cobrado usa los cobros y no la producción", () => {
    const liq = liquidar({
      professionalId: PRO,
      desde: "2026-10-01",
      hasta: "2026-10-31",
      versiones: [v({ id: "a", effectiveFrom: "2026-01-01", base: "cobrado", percentBps: 4500 })],
      realizados: [realizado("r1", "2026-10-05", 200000)],
      cobrados: [cobrado("c1", "2026-10-06", 80000)],
      currency: "CLP",
    });
    expect(liq.productionCents).toBe(200000);
    expect(liq.cobradoCents).toBe(80000);
    expect(liq.baseCents).toBe(80000);
    expect(liq.commissionCents).toBe(36000);
  });

  it("al cambiar de realizado a cobrado a mitad de mes cada tramo usa su base", () => {
    const liq = liquidar({
      professionalId: PRO,
      desde: "2026-10-01",
      hasta: "2026-10-31",
      versiones: [
        v({ id: "a", effectiveFrom: "2026-01-01", base: "realizado", percentBps: 4000 }),
        v({ id: "b", effectiveFrom: "2026-10-16", base: "cobrado", percentBps: 4000 }),
      ],
      realizados: [realizado("r1", "2026-10-10", 100000), realizado("r2", "2026-10-20", 100000)],
      cobrados: [cobrado("c1", "2026-10-12", 50000), cobrado("c2", "2026-10-25", 30000)],
      currency: "CLP",
    });
    // r1 (realizado, tramo a) + c2 (cobrado, tramo b); r2 y c1 no entran.
    expect(liq.lineas.map((l) => l.id)).toEqual(["r1", "c2"]);
    expect(liq.commissionCents).toBe(40000 + 12000);
  });

  it("monto fijo cuenta prestaciones realizadas", () => {
    const liq = liquidar({
      professionalId: PRO,
      desde: "2026-10-01",
      hasta: "2026-10-31",
      versiones: [v({ id: "a", effectiveFrom: "2026-01-01", kind: "fixed", fixedCents: 25000 })],
      realizados: [realizado("r1", "2026-10-05", 1), realizado("r2", "2026-10-06", 999999)],
      cobrados: [],
      currency: "CLP",
    });
    expect(liq.commissionCents).toBe(50000);
  });

  it("la regla por prestación reemplaza a la general solo para esa prestación", () => {
    const liq = liquidar({
      professionalId: PRO,
      desde: "2026-10-01",
      hasta: "2026-10-31",
      versiones: [
        v({ id: "g", effectiveFrom: "2026-01-01", percentBps: 4000 }),
        v({
          id: "p",
          effectiveFrom: "2026-01-01",
          scope: "prestacion",
          procedureId: "brackets",
          procedureName: "Brackets",
          percentBps: 2000,
        }),
      ],
      realizados: [
        realizado("r1", "2026-10-05", 100000, { procedureId: "brackets" }),
        realizado("r2", "2026-10-06", 100000, { procedureId: "limpieza" }),
      ],
      cobrados: [],
      currency: "CLP",
    });
    expect(liq.commissionCents).toBe(20000 + 40000);
  });

  it("'sin comisión' desde una fecha corta el cálculo desde ahí", () => {
    const liq = liquidar({
      professionalId: PRO,
      desde: "2026-10-01",
      hasta: "2026-10-31",
      versiones: [
        v({ id: "a", effectiveFrom: "2026-01-01" }),
        v({ id: "n", effectiveFrom: "2026-10-15", kind: "none", percentBps: 0 }),
      ],
      realizados: [realizado("r1", "2026-10-10", 100000), realizado("r2", "2026-10-20", 100000)],
      cobrados: [],
      currency: "CLP",
    });
    expect(liq.commissionCents).toBe(40000);
  });

  it("sin ninguna regla en el período la comisión es null (no cero)", () => {
    const liq = liquidar({
      professionalId: PRO,
      desde: "2026-10-01",
      hasta: "2026-10-31",
      versiones: [v({ id: "a", effectiveFrom: "2026-11-01" })],
      realizados: [realizado("r1", "2026-10-10", 100000)],
      cobrados: [],
      currency: "CLP",
    });
    expect(liq.commissionCents).toBeNull();
    expect(liq.productionCents).toBe(100000);
  });

  it("no mezcla hechos de otro profesional", () => {
    const liq = liquidar({
      professionalId: PRO,
      desde: "2026-10-01",
      hasta: "2026-10-31",
      versiones: [v({ id: "a", effectiveFrom: "2026-01-01" })],
      realizados: [realizado("r1", "2026-10-10", 100000, { professionalId: OTRO })],
      cobrados: [],
      currency: "CLP",
    });
    expect(liq.productionCents).toBe(0);
    expect(liq.commissionCents).toBe(0);
  });

  it("redondea una vez por regla y las líneas suman el total", () => {
    const liq = liquidar({
      professionalId: PRO,
      desde: "2026-10-01",
      hasta: "2026-10-31",
      versiones: [v({ id: "a", effectiveFrom: "2026-01-01", percentBps: 3333 })],
      realizados: [1, 2, 3].map((i) => realizado(`r${i}`, "2026-10-1" + i, 1001)),
      cobrados: [],
      currency: "CLP",
    });
    expect(liq.commissionCents).toBe(Math.round((3003 * 3333) / 10000));
    expect(liq.lineas.reduce((s, l) => s + l.comisionCents, 0)).toBe(liq.commissionCents);
  });

  it("la regla de commission_rules (sin vigencia) rige desde siempre", () => {
    const version = versionDesdeReglaActual({
      professionalId: PRO,
      kind: "percent",
      percentBps: 4000,
      fixedCents: 0,
    });
    expect(versionGeneralVigente([version], PRO, "2001-05-05")?.base).toBe("realizado");
  });
});

describe("repartir", () => {
  it("la suma de las partes es exacta", () => {
    expect(repartir(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(repartir(7, [0, 0])).toEqual([7, 0]);
    expect(repartir(0, [])).toEqual([]);
  });
});

describe("atribuirCobros", () => {
  const items = [
    {
      id: "i1",
      planId: "p1",
      professionalId: "A",
      procedureId: "x",
      priceCents: 300,
      status: "completed",
      nombre: "Resina",
    },
    {
      id: "i2",
      planId: "p1",
      professionalId: "B",
      procedureId: "y",
      priceCents: 100,
      status: "pending",
      nombre: "Limpieza",
    },
    {
      id: "i3",
      planId: "p1",
      professionalId: "C",
      procedureId: "z",
      priceCents: 500,
      status: "skipped",
      nombre: "Omitida",
    },
  ];
  it("pago a una prestación va a su profesional; abono al plan se reparte por precio sin las omitidas", () => {
    const { cobrados, sinAtribuirCents } = atribuirCobros(
      [
        {
          id: "a",
          amountCents: 1000,
          fecha: "2026-10-01",
          treatmentItemId: "i2",
          treatmentPlanId: "p1",
          concepto: "Pago",
        },
        {
          id: "b",
          amountCents: 400,
          fecha: "2026-10-02",
          treatmentItemId: null,
          treatmentPlanId: "p1",
          concepto: "Abono",
        },
        {
          id: "c",
          amountCents: 50,
          fecha: "2026-10-02",
          treatmentItemId: null,
          treatmentPlanId: null,
          concepto: "Suelto",
        },
      ],
      items,
    );
    expect(cobrados.filter((c) => c.id === "a")).toMatchObject([
      { professionalId: "B", cents: 1000 },
    ]);
    const abono = cobrados.filter((c) => c.id.startsWith("b:"));
    expect(abono.map((c) => [c.professionalId, c.cents])).toEqual([
      ["A", 300],
      ["B", 100],
    ]);
    expect(sinAtribuirCents).toBe(50);
  });
});

describe("foto de la liquidación y vigencia", () => {
  it("el detalle se guarda y se vuelve a leer igual", () => {
    const liq = liquidar({
      professionalId: PRO,
      desde: "2026-10-01",
      hasta: "2026-10-31",
      versiones: [v({ id: "a", effectiveFrom: "2026-01-01" })],
      realizados: [realizado("r1", "2026-10-10", 100000)],
      cobrados: [],
      currency: "CLP",
    });
    const foto = JSON.parse(JSON.stringify(detalleParaGuardar(liq, "CLP")));
    expect(leerDetalleLiquidacion(foto)?.lineas[0].comisionCents).toBe(40000);
    expect(leerDetalleLiquidacion({ version: 2 })).toBeNull();
  });

  it("una regla nueva no puede regir desde una fecha liquidada", () => {
    expect(validarVigencia("2026-10-31", "2026-10-31").ok).toBe(false);
    const r = validarVigencia("2026-10-15", "2026-10-31");
    expect(r.ok === false && r.minimo).toBe("2026-11-01");
    expect(validarVigencia("2026-11-01", "2026-10-31").ok).toBe(true);
    expect(validarVigencia("2026-01-01", null).ok).toBe(true);
  });
});
