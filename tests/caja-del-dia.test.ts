import { describe, expect, it } from "vitest";

import {
  armarResumen,
  atendidasSinCobro,
  cobrosPorHora,
  comisionesDelDia,
  etiquetaDeMedio,
  filtrarPorMedio,
  mezclaPorMedio,
  nombreCorto,
  porcentajesQueSuman100,
  type CitaDelDia,
  type PagoDelDia,
} from "@/lib/finance/caja-del-dia";

const TZ = "America/Santiago";
// 26-oct-2026 en Santiago es UTC-3: las 09:41 locales son las 12:41 UTC.
const a = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 26, h + 3, m)).toISOString();
};

function pago(p: Partial<PagoDelDia> & Pick<PagoDelDia, "id">): PagoDelDia {
  return {
    amountCents: 10000,
    method: "cash",
    methodName: null,
    paidAt: a("10:00"),
    patientId: "pac-1",
    treatmentItemId: null,
    receivableId: null,
    paymentGroupId: null,
    notes: null,
    ...p,
  };
}

function cita(c: Partial<CitaDelDia> & Pick<CitaDelDia, "id">): CitaDelDia {
  return {
    patientId: "pac-1",
    professionalId: "pro-1",
    startsAt: a("09:00"),
    status: "finalizada",
    treatmentLabel: "Control",
    ...c,
  };
}

describe("caja del día · piezas sueltas", () => {
  it("nombre corto para el mostrador", () => {
    expect(nombreCorto("Rosa Fernández Muñoz")).toBe("R. Fernández");
    expect(nombreCorto("Cher")).toBe("Cher");
    expect(nombreCorto("  ")).toBe("Paciente");
  });

  it("el medio propio de la clínica gana sobre el genérico (Ola 3)", () => {
    expect(etiquetaDeMedio("debit_card", "Redcompra")).toBe("Redcompra");
    expect(etiquetaDeMedio("debit_card", null)).toBe("Tarjeta débito");
    expect(etiquetaDeMedio("transfer", "  ")).toBe("Transferencia");
  });

  it("los porcentajes suman 100 aunque cada uno redondee distinto", () => {
    const pct = porcentajesQueSuman100([1, 1, 1]);
    expect(pct.reduce((s, v) => s + v, 0)).toBe(100);
    expect(porcentajesQueSuman100([0, 0])).toEqual([0, 0]);
    expect(porcentajesQueSuman100([186000, 412000, 338000, 348000])).toEqual([15, 32, 26, 27]);
  });

  it("cobro por hora en el huso de la clínica y el rango se estira", () => {
    const horas = cobrosPorHora(
      [
        { amountCents: 5000, paidAt: a("09:41") },
        { amountCents: 7000, paidAt: a("09:59") },
        { amountCents: 3000, paidAt: a("19:20") },
      ],
      TZ,
    );
    expect(horas[0]).toEqual({ hora: 9, cents: 12000, cantidad: 2 });
    expect(horas.at(-1)).toEqual({ hora: 19, cents: 3000, cantidad: 1 });
    expect(horas).toHaveLength(11);
    expect(horas.find((h) => h.hora === 13)).toEqual({ hora: 13, cents: 0, cantidad: 0 });
  });

  it("mezcla por medio: efectivo primero y un medio llamado 'Efectivo' que no es cash no se mezcla", () => {
    const mezcla = mezclaPorMedio([
      { amountCents: 100, method: "transfer", methodName: null },
      { amountCents: 50, method: "cash", methodName: null },
      { amountCents: 30, method: "other", methodName: "Efectivo" },
    ]);
    expect(mezcla.map((m) => [m.medio, m.enEfectivo])).toEqual([
      ["Efectivo", true],
      ["Transferencia", false],
      ["Efectivo", false],
    ]);
  });
});

