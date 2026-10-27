import { describe, expect, it } from "vitest";

import {
  ROLES_AFILIACION,
  describirDescuento,
  descuentoSobre,
  resumirEstadoDeCuenta,
  validarEmpresa,
} from "../src/lib/finance/empresas-convenio";
import {
  correspondeAlMes,
  costoMensualDeReferencia,
  diasDelMes,
  fechaDelGasto,
  gastosFijosDelMes,
  mesDe,
  resumenGastosFijos,
  sumarMeses,
  validarGastoFijo,
  type GastoFijo,
} from "../src/lib/finance/gastos-fijos";
import {
  beneficiosDesdeTexto,
  cuotaMensualEquivalente,
  etiquetaCuota,
  resumirCuotas,
  validarPlan,
} from "../src/lib/finance/membresias";
import {
  leerVentaReal,
  montoConSigno,
  normalizarFolio,
  ordenarMovimientos,
  ordenarSucursales,
  totalizarSucursales,
  totalizarVentaReal,
  validarFolio,
  type FilaSucursal,
  type FilaVentaReal,
  type Movimiento,
} from "../src/lib/finance/vista-general";
import { LISTAS_CSV, permisoDinero } from "../src/lib/exportacion/listas-csv";

/** Ola 10 · frente A: cálculos puros de finanzas (FIN-01, 09, 11, 12, 13, 15, 18). */

function gasto(p: Partial<GastoFijo> = {}): GastoFijo {
  return {
    id: "g1",
    category: "Arriendo",
    description: "Arriendo de la consulta",
    supplier: null,
    amountCents: 800_000,
    currency: "CLP",
    paymentMethodId: null,
    branchId: null,
    dayOfMonth: 5,
    startsOn: "2026-01-01",
    endsOn: null,
    active: true,
    notes: null,
    ...p,
  };
}

describe("gastos fijos (FIN-09)", () => {
  it("calcula meses sin depender del reloj", () => {
    expect(mesDe("2026-10-27")).toBe("2026-10-01");
    expect(sumarMeses("2026-11-01", 2)).toBe("2027-01-01");
    expect(sumarMeses("2026-01-01", -1)).toBe("2025-12-01");
    expect(diasDelMes("2028-02-01")).toBe(29);
    expect(diasDelMes("2026-02-01")).toBe(28);
  });

  it("corre solo activo y dentro de su rango", () => {
    const g = gasto({ startsOn: "2026-03-01", endsOn: "2026-06-01" });
    expect(correspondeAlMes(g, "2026-02-01")).toBe(false);
    expect(correspondeAlMes(g, "2026-03-15")).toBe(true);
    expect(correspondeAlMes(g, "2026-06-01")).toBe(true);
    expect(correspondeAlMes(g, "2026-07-01")).toBe(false);
    expect(correspondeAlMes({ ...g, active: false }, "2026-04-01")).toBe(false);
  });

  it("la fecha del gasto no se pasa del último día del mes", () => {
    expect(fechaDelGasto(gasto({ dayOfMonth: 5 }), "2026-10-01")).toBe("2026-10-05");
    expect(fechaDelGasto(gasto({ dayOfMonth: 28 }), "2026-02-01")).toBe("2026-02-28");
  });

  it("separa pendientes y confirmados, y el confirmado conserva su monto real", () => {
    const luz = gasto({ id: "luz", description: "Luz", dayOfMonth: 20, amountCents: 60_000 });
    const viejo = gasto({ id: "viejo", description: "Software", active: false });
    const lista = gastosFijosDelMes(
      [gasto(), luz, viejo],
      [
        { id: "e1", recurringExpenseId: "luz", amountCents: 72_500, incurredOn: "2026-10-20" },
        { id: "e2", recurringExpenseId: "viejo", amountCents: 30_000, incurredOn: "2026-10-05" },
      ],
      "2026-10-01",
    );
    expect(lista.map((g) => [g.gasto.id, g.estado])).toEqual([
      ["g1", "pendiente"],
      ["viejo", "confirmado"],
      ["luz", "confirmado"],
    ]);
    const r = resumenGastosFijos(lista);
    expect(r).toEqual({
      pendientes: 1,
      pendientesCents: 800_000,
      confirmados: 2,
      confirmadosCents: 102_500,
      totalCents: 902_500,
    });
    expect(costoMensualDeReferencia([gasto(), luz, viejo], "2026-10-01")).toBe(860_000);
  });

  it("valida en palabras de la clínica", () => {
    expect(
      validarGastoFijo({
        category: "Arriendo",
        description: "Local",
        amountCents: 1,
        dayOfMonth: 5,
        startsOn: "2026-10-01",
        endsOn: null,
      }),
    ).toEqual([]);
    const errores = validarGastoFijo({
      category: " ",
      description: "",
      amountCents: 0,
      dayOfMonth: 31,
      startsOn: "2026-10-01",
      endsOn: "2026-09-01",
    });
    expect(errores).toHaveLength(5);
  });
});

