import { describe, expect, it } from "vitest";

import {
  armarMovimientos,
  armarResumen,
  comisionesDelDia,
  type ReglasDelDia,
} from "@/lib/finance/caja-del-dia";
import type { HechoCobrado, HechoRealizado, VersionRegla } from "@/lib/finance/comisiones-vigencia";

/**
 * Cierre · ítem 9: "Comisiones del día" de la caja usa el mismo motor que el
 * reporte y el cierre del período (`liquidar`): base cobrado o realizado,
 * regla propia por prestación y "rige desde".
 */

const HOY = "2026-10-26";
const PROS = [
  { id: "pro-1", nombre: "Dra. Herrera", color: null },
  { id: "pro-2", nombre: "Dr. Reyes", color: null },
  { id: "pro-3", nombre: "Dra. Soto", color: null },
];

function version(
  v: Partial<VersionRegla> & Pick<VersionRegla, "id" | "professionalId">,
): VersionRegla {
  return {
    scope: "general",
    procedureId: null,
    procedureName: null,
    kind: "percent",
    percentBps: 4000,
    fixedCents: 0,
    base: "realizado",
    effectiveFrom: "2000-01-01",
    ...v,
  };
}

const realizado = (
  id: string,
  professionalId: string,
  cents: number,
  procedureId: string | null = null,
): HechoRealizado => ({ id, professionalId, procedureId, fecha: HOY, cents, concepto: id });

const cobrado = (id: string, professionalId: string, cents: number): HechoCobrado => ({
  id,
  professionalId,
  procedureId: null,
  fecha: HOY,
  cents,
  concepto: id,
});

function reglas(parcial: Partial<ReglasDelDia>): ReglasDelDia {
  return {
    fecha: HOY,
    currency: "CLP",
    versiones: [],
    realizados: [],
    cobrados: [],
    sinAtribuirCents: 0,
    ...parcial,
  };
}