describe("caja del día · resumen", () => {
  const pagos: PagoDelDia[] = [
    pago({ id: "p1", amountCents: 25000, paidAt: a("09:41"), patientId: "pac-1" }),
    // Cobro repartido en dos medios: una sola fila, dos partes.
    pago({
      id: "p2",
      amountCents: 30000,
      paidAt: a("15:20"),
      patientId: "pac-2",
      paymentGroupId: "g1",
      treatmentItemId: "it-1",
    }),
    pago({
      id: "p3",
      amountCents: 20000,
      paidAt: a("15:20"),
      patientId: "pac-2",
      paymentGroupId: "g1",
      method: "debit_card",
      methodName: "Redcompra",
    }),
  ];
  const citas = [
    cita({ id: "c1", patientId: "pac-1", professionalId: "pro-1", startsAt: a("09:15") }),
    cita({ id: "c2", patientId: "pac-3", professionalId: "pro-2", startsAt: a("16:00") }),
    cita({ id: "c3", patientId: "pac-4", status: "ausente", startsAt: a("11:00") }),
  ];
  const resumen = armarResumen({
    fecha: "2026-10-26",
    timeZone: TZ,
    pagos,
    citas,
    pacientes: new Map([
      ["pac-1", "Rosa Fernández"],
      ["pac-2", "Martina Soto"],
      ["pac-3", "Iván Torres"],
    ]),
    items: new Map([["it-1", { name: "Endodoncia", professionalId: "pro-2", toothNumber: 36 }]]),
    profesionales: [
      { id: "pro-1", nombre: "Dra. Paz Rojas", color: "#8f621e" },
      { id: "pro-2", nombre: "Dr. Tomás Vidal", color: "#0f5e63" },
      { id: "pro-3", nombre: "Dra. Camila Fuentes", color: null },
    ],
    saldos: new Map([["pac-3", 25000]]),
    comisiones: {
      fecha: "2026-10-26",
      currency: "CLP",
      versiones: [
        {
          id: "v1",
          professionalId: "pro-2",
          scope: "general" as const,
          procedureId: null,
          procedureName: null,
          kind: "percent" as const,
          percentBps: 4000,
          fixedCents: 0,
          base: "realizado" as const,
          effectiveFrom: "2000-01-01",
        },
      ],
      realizados: [
        {
          id: "i1",
          professionalId: "pro-2",
          procedureId: null,
          fecha: "2026-10-26",
          cents: 60000,
          concepto: "Endodoncia",
        },
        {
          id: "i2",
          professionalId: "pro-2",
          procedureId: null,
          fecha: "2026-10-26",
          cents: 40000,
          concepto: "Corona",
        },
      ],
      cobrados: [
        {
          id: "p2",
          professionalId: "pro-2",
          procedureId: null,
          fecha: "2026-10-26",
          cents: 30000,
          concepto: "Cobro",
        },
        {
          id: "p3",
          professionalId: "pro-2",
          procedureId: null,
          fecha: "2026-10-26",
          cents: 20000,
          concepto: "Cobro",
        },
      ],
      sinAtribuirCents: 25000,
    },
    abiertaPor: "Javiera",
    sucursal: "Providencia",
    truncado: false,
  });

  it("totales: un cobro repartido cuenta como uno", () => {
    expect(resumen.cobradoCents).toBe(75000);
    expect(resumen.cantidadCobros).toBe(2);
    expect(resumen.cantidadProfesionales).toBe(2);
    expect(resumen.enEfectivoCents).toBe(55000);
    expect(resumen.aConciliarCents).toBe(20000);
  });

  it("movimientos: profesional de la prestación o de la cita, concepto con la pieza", () => {
    const [m1, m2] = resumen.movimientos;
    expect(m1).toMatchObject({
      hora: "09:41",
      paciente: "Rosa Fernández",
      profesional: "Dra. Paz Rojas",
      concepto: "Control",
    });
    expect(m2).toMatchObject({
      id: "g1",
      profesional: "Dr. Tomás Vidal",
      concepto: "Endodoncia · 36",
      totalCents: 50000,
    });
    expect(m2.partes.map((p) => p.medio)).toEqual(["Efectivo", "Redcompra"]);
  });

  it("filtrar por medio muestra solo la parte de ese medio y el total cuadra con la mezcla", () => {
    const { filas, totalCents } = filtrarPorMedio(resumen.movimientos, "Efectivo");
    expect(filas.map((f) => f.montoVisibleCents)).toEqual([25000, 30000]);
    expect(totalCents).toBe(resumen.porMedio.find((m) => m.medio === "Efectivo")!.cents);
    expect(filtrarPorMedio(resumen.movimientos, "Redcompra").totalCents).toBe(20000);
  });

  it("atendidas sin cobro: solo finalizadas de pacientes sin cobro hoy, con su saldo", () => {
    expect(resumen.atendidasSinCobro).toEqual([
      expect.objectContaining({
        citaId: "c2",
        paciente: "Iván Torres",
        profesional: "Dr. Tomás Vidal",
        saldoCents: 25000,
      }),
    ]);
    expect(resumen.porCobrarCents).toBe(25000);
  });

  it("sin permiso de finanzas no hay saldo (null, no cero)", () => {
    const sin = atendidasSinCobro(citas, new Set(["pac-1"]), {
      timeZone: TZ,
      pacientes: new Map(),
      profesionales: new Map(),
      saldos: null,
    });
    expect(sin[0].saldoCents).toBeNull();
    expect(sin[0].paciente).toBe("Paciente");
  });

  it("comisiones del día: la regla vigente sobre lo realizado, con lo cobrado atribuido al lado", () => {
    expect(resumen.comisiones).toEqual([
      expect.objectContaining({
        professionalId: "pro-2",
        comisionCents: 40000,
        cobradoCents: 50000,
        produccionCents: 100000,
        regla: "40 % sobre lo realizado",
        base: "realizado",
        rigeDesde: null,
      }),
    ]);
    // Quien no cobró ni produjo hoy no aparece, tenga o no regla.
    expect(resumen.comisiones!.some((c) => c.professionalId === "pro-3")).toBe(false);
    // Lo cobrado sin prestación ni plan no es de nadie.
    expect(resumen.cobradoSinProfesionalCents).toBe(25000);
  });

  it("sin permiso de finanzas no hay comisiones (null, no cero)", () => {
    const sin = armarResumen({
      fecha: "2026-10-26",
      timeZone: TZ,
      pagos,
      citas,
      pacientes: new Map(),
      items: new Map(),
      profesionales: [],
      saldos: null,
      comisiones: null,
      abiertaPor: null,
      sucursal: null,
      truncado: false,
    });
    expect(sin.comisiones).toBeNull();
    expect(sin.cobradoSinProfesionalCents).toBeNull();
  });
});
