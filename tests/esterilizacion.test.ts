import { describe, expect, it } from "vitest";

import {
  diasParaVencer,
  esPruebaDeEquipo,
  estadoVisible,
  fechaDeVencimiento,
  motivoParaNoUsar,
  normalizarCodigo,
  parametrosDeCiclo,
  puedeRegistrarEsterilizacion,
  rastreoDeCiclo,
  resultadoSegunIndicadores,
  resumenEsterilizacion,
  type PaqueteResumen,
} from "@/lib/esterilizacion/esterilizacion";

/** MKT-10 (Ola 14): vencimiento del estéril, indicadores y rastreo (puro). */

const ZONA = "America/Santiago";

function paquete(extra: Partial<PaqueteResumen> = {}): PaqueteResumen {
  return {
    id: "p1",
    cycleId: "c1",
    code: "E2026-00001",
    status: "disponible",
    expiresOn: "2026-12-10",
    usedPatientId: null,
    usedPatientName: null,
    usedAt: null,
    usedAppointmentId: null,
    usedAppointmentAt: null,
    ...extra,
  };
}

describe("vencimiento del estéril", () => {
  it("día del ciclo en la hora de la clínica + vida útil (igual que la base)", () => {
    expect(fechaDeVencimiento("2026-11-10T15:00:00Z", 30, ZONA)).toBe("2026-12-10");
    // 01:30 UTC del 11 es todavía el 10 en Santiago (UTC-3).
    expect(fechaDeVencimiento("2026-11-11T01:30:00Z", 7, ZONA)).toBe("2026-11-17");
    // Cruza el fin de año.
    expect(fechaDeVencimiento("2026-12-20T15:00:00Z", 30, ZONA)).toBe("2027-01-19");
  });

  it("días para vencer: 0 hoy, negativo vencido", () => {
    expect(diasParaVencer("2026-11-10", "2026-11-10")).toBe(0);
    expect(diasParaVencer("2026-11-17", "2026-11-10")).toBe(7);
    expect(diasParaVencer("2026-11-09", "2026-11-10")).toBe(-1);
  });

  it("un disponible se muestra por vencer (7 días o menos) o vencido; los demás, su estado", () => {
    const hoy = "2026-11-10";
    expect(estadoVisible({ status: "disponible", expiresOn: "2026-12-10" }, hoy)).toBe(
      "disponible",
    );
    expect(estadoVisible({ status: "disponible", expiresOn: "2026-11-17" }, hoy)).toBe(
      "por_vencer",
    );
    expect(estadoVisible({ status: "disponible", expiresOn: "2026-11-10" }, hoy)).toBe(
      "por_vencer",
    );
    expect(estadoVisible({ status: "disponible", expiresOn: "2026-11-09" }, hoy)).toBe("vencido");
    expect(estadoVisible({ status: "usado", expiresOn: "2026-11-01" }, hoy)).toBe("usado");
  });

  it("dice por qué no se puede usar un paquete", () => {
    const hoy = "2026-11-10";
    const ok = { status: "disponible" as const, expiresOn: "2026-12-10" };
    expect(motivoParaNoUsar(ok, "aprobado", hoy)).toBeNull();
    expect(motivoParaNoUsar(ok, "pendiente", hoy)).toMatch(/no está aprobado/);
    expect(motivoParaNoUsar(ok, "fallido", hoy)).toMatch(/falló/);
    expect(motivoParaNoUsar({ ...ok, expiresOn: "2026-11-09" }, "aprobado", hoy)).toMatch(/venció/);
    expect(motivoParaNoUsar({ ...ok, status: "usado" }, "aprobado", hoy)).toMatch(/ya se usó/);
    expect(motivoParaNoUsar({ ...ok, status: "retirado" }, "aprobado", hoy)).toMatch(/baja/);
  });
});