describe("comisiones del día · reglas completas", () => {
  it("base realizado: el porcentaje va sobre lo hecho hoy", () => {
    const r = comisionesDelDia(
      PROS,
      reglas({
        versiones: [version({ id: "v1", professionalId: "pro-1" })],
        realizados: [realizado("i1", "pro-1", 100000)],
        cobrados: [cobrado("p1", "pro-1", 30000)],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      professionalId: "pro-1",
      comisionCents: 40000,
      baseCents: 100000,
      cobradoCents: 30000,
      regla: "40 % sobre lo realizado",
      base: "realizado",
    });
  });

  it("base cobrado: el porcentaje va sobre lo cobrado hoy, no sobre lo realizado", () => {
    const r = comisionesDelDia(
      PROS,
      reglas({
        versiones: [
          version({ id: "v1", professionalId: "pro-1", percentBps: 4500, base: "cobrado" }),
        ],
        realizados: [realizado("i1", "pro-1", 100000)],
        cobrados: [cobrado("p1", "pro-1", 20000)],
      }),
    );
    expect(r[0].comisionCents).toBe(9000);
    expect(r[0].baseCents).toBe(20000);
    expect(r[0].regla).toBe("45 % sobre lo cobrado");
  });

  it("monto fijo: un monto por prestación realizada, sea cual sea la base", () => {
    const r = comisionesDelDia(
      PROS,
      reglas({
        versiones: [
          version({
            id: "v1",
            professionalId: "pro-1",
            kind: "fixed",
            fixedCents: 25000,
            percentBps: 0,
          }),
        ],
        realizados: [realizado("i1", "pro-1", 80000), realizado("i2", "pro-1", 50000)],
      }),
    );
    expect(r[0].comisionCents).toBe(50000);
    expect(r[0].regla).toBe("$25.000 por prestación realizada");
  });

  it("regla por prestación: la propia de esa prestación reemplaza a la general", () => {
    const r = comisionesDelDia(
      PROS,
      reglas({
        versiones: [
          version({ id: "g", professionalId: "pro-2", percentBps: 3000 }),
          version({
            id: "b",
            professionalId: "pro-2",
            scope: "prestacion",
            procedureId: "brackets",
            procedureName: "Instalación de brackets",
            percentBps: 5000,
          }),
        ],
        realizados: [
          realizado("i1", "pro-2", 100000, "brackets"), // 50 % = 50.000
          realizado("i2", "pro-2", 100000, "limpieza"), // 30 % = 30.000
        ],
      }),
    );
    expect(r[0].comisionCents).toBe(80000);
    expect(r[0].lineasConReglaPropia).toBe(1);
  });

  it("rige desde: una regla que empieza hoy manda; una futura todavía no", () => {
    const hoy = comisionesDelDia(
      PROS,
      reglas({
        versiones: [
          version({ id: "vieja", professionalId: "pro-1", percentBps: 4000 }),
          version({ id: "nueva", professionalId: "pro-1", percentBps: 5000, effectiveFrom: HOY }),
        ],
        realizados: [realizado("i1", "pro-1", 100000)],
      }),
    );
    expect(hoy[0].comisionCents).toBe(50000);
    expect(hoy[0].rigeDesde).toBe(HOY);

    const futura = comisionesDelDia(
      PROS,
      reglas({
        versiones: [
          version({ id: "vieja", professionalId: "pro-1", percentBps: 4000 }),
          version({
            id: "nueva",
            professionalId: "pro-1",
            percentBps: 5000,
            effectiveFrom: "2026-11-01",
          }),
        ],
        realizados: [realizado("i1", "pro-1", 100000)],
      }),
    );
    expect(futura[0].comisionCents).toBe(40000);
    expect(futura[0].rigeDesde).toBeNull();
  });

  it("sin regla vigente hoy la comisión es null (no cero) y 'sin comisión' es cero", () => {
    const sinRegla = comisionesDelDia(
      PROS,
      reglas({
        versiones: [version({ id: "v1", professionalId: "pro-1", effectiveFrom: "2026-12-01" })],
        realizados: [realizado("i1", "pro-1", 100000)],
      }),
    );
    expect(sinRegla[0].comisionCents).toBeNull();
    expect(sinRegla[0].regla).toBe("Sin regla");

    const sinComision = comisionesDelDia(
      PROS,
      reglas({
        versiones: [version({ id: "v1", professionalId: "pro-1", kind: "none", percentBps: 0 })],
        realizados: [realizado("i1", "pro-1", 100000)],
      }),
    );
    expect(sinComision[0].comisionCents).toBe(0);
    expect(sinComision[0].regla).toBe("Sin comisión");
  });

  it("solo aparece quien cobró o produjo hoy y el orden es por comisión", () => {
    const r = comisionesDelDia(
      PROS,
      reglas({
        versiones: [
          version({ id: "v1", professionalId: "pro-1", percentBps: 1000 }),
          version({ id: "v2", professionalId: "pro-2", percentBps: 5000 }),
          version({ id: "v3", professionalId: "pro-3" }),
        ],
        realizados: [realizado("i1", "pro-1", 100000), realizado("i2", "pro-2", 100000)],
      }),
    );
    expect(r.map((c) => c.professionalId)).toEqual(["pro-2", "pro-1"]);
  });

  it("los hechos de otro día no entran", () => {
    const r = comisionesDelDia(
      PROS,
      reglas({
        versiones: [version({ id: "v1", professionalId: "pro-1" })],
        realizados: [{ ...realizado("i1", "pro-1", 100000), fecha: "2026-10-25" }],
      }),
    );
    expect(r).toEqual([]);
  });
});

describe("caja del día · cuota de membresía", () => {
  it("el movimiento de una cuota cobrada se llama como la cuota, no 'Abono'", () => {
    const movimientos = armarMovimientos(
      [
        {
          id: "p1",
          amountCents: 15000,
          method: "cash",
          methodName: "Efectivo",
          paidAt: "2026-10-26T15:00:00.000Z",
          patientId: "pac-1",
          treatmentItemId: null,
          receivableId: null,
          paymentGroupId: null,
          notes: "Cuota de membresía · Plan Sonrisa",
          membershipChargeId: "c1",
        },
      ],
      {
        timeZone: "America/Santiago",
        pacientes: new Map([["pac-1", "Rosa Fernández"]]),
        items: new Map(),
        citasPorPaciente: new Map(),
        profesionales: new Map(),
      },
    );
    expect(movimientos[0].concepto).toBe("Cuota de membresía · Plan Sonrisa");
    expect(movimientos[0].professionalId).toBeNull();
    expect(movimientos[0].partes[0]).toMatchObject({ enEfectivo: true, cents: 15000 });
  });

  it("pagar solo la cuota no saca al paciente de las atendidas sin cobro", () => {
    const resumen = armarResumen({
      fecha: "2026-10-26",
      timeZone: "America/Santiago",
      pagos: [
        {
          id: "p1",
          amountCents: 15000,
          method: "cash",
          methodName: null,
          paidAt: "2026-10-26T15:00:00.000Z",
          patientId: "pac-1",
          treatmentItemId: null,
          receivableId: null,
          paymentGroupId: null,
          notes: null,
          membershipChargeId: "c1",
        },
      ],
      citas: [
        {
          id: "c1",
          patientId: "pac-1",
          professionalId: "pro-1",
          startsAt: "2026-10-26T13:00:00.000Z",
          status: "finalizada",
          treatmentLabel: "Control",
        },
      ],
      pacientes: new Map([["pac-1", "Rosa Fernández"]]),
      items: new Map(),
      profesionales: [{ id: "pro-1", nombre: "Dra. Herrera", color: null }],
      saldos: null,
      comisiones: null,
      abiertaPor: null,
      sucursal: null,
      truncado: false,
    });
    // La cuota entra a la caja...
    expect(resumen.cobradoCents).toBe(15000);
    expect(resumen.enEfectivoCents).toBe(15000);
    // ...pero la atención de la que salió sigue sin cobro.
    expect(resumen.atendidasSinCobro).toHaveLength(1);
  });
});