describe("empresas con convenio (FIN-11)", () => {
  const pct = {
    discountKind: "percent" as const,
    discountPercent: 15,
    discountCents: null,
    currency: "CLP",
  };
  const monto = {
    discountKind: "amount" as const,
    discountPercent: null,
    discountCents: 5_000,
    currency: "CLP",
  };
  const ninguno = {
    discountKind: "none" as const,
    discountPercent: null,
    discountCents: null,
    currency: "CLP",
  };

  it("describe y calcula el descuento sin pasarse del monto", () => {
    expect(describirDescuento(pct)).toBe("15 % de descuento");
    expect(describirDescuento({ ...pct, discountPercent: 12.5 })).toBe("12,5 % de descuento");
    expect(describirDescuento(monto)).toMatch(/5\.000 de descuento por atención/);
    expect(describirDescuento(ninguno)).toBe("Sin descuento");
    expect(descuentoSobre(100_000, pct)).toBe(15_000);
    expect(descuentoSobre(3_000, monto)).toBe(3_000);
    expect(descuentoSobre(100_000, ninguno)).toBe(0);
    expect(descuentoSobre(0, pct)).toBe(0);
  });

  it("el estado de cuenta suma solo saldos a cobrar y con planilla dice cuánto descontar", () => {
    const filas = [
      {
        patientId: "a",
        fullName: "A",
        employeeCode: null,
        realizadoCents: 50_000,
        pagadoCents: 20_000,
        saldoCents: 30_000,
      },
      {
        patientId: "b",
        fullName: "B",
        employeeCode: "77",
        realizadoCents: 0,
        pagadoCents: 0,
        saldoCents: -5_000,
      },
      {
        patientId: "c",
        fullName: "C",
        employeeCode: null,
        realizadoCents: 0,
        pagadoCents: 10_000,
        saldoCents: 0,
      },
    ];
    expect(resumirEstadoDeCuenta(filas, true)).toEqual({
      afiliados: 3,
      conMovimiento: 2,
      realizadoCents: 50_000,
      pagadoCents: 30_000,
      saldoCents: 30_000,
      aDescontarCents: 30_000,
    });
    expect(resumirEstadoDeCuenta(filas, false).aDescontarCents).toBeNull();
  });

  it("valida nombre, descuento y correo", () => {
    expect(validarEmpresa({ name: "Constructora", ...pct, contactEmail: null })).toEqual([]);
    expect(
      validarEmpresa({
        name: "",
        discountKind: "percent",
        discountPercent: 0,
        discountCents: null,
        contactEmail: "x",
      }),
    ).toHaveLength(3);
  });

  it("assistant no ve ni edita la empresa ni la membresía (regla 2)", () => {
    expect(ROLES_AFILIACION).not.toContain("assistant");
    expect(ROLES_AFILIACION).not.toContain("lab_technician");
    expect(ROLES_AFILIACION).toContain("reception");
  });
});

describe("membresías (FIN-12)", () => {
  it("etiqueta la cuota y la compara al mes", () => {
    expect(etiquetaCuota(15_000, "monthly", "CLP")).toMatch(/15\.000 al mes$/);
    expect(etiquetaCuota(150_000, "yearly", "CLP")).toMatch(/al año$/);
    expect(cuotaMensualEquivalente(120_000, "yearly")).toBe(10_000);
  });

  it("resume cuotas por estado", () => {
    expect(
      resumirCuotas([
        { status: "pending", amountCents: 15_000 },
        { status: "pending", amountCents: 15_000 },
        { status: "paid", amountCents: 15_000 },
        { status: "void", amountCents: 15_000 },
      ]),
    ).toEqual({
      porCobrar: 2,
      porCobrarCents: 30_000,
      cobradas: 1,
      cobradasCents: 15_000,
      anuladas: 1,
    });
  });

  it("lee los beneficios uno por línea, sin vacíos ni repetidos", () => {
    expect(beneficiosDesdeTexto("• 2 limpiezas\n\n- Urgencias\n2 LIMPIEZAS\n")).toEqual([
      "2 limpiezas",
      "Urgencias",
    ]);
  });

  it("valida el plan", () => {
    expect(
      validarPlan({
        name: "Plan",
        feeCents: 1,
        billingPeriod: "monthly",
        treatmentDiscountPercent: 10,
      }),
    ).toEqual([]);
    expect(
      validarPlan({
        name: "",
        feeCents: 0,
        billingPeriod: "semanal",
        treatmentDiscountPercent: 120,
      }),
    ).toHaveLength(4);
  });
});

