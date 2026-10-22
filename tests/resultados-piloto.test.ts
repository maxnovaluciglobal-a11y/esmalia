import { describe, expect, it } from "vitest";

import {
  diasDelRango,
  hayDatos,
  origenesDesdeJson,
  porcentaje,
  rangoDelPiloto,
  resultadosDesdeFila,
  type FilaResultadosPiloto,
} from "@/lib/finance/resultados-piloto";

const FILA: FilaResultadosPiloto = {
  currency: "CLP",
  appointments_scheduled: 120,
  appointments_attended: 90,
  appointments_no_show: 10,
  appointments_cancelled: 6,
  reminders_sent: 140,
  patients_new: 25,
  patients_by_source: [
    { source: "Instagram", count: 10 },
    { source: null, count: 5 },
    { source: "Recomendación", count: 10 },
  ],
  quotes_issued: 20,
  quotes_issued_cents: "4000000",
  quotes_accepted: 8,
  quotes_accepted_cents: 1_500_000,
  collected_cents: "2300000",
  payments_count: 46,
};

describe("resultados del piloto (INF-14)", () => {
  it("calcula asistencia, aceptación y montos en cents (bigint como string o número)", () => {
    const r = resultadosDesdeFila(FILA, {
      desde: "2026-09-01",
      hasta: "2026-10-22",
      currency: "CLP",
      montosVisibles: true,
    });
    expect(r.citas).toEqual({
      agendadas: 120,
      atendidas: 90,
      inasistencias: 10,
      anuladas: 6,
      pctAsistencia: 90,
    });
    expect(r.dinero).toEqual({
      presupuestosEmitidos: 20,
      presupuestosEmitidosCents: 4_000_000,
      presupuestosAceptados: 8,
      presupuestosAceptadosCents: 1_500_000,
      pctAceptacion: 40,
      cobradoCents: 2_300_000,
      pagos: 46,
    });
  });

  it("sin permiso de montos, dinero es null pero lo demás se muestra", () => {
    const r = resultadosDesdeFila(FILA, {
      desde: "2026-09-01",
      hasta: "2026-10-22",
      currency: "CLP",
      montosVisibles: false,
    });
    expect(r.dinero).toBeNull();
    expect(r.pacientesNuevos).toBe(25);
    expect(hayDatos(r)).toBe(true);
  });

  it("sin citas cerradas ni presupuestos, los % son null (regla 11) y no hay datos", () => {
    const r = resultadosDesdeFila(
      {
        ...FILA,
        appointments_scheduled: 0,
        appointments_attended: 0,
        appointments_no_show: 0,
        appointments_cancelled: 0,
        reminders_sent: 0,
        patients_new: 0,
        patients_by_source: [],
        quotes_issued: 0,
        quotes_issued_cents: 0,
        quotes_accepted: 0,
        quotes_accepted_cents: 0,
        collected_cents: 0,
        payments_count: 0,
      },
      { desde: "2026-10-01", hasta: "2026-10-22", currency: "CLP", montosVisibles: true },
    );
    expect(r.citas.pctAsistencia).toBeNull();
    expect(r.dinero?.pctAceptacion).toBeNull();
    expect(hayDatos(r)).toBe(false);
    expect(
      resultadosDesdeFila(null, { desde: "x", hasta: "y", currency: "MXN", montosVisibles: true })
        .currency,
    ).toBe("MXN");
  });

  it("ordena los orígenes de mayor a menor con 'Sin dato' al final", () => {
    expect(origenesDesdeJson(FILA.patients_by_source)).toEqual([
      { origen: "Instagram", pacientes: 10, porcentaje: 40 },
      { origen: "Recomendación", pacientes: 10, porcentaje: 40 },
      { origen: "Sin dato", pacientes: 5, porcentaje: 20 },
    ]);
    expect(origenesDesdeJson(null)).toEqual([]);
    expect(
      origenesDesdeJson([
        { source: "  ", count: 2 },
        { source: null, count: 1 },
      ]),
    ).toEqual([{ origen: "Sin dato", pacientes: 3, porcentaje: 100 }]);
  });

  it("porcentaje entero y null sin base", () => {
    expect(porcentaje(1, 3)).toBe(33);
    expect(porcentaje(2, 0)).toBeNull();
  });

  it("rango por defecto desde la creación de la clínica hasta hoy", () => {
    expect(rangoDelPiloto({ creadaEl: "2026-09-01", hoy: "2026-10-22" })).toEqual({
      desde: "2026-09-01",
      hasta: "2026-10-22",
    });
    // Rango al revés: se da vuelta.
    expect(
      rangoDelPiloto({
        creadaEl: "2026-09-01",
        hoy: "2026-10-22",
        desde: "2026-10-10",
        hasta: "2026-10-01",
      }),
    ).toEqual({ desde: "2026-10-01", hasta: "2026-10-10" });
    // Nada antes de la creación; basura cae al default.
    expect(
      rangoDelPiloto({
        creadaEl: "2026-09-01",
        hoy: "2026-10-22",
        desde: "2025-01-01",
        hasta: "x",
      }),
    ).toEqual({ desde: "2026-09-01", hasta: "2026-10-22" });
  });

  it("cuenta los días con las dos puntas", () => {
    expect(diasDelRango("2026-10-01", "2026-10-01")).toBe(1);
    expect(diasDelRango("2026-09-01", "2026-10-22")).toBe(52);
  });
});
