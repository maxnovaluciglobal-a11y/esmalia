import { describe, expect, it } from "vitest";

import {
  agruparPorCobro,
  armarCuentas,
  contarPorFiltro,
  cuotasIguales,
  diasEntre,
  filtrarCuentas,
  imputarACuotas,
  restantePorAsignar,
  resumirCuenta,
  sumarMeses,
  totalesCartera,
  tramoDeAtraso,
  validarCuotas,
  validarReparto,
  type Cuota,
  type FilaCuenta,
} from "@/lib/finance/cuentas-por-cobrar";
import { metodoDelMedio } from "@/lib/finance/medios-de-pago";

/**
 * Ola 3 · Frente Cobros: lógica pura de cuentas por cobrar (FIN-02),
 * cuotas (FIN-03), cobro con varios medios (FIN-04) y tipos de medio
 * (FIN-07). Sin base ni red.
 */

const HOY = "2026-10-24";

function cuota(number: number, dueOn: string, amountCents: number): Cuota {
  return { id: `c${number}`, number, dueOn, amountCents };
}

describe("fechas de calendario", () => {
  it("cuenta días entre dos fechas, con signo", () => {
    expect(diasEntre("2026-10-01", "2026-10-24")).toBe(23);
    expect(diasEntre("2026-10-24", "2026-10-01")).toBe(-23);
    expect(diasEntre("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("suma meses sin saltar al mes siguiente cuando el día no existe", () => {
    expect(sumarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(sumarMeses("2028-01-31", 1)).toBe("2028-02-29");
    expect(sumarMeses("2026-11-15", 2)).toBe("2027-01-15");
    expect(sumarMeses("2026-10-24", 0)).toBe("2026-10-24");
  });
});

describe("cuotas (FIN-03)", () => {
  it("divide en cuotas iguales con la suma exacta en cents", () => {
    const cuotas = cuotasIguales(100_000, 3, "2026-11-05");
    expect(cuotas.map((c) => c.amountCents)).toEqual([33_334, 33_333, 33_333]);
    expect(cuotas.reduce((s, c) => s + c.amountCents, 0)).toBe(100_000);
    expect(cuotas.map((c) => c.dueOn)).toEqual(["2026-11-05", "2026-12-05", "2027-01-05"]);
  });

  it("no inventa cuotas de cero ni acepta montos o cantidades inválidas", () => {
    expect(cuotasIguales(2, 5, "2026-11-05").map((c) => c.amountCents)).toEqual([1, 1]);
    expect(cuotasIguales(0, 3, "2026-11-05")).toEqual([]);
    expect(cuotasIguales(1000, 0, "2026-11-05")).toEqual([]);
  });

  it("cada pago cubre primero la cuota más antigua", () => {
    const cuotas = [
      cuota(2, "2026-11-05", 30_000),
      cuota(1, "2026-10-05", 30_000),
      cuota(3, "2026-12-05", 40_000),
    ];
    const r = imputarACuotas(cuotas, 45_000, HOY);
    expect(r.map((c) => [c.number, c.pagadoCents, c.estado])).toEqual([
      [1, 30_000, "pagada"],
      [2, 15_000, "parcial"],
      [3, 0, "pendiente"],
    ]);
  });

  it("marca vencida solo la cuota pasada con plata pendiente", () => {
    const cuotas = [cuota(1, "2026-10-05", 30_000), cuota(2, "2026-11-05", 30_000)];
    const sinPagos = imputarACuotas(cuotas, 0, HOY);
    expect(sinPagos.map((c) => c.vencida)).toEqual([true, false]);
    const alDia = imputarACuotas(cuotas, 30_000, HOY);
    expect(alDia.map((c) => c.vencida)).toEqual([false, false]);
  });

  it("la cuota que vence hoy todavía no está vencida", () => {
    const [c] = imputarACuotas([cuota(1, HOY, 10_000)], 0, HOY);
    expect(c.vencida).toBe(false);
  });

  it("valida que las cuotas sumen exacto el total", () => {
    const ok = [
      { dueOn: "2026-11-05", amountCents: 50_000 },
      { dueOn: "2026-12-05", amountCents: 50_000 },
    ];
    expect(validarCuotas(ok, 100_000)).toBeNull();
    expect(validarCuotas([], 100_000)).toBeNull();
    expect(validarCuotas(ok, 100_001)).toMatch(/menos/);
    expect(validarCuotas(ok, 99_999)).toMatch(/más/);
    expect(validarCuotas([{ dueOn: "2026-02-30", amountCents: 100_000 }], 100_000)).toMatch(
      /fecha/,
    );
    expect(validarCuotas([{ dueOn: "2026-11-05", amountCents: 0 }], 0)).toMatch(/mayor/);
  });
});

describe("estado de la cuenta (FIN-02)", () => {
  const base = { amountCents: 100_000, issuedOn: "2026-09-01", dueOn: null, voidedAt: null };

  it("pendiente, parcial y pagada según lo pagado", () => {
    expect(resumirCuenta({ ...base, cuotas: [] }, 0, HOY).estado).toBe("pendiente");
    expect(resumirCuenta({ ...base, cuotas: [] }, 40_000, HOY).estado).toBe("parcial");
    expect(resumirCuenta({ ...base, cuotas: [] }, 100_000, HOY).estado).toBe("pagada");
  });

  it("sin cuotas ni vencimiento nunca vence: no se inventa un plazo", () => {
    const r = resumirCuenta({ ...base, cuotas: [] }, 0, HOY);
    expect(r.estado).toBe("pendiente");
    expect(r.diasDeAtraso).toBeNull();
    expect(r.tramo).toBe("al_dia");
    expect(r.proximoVencimiento).toBeNull();
    expect(r.antiguedadDias).toBe(53);
  });

  it("vencida gana sobre parcial y cuenta los días desde la cuota impaga más antigua", () => {
    const r = resumirCuenta(
      {
        ...base,
        cuotas: [
          cuota(1, "2026-08-01", 30_000),
          cuota(2, "2026-09-01", 30_000),
          cuota(3, "2026-11-01", 40_000),
        ],
      },
      40_000,
      HOY,
    );
    expect(r.estado).toBe("vencida");
    // La 1 está pagada; la 2 venció el 1-sep con 20.000 pendientes.
    expect(r.vencidoCents).toBe(20_000);
    expect(r.diasDeAtraso).toBe(53);
    expect(r.tramo).toBe("31-60");
    expect(r.proximoVencimiento).toBe("2026-09-01");
    expect(r.saldoCents).toBe(60_000);
  });

  it("una cuenta sin cuotas con vencimiento pasado y saldo está vencida", () => {
    const r = resumirCuenta({ ...base, dueOn: "2026-06-01", cuotas: [] }, 10_000, HOY);
    expect(r.estado).toBe("vencida");
    expect(r.vencidoCents).toBe(90_000);
    expect(r.tramo).toBe("90+");
  });

  it("lo pagado de más queda a favor y no como saldo negativo", () => {
    const r = resumirCuenta({ ...base, cuotas: [] }, 120_000, HOY);
    expect(r.estado).toBe("pagada");
    expect(r.saldoCents).toBe(0);
    expect(r.aFavorCents).toBe(20_000);
  });

  it("anulada no es deuda aunque tenga saldo", () => {
    const r = resumirCuenta(
      { ...base, dueOn: "2026-06-01", voidedAt: "2026-10-01T10:00:00Z", cuotas: [] },
      0,
      HOY,
    );
    expect(r.estado).toBe("anulada");
    expect(r.saldoCents).toBe(0);
    expect(r.vencidoCents).toBe(0);
    expect(r.diasDeAtraso).toBeNull();
  });

  it("tramos de atraso", () => {
    expect(tramoDeAtraso(null)).toBe("al_dia");
    expect(tramoDeAtraso(1)).toBe("1-30");
    expect(tramoDeAtraso(30)).toBe("1-30");
    expect(tramoDeAtraso(31)).toBe("31-60");
    expect(tramoDeAtraso(90)).toBe("61-90");
    expect(tramoDeAtraso(91)).toBe("90+");
  });
});

describe("cartera", () => {
  function fila(id: string, extra: Partial<FilaCuenta> = {}): FilaCuenta {
    return {
      id,
      patient_id: `p-${id}`,
      quote_id: null,
      treatment_plan_id: null,
      description: `Presupuesto ${id}`,
      amount_cents: 100_000,
      currency: "CLP",
      issued_on: "2026-09-01",
      due_on: null,
      voided_at: null,
      void_reason: null,
      created_at: "2026-09-01T12:00:00Z",
      ...extra,
    };
  }

  const cuentas = armarCuentas(
    [
      fila("a"),
      fila("b", { due_on: "2026-07-01" }),
      fila("c"),
      fila("d", { voided_at: "2026-10-01T00:00:00Z", void_reason: "error" }),
    ],
    [],
    // c pagada entera; a sin fila de pagado (= sin pagos, 0 real).
    [
      { receivable_id: "c", paid_cents: 100_000, last_paid_at: "2026-10-10T00:00:00Z" },
      { receivable_id: "b", paid_cents: 25_000, last_paid_at: "2026-08-10T00:00:00Z" },
    ],
    new Map([
      ["p-a", "Ana Pérez"],
      ["p-b", "Bruno Díaz"],
    ]),
    HOY,
  );

  it("une cuentas, pagos y nombres; sin fila de pagado = sin pagos", () => {
    const porId = new Map(cuentas.map((c) => [c.id, c]));
    expect(porId.get("a")?.resumen.estado).toBe("pendiente");
    expect(porId.get("a")?.ultimoPagoAt).toBeNull();
    expect(porId.get("b")?.resumen.estado).toBe("vencida");
    expect(porId.get("c")?.resumen.estado).toBe("pagada");
    expect(porId.get("d")?.resumen.estado).toBe("anulada");
    expect(porId.get("c")?.patientName).toBeNull();
    expect(porId.get("a")?.patientName).toBe("Ana Pérez");
  });

  it("filtra por estado, antigüedad y texto, con lo más atrasado primero", () => {
    expect(
      filtrarCuentas(cuentas, { estado: "por_cobrar", tramo: "todos", termino: "" }).map(
        (c) => c.id,
      ),
    ).toEqual(["b", "a"]);
    expect(
      filtrarCuentas(cuentas, { estado: "todas", tramo: "90+", termino: "" }).map((c) => c.id),
    ).toEqual(["b"]);
    expect(
      filtrarCuentas(cuentas, { estado: "todas", tramo: "todos", termino: "ana" }).map((c) => c.id),
    ).toEqual(["a"]);
  });

  it("cuenta por filtro y suma la cartera sin las anuladas ni las pagadas", () => {
    const n = contarPorFiltro(cuentas);
    expect(n.por_cobrar).toBe(2);
    expect(n.todas).toBe(4);
    expect(n.anulada).toBe(1);
    const t = totalesCartera(cuentas);
    expect(t.porCobrarCents).toBe(175_000);
    expect(t.vencidoCents).toBe(75_000);
    expect(t.cuentasVencidas).toBe(1);
    expect(t.porTramo["90+"]).toBe(75_000);
    expect(t.porTramo.al_dia).toBe(100_000);
  });
});

describe("cobro con varios medios (FIN-04)", () => {
  it("acepta un reparto que suma exacto el total", () => {
    const partes = [
      { paymentMethodId: "efectivo", amountCents: 30_000 },
      { paymentMethodId: "debito", amountCents: 70_000 },
    ];
    expect(validarReparto(100_000, partes)).toBeNull();
    expect(restantePorAsignar(100_000, partes)).toBe(0);
  });

  it("rechaza faltantes, sobrantes, montos en cero, medios repetidos y un solo medio", () => {
    expect(
      validarReparto(100_000, [
        { paymentMethodId: "a", amountCents: 30_000 },
        { paymentMethodId: "b", amountCents: 60_000 },
      ]),
    ).toMatch(/Falta/);
    expect(
      validarReparto(100_000, [
        { paymentMethodId: "a", amountCents: 50_000 },
        { paymentMethodId: "b", amountCents: 60_000 },
      ]),
    ).toMatch(/más/);
    expect(
      validarReparto(100_000, [
        { paymentMethodId: "a", amountCents: 100_000 },
        { paymentMethodId: "b", amountCents: 0 },
      ]),
    ).toMatch(/mayor/);
    expect(
      validarReparto(100_000, [
        { paymentMethodId: "a", amountCents: 50_000 },
        { paymentMethodId: "a", amountCents: 50_000 },
      ]),
    ).toMatch(/una sola vez/);
    expect(validarReparto(100_000, [{ paymentMethodId: "a", amountCents: 100_000 }])).toMatch(
      /dos medios/,
    );
  });

  it("agrupa también el bono con su copago (MKT-03)", () => {
    const pagos = [
      { id: "1", paymentGroupId: null, coverageGroupId: "b" },
      { id: "2", paymentGroupId: null, coverageGroupId: null },
      { id: "3", paymentGroupId: null, coverageGroupId: "b" },
    ];
    expect(agruparPorCobro(pagos).map((g) => g.map((p) => p.id))).toEqual([["1", "3"], ["2"]]);
  });

  it("agrupa las filas de un mismo cobro y respeta el orden", () => {
    const pagos = [
      { id: "1", paymentGroupId: "g" },
      { id: "2", paymentGroupId: null },
      { id: "3", paymentGroupId: "g" },
      { id: "4", paymentGroupId: "h" },
    ];
    expect(agruparPorCobro(pagos).map((g) => g.map((p) => p.id))).toEqual([
      ["1", "3"],
      ["2"],
      ["4"],
    ]);
  });
});

describe("tipos de medio (FIN-07)", () => {
  it("los cinco medios originales se guardan con su valor de siempre", () => {
    expect(metodoDelMedio("cash", "cash")).toBe("cash");
    expect(metodoDelMedio("debit", "debit_card")).toBe("debit_card");
    expect(metodoDelMedio(null, "transfer")).toBe("transfer");
  });

  it("Redcompra cuenta como débito; cheque, convenio y bono como otro", () => {
    expect(metodoDelMedio("redcompra", null)).toBe("debit_card");
    expect(metodoDelMedio("check", null)).toBe("other");
    expect(metodoDelMedio("agreement", null)).toBe("other");
    expect(metodoDelMedio("voucher", null)).toBe("other");
  });

  it("un medio propio de tipo efectivo entra a la caja; sin tipo es otro", () => {
    expect(metodoDelMedio("cash", null)).toBe("cash");
    expect(metodoDelMedio(null, null)).toBe("other");
    expect(metodoDelMedio("inventado", null)).toBe("other");
  });
});