describe("ciclos", () => {
  it("resultado según indicadores: fallido manda; químico pendiente deja pendiente", () => {
    expect(resultadoSegunIndicadores("aprobado", "pendiente")).toBe("aprobado");
    expect(resultadoSegunIndicadores("no_aplica", "no_aplica")).toBe("aprobado");
    expect(resultadoSegunIndicadores("pendiente", "pendiente")).toBe("pendiente");
    expect(resultadoSegunIndicadores("aprobado", "fallido")).toBe("fallido");
    expect(resultadoSegunIndicadores("fallido", "aprobado")).toBe("fallido");
  });

  it("las pruebas del equipo no llevan paquetes", () => {
    expect(esPruebaDeEquipo("bowie_dick")).toBe(true);
    expect(esPruebaDeEquipo("helix")).toBe(true);
    expect(esPruebaDeEquipo("prueba_vacio")).toBe(true);
    expect(esPruebaDeEquipo("envuelto")).toBe(false);
  });

  it("parámetros en una línea, sin inventar los que faltan", () => {
    expect(parametrosDeCiclo({ temperatureC: 134, pressureBar: 2.1, exposureMinutes: 5.5 })).toBe(
      "134 °C · 2,1 bar · 5,5 min",
    );
    expect(parametrosDeCiclo({ temperatureC: 121, pressureBar: null, exposureMinutes: null })).toBe(
      "121 °C",
    );
  });

  it("registran owner, admin, dentista y asistente; recepción y contabilidad no", () => {
    expect(puedeRegistrarEsterilizacion("assistant")).toBe(true);
    expect(puedeRegistrarEsterilizacion("dentist")).toBe(true);
    expect(puedeRegistrarEsterilizacion("reception")).toBe(false);
    expect(puedeRegistrarEsterilizacion("accounting")).toBe(false);
    expect(puedeRegistrarEsterilizacion(null)).toBe(false);
  });

  it("normaliza el código escrito o escaneado", () => {
    expect(normalizarCodigo(" e2026-12 ")).toBe("E2026-00012");
    expect(normalizarCodigo("E2026-00012")).toBe("E2026-00012");
    expect(normalizarCodigo("2026 00012")).toBe("E2026-00012");
  });
});

describe("rastreo y resumen", () => {
  it("rastrea los pacientes de un ciclo, agrupando sus paquetes", () => {
    const lista = [
      paquete({
        id: "a",
        code: "E2026-00001",
        status: "usado",
        usedPatientId: "pB",
        usedPatientName: "Bruno",
        usedAt: "2026-11-10T15:00:00Z",
      }),
      paquete({
        id: "b",
        code: "E2026-00002",
        status: "usado",
        usedPatientId: "pA",
        usedPatientName: "Ana",
        usedAt: "2026-11-10T16:00:00Z",
      }),
      paquete({
        id: "c",
        code: "E2026-00003",
        status: "usado",
        usedPatientId: "pA",
        usedPatientName: "Ana",
        usedAt: "2026-11-11T10:00:00Z",
      }),
      paquete({ id: "d", code: "E2026-00004", status: "disponible" }),
      paquete({
        id: "e",
        cycleId: "otro",
        status: "usado",
        usedPatientId: "pZ",
        usedPatientName: "Zoe",
        usedAt: "2026-11-10T15:00:00Z",
      }),
    ];
    const r = rastreoDeCiclo("c1", lista);
    expect(r.map((x) => x.paciente)).toEqual(["Ana", "Bruno"]);
    expect(r[0].paquetes.map((p) => p.code)).toEqual(["E2026-00002", "E2026-00003"]);
  });

  it("resume disponibles, por vencer, vencidos, ciclos del período y fallidos con uso", () => {
    const hoy = "2026-11-10";
    const r = resumenEsterilizacion(
      [
        { id: "c1", result: "aprobado", runAt: "2026-11-09T15:00:00Z" },
        { id: "c2", result: "fallido", runAt: "2026-11-08T15:00:00Z" },
        { id: "c3", result: "pendiente", runAt: "2026-11-10T15:00:00Z" },
        { id: "c4", result: "aprobado", runAt: "2026-08-01T15:00:00Z" },
      ],
      [
        paquete({ id: "1", expiresOn: "2026-12-10" }),
        paquete({ id: "2", expiresOn: "2026-11-12" }),
        paquete({ id: "3", expiresOn: "2026-11-01" }),
        paquete({
          id: "4",
          cycleId: "c2",
          status: "usado",
          usedPatientId: "p",
          usedAt: "2026-11-08T16:00:00Z",
        }),
      ],
      hoy,
      ZONA,
    );
    expect(r.disponibles).toBe(2);
    expect(r.porVencer).toBe(1);
    expect(r.vencidos).toBe(1);
    expect(r.ciclosPeriodo).toEqual({ aprobados: 1, pendientes: 1, fallidos: 1 });
    expect(r.fallidosConUso).toEqual(["c2"]);
  });
});