describe("vista general y venta real (FIN-01, FIN-18)", () => {
  const suc = (p: Partial<FilaSucursal>): FilaSucursal => ({
    branchId: "b1",
    branchName: "Centro",
    cobradoCents: 0,
    pagos: 0,
    cuotasCobradasCents: 0,
    cuotasCobradas: 0,
    gastosCents: 0,
    gastos: 0,
    realizadoCents: 0,
    ...p,
  });

  it("los ingresos suman pagos y cuotas; el resultado resta los gastos", () => {
    const t = totalizarSucursales([
      suc({ cobradoCents: 500_000, pagos: 5, cuotasCobradasCents: 30_000, cuotasCobradas: 2 }),
      suc({ branchId: null, branchName: "Sin sucursal", gastosCents: 800_000, gastos: 1 }),
    ]);
    expect(t.ingresosCents).toBe(530_000);
    expect(t.resultadoCents).toBe(-270_000);
    expect(t.pagos).toBe(5);
  });

  it("'Sin sucursal' va siempre al final", () => {
    const orden = ordenarSucursales([
      suc({ branchId: null, branchName: "Sin sucursal", cobradoCents: 9_999_999 }),
      suc({ branchId: "b2", branchName: "Norte", cobradoCents: 10 }),
      suc({ branchId: "b1", branchName: "Centro", cobradoCents: 100 }),
    ]);
    expect(orden.map((s) => s.branchName)).toEqual(["Centro", "Norte", "Sin sucursal"]);
  });

  const venta = (p: Partial<FilaVentaReal>): FilaVentaReal => ({
    professionalId: "p1",
    professionalName: "Dra. Soto",
    color: null,
    presupuestadoCents: 0,
    presupuestos: 0,
    realizadoCents: 0,
    realizadoPacienteCents: 0,
    realizadoItems: 0,
    cobradoCents: 0,
    ...p,
  });

  it("calcula las tasas y no fabrica un porcentaje sin base (regla 11)", () => {
    const t = totalizarVentaReal([
      venta({
        presupuestadoCents: 1_000_000,
        realizadoCents: 600_000,
        realizadoPacienteCents: 500_000,
        cobradoCents: 450_000,
      }),
    ]);
    expect(t.realizadoSobrePresupuestado).toBe(60);
    expect(t.cobradoSobreRealizado).toBe(90);
    expect(leerVentaReal(t)).toBe("falta_por_hacer");
    const sinBase = totalizarVentaReal([]);
    expect(sinBase.realizadoSobrePresupuestado).toBeNull();
    expect(sinBase.cobradoSobreRealizado).toBeNull();
    expect(leerVentaReal(sinBase)).toBe("sin_datos");
  });

  it("avisa primero si falta por cobrar", () => {
    const t = totalizarVentaReal([
      venta({
        presupuestadoCents: 100,
        realizadoCents: 100,
        realizadoPacienteCents: 100,
        cobradoCents: 50,
      }),
    ]);
    expect(leerVentaReal(t)).toBe("falta_por_cobrar");
  });
});

describe("folios y planilla (FIN-13, FIN-15)", () => {
  it("normaliza y valida el folio", () => {
    expect(normalizarFolio("  000123 ")).toBe("123");
    expect(normalizarFolio("F-001")).toBe("F-001");
    expect(validarFolio({ docType: "boleta", folio: "123", issuedOn: "2026-10-27" })).toEqual([]);
    expect(validarFolio({ docType: "ticket", folio: " ", issuedOn: "" })).toHaveLength(3);
  });

  it("la planilla se lee como un libro: por fecha, ingresos antes que gastos", () => {
    const m = (p: Partial<Movimiento>): Movimiento => ({
      id: "x",
      tipo: "ingreso",
      fecha: "2026-10-01",
      detalle: "",
      paciente: null,
      medio: null,
      sucursal: null,
      montoCents: 100,
      currency: "CLP",
      documento: null,
      folio: null,
      ...p,
    });
    const orden = ordenarMovimientos([
      m({ id: "g", tipo: "gasto", fecha: "2026-10-01" }),
      m({ id: "i2", fecha: "2026-10-02" }),
      m({ id: "c", tipo: "cuota", fecha: "2026-10-01" }),
      m({ id: "i1", fecha: "2026-10-01" }),
    ]);
    expect(orden.map((x) => x.id)).toEqual(["i1", "c", "g", "i2"]);
    expect(montoConSigno(m({ tipo: "gasto", montoCents: 500 }))).toBe(-500);
  });

  it("las listas nuevas exigen finanzas, y las cuotas el permiso de caja", () => {
    expect(LISTAS_CSV.finanzas.permiso).toBe("finance:view");
    expect(LISTAS_CSV.gastos_fijos.permiso).toBe("finance:view");
    expect(LISTAS_CSV.empresas_convenio.permiso).toBe("finance:view");
    expect(LISTAS_CSV.membresias.permiso).toBe("cash:manage");
    expect(permisoDinero("membresias")).toBe("cash:manage");
    expect(permisoDinero("finanzas")).toBe("finance:view");
  });
});
