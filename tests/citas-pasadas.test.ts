import { describe, expect, it } from "vitest";

import {
  agruparCambiosPorEstado,
  esPasadaSinCerrar,
  opcionesDeCierre,
  resumenDeCierre,
  textoAvisoCitasPasadas,
} from "@/lib/clinic-operations/citas-pasadas";
import {
  contadoresDesdeFila,
  notaInasistencia,
  porcentajeInasistencia,
} from "@/lib/patients/contadores-citas";

describe("citas pasadas sin cerrar (PAN-05)", () => {
  const ahora = new Date("2026-10-22T15:00:00Z");

  it("solo cuentan las abiertas que ya terminaron", () => {
    const termino = "2026-10-22T14:30:00Z";
    expect(esPasadaSinCerrar({ estado: "tentativa", terminaEn: termino }, ahora)).toBe(true);
    expect(esPasadaSinCerrar({ estado: "confirmada", terminaEn: termino }, ahora)).toBe(true);
    expect(esPasadaSinCerrar({ estado: "en-sala", terminaEn: termino }, ahora)).toBe(true);
    for (const estado of ["finalizada", "ausente", "cancelada"]) {
      expect(esPasadaSinCerrar({ estado, terminaEn: termino }, ahora)).toBe(false);
    }
  });

  it("una cita en curso o futura no es pasada; el huso no importa (es un instante)", () => {
    // 11:30 en Santiago (UTC-3) termina 14:30 UTC: ya pasó a las 15:00 UTC.
    expect(
      esPasadaSinCerrar({ estado: "confirmada", terminaEn: "2026-10-22T11:30:00-03:00" }, ahora),
    ).toBe(true);
    // Termina 12:30 en Santiago = 15:30 UTC: todavía en curso.
    expect(
      esPasadaSinCerrar({ estado: "en-sala", terminaEn: "2026-10-22T12:30:00-03:00" }, ahora),
    ).toBe(false);
    expect(esPasadaSinCerrar({ estado: "confirmada", terminaEn: "no es fecha" }, ahora)).toBe(
      false,
    );
  });

  it("usa las etiquetas activas de la clínica y cae al nombre por defecto", () => {
    expect(opcionesDeCierre()).toEqual([
      { estado: "finalizada", etiqueta: "Atendida" },
      { estado: "ausente", etiqueta: "No asistió" },
      { estado: "cancelada", etiqueta: "Cancelada" },
    ]);
    const catalogo = [
      { label: "Finalizada", canonical: "finalizada", isActive: true, position: 6 },
      { label: "No asiste", canonical: "ausente", isActive: false, position: 7 },
      { label: "Anulada por el paciente", canonical: "cancelada", isActive: true, position: 9 },
      { label: "Anulada", canonical: "cancelada", isActive: true, position: 8 },
      { label: "Confirmada", canonical: "confirmada", isActive: true, position: 1 },
    ];
    expect(opcionesDeCierre(catalogo)).toEqual([
      { estado: "finalizada", etiqueta: "Finalizada" },
      // "No asiste" está desactivada: la opción sigue, con el nombre por defecto.
      { estado: "ausente", etiqueta: "No asistió" },
      // La de menor posición gana.
      { estado: "cancelada", etiqueta: "Anulada" },
    ]);
  });

  it("aviso en singular y plural", () => {
    expect(textoAvisoCitasPasadas(1)).toBe("Tienes 1 cita pasada sin cerrar");
    expect(textoAvisoCitasPasadas(7)).toBe("Tienes 7 citas pasadas sin cerrar");
  });

  it("agrupa por estado y el último cambio de una cita gana", () => {
    const grupos = agruparCambiosPorEstado([
      { appointmentId: "a", estado: "finalizada" },
      { appointmentId: "b", estado: "ausente" },
      { appointmentId: "a", estado: "cancelada" },
      { appointmentId: "c", estado: "finalizada" },
    ]);
    expect(Object.fromEntries(grupos)).toEqual({
      ausente: ["b"],
      cancelada: ["a"],
      finalizada: ["c"],
    });
  });

  it("resume el cierre con los nombres de la clínica y cuenta las omitidas", () => {
    expect(resumenDeCierre({ finalizada: 2, ausente: 1 }, 0)).toBe(
      "3 citas cerradas: 2 Atendida, 1 No asistió.",
    );
    expect(resumenDeCierre({ finalizada: 1 }, 1)).toBe(
      "1 cita cerrada: 1 Atendida. 1 ya estaba cerrada o todavía no termina.",
    );
    expect(resumenDeCierre({}, 2)).toBe(
      "No se cerró ninguna cita. 2 ya estaban cerradas o todavía no terminan.",
    );
  });
});

describe("contadores de citas de la ficha (FIC-12)", () => {
  it("el % de inasistencia es null sin citas cerradas (regla 11)", () => {
    expect(porcentajeInasistencia(0, 0)).toBeNull();
    expect(porcentajeInasistencia(3, 1)).toBe(25);
    expect(porcentajeInasistencia(0, 2)).toBe(100);
  });

  it("arma los contadores desde la fila de la RPC", () => {
    const c = contadoresDesdeFila({
      attended: 9,
      no_show: 1,
      cancelled: 2,
      upcoming: 1,
      past_open: 3,
      last_visit_at: "2026-10-01T13:00:00Z",
      next_at: "2026-11-01T13:00:00Z",
    });
    expect(c).toEqual({
      atendidas: 9,
      inasistencias: 1,
      anuladas: 2,
      proximas: 1,
      sinCerrar: 3,
      pctInasistencia: 10,
      ultimaVisita: "2026-10-01T13:00:00Z",
      proximaCita: "2026-11-01T13:00:00Z",
    });
    expect(notaInasistencia(c)).toBe("10 % de sus citas");
  });

  it("sin fila (paciente nuevo) todo en cero y sin fechas", () => {
    const c = contadoresDesdeFila(undefined);
    expect(c.atendidas).toBe(0);
    expect(c.pctInasistencia).toBeNull();
    expect(c.ultimaVisita).toBeNull();
    expect(notaInasistencia(c)).toBe("Sin datos");
  });
});
