import { describe, expect, it } from "vitest";

import { detectarConflictos } from "@/components/agenda-conflictos";
import {
  cuposLibres,
  estaLlena,
  etiquetaCupo,
  motivoParaNoInscribir,
  ordenarParticipantes,
  pacientesDeCita,
  puedeMarcarAsistencia,
  resumenAsistencia,
  validarGrupo,
} from "@/lib/clinic-operations/citas-grupales";
import type { Cita } from "@/lib/clinic-operations/clinic-data";

/** AGE-22 (Ola 14): cupo, asistencia y choques de las citas grupales (puro). */

describe("cupo de la cita grupal", () => {
  it("cuenta los cupos libres sin bajar de cero", () => {
    expect(cuposLibres(10, 4)).toBe(6);
    expect(cuposLibres(3, 3)).toBe(0);
    expect(cuposLibres(3, 5)).toBe(0);
    expect(estaLlena(3, 3)).toBe(true);
    expect(estaLlena(3, 2)).toBe(false);
  });

  it("etiqueta larga para el cajón y corta para la grilla", () => {
    expect(etiquetaCupo({ cupo: 10, inscritos: 4 })).toBe("4 de 10");
    expect(etiquetaCupo({ cupo: 10, inscritos: 4 }, true)).toBe("4/10");
  });

  it("valida nombre y cupo como la base (2 a 200, no menos que los inscritos)", () => {
    expect(validarGrupo("Charla de higiene", 10)).toBeNull();
    expect(validarGrupo(" ", 10)).toMatch(/nombre/);
    expect(validarGrupo("Charla", 1)).toMatch(/mínimo/);
    expect(validarGrupo("Charla", 201)).toMatch(/máximo/);
    expect(validarGrupo("Charla", 2.5)).toMatch(/entero/);
    expect(validarGrupo("Charla", 3, 5)).toMatch(/Ya hay 5/);
    expect(validarGrupo("x".repeat(121), 10)).toMatch(/120/);
  });

  it("dice por qué no se puede inscribir: cancelada, ya inscrito o llena", () => {
    expect(motivoParaNoInscribir({ cupo: 5, inscritos: 2, estadoCita: "confirmada" })).toBeNull();
    expect(motivoParaNoInscribir({ cupo: 2, inscritos: 2, estadoCita: "confirmada" })).toBe(
      "llena",
    );
    expect(motivoParaNoInscribir({ cupo: 5, inscritos: 2, estadoCita: "cancelada" })).toBe(
      "cancelada",
    );
    expect(
      motivoParaNoInscribir({
        cupo: 5,
        inscritos: 2,
        estadoCita: "tentativa",
        pacienteId: "p1",
        vigentes: ["p1", "p2"],
      }),
    ).toBe("ya_inscrito");
  });
});

describe("asistencia individual", () => {
  it("se marca desde que empieza la cita", () => {
    const ahora = new Date("2026-11-10T15:00:00Z");
    expect(puedeMarcarAsistencia("2026-11-10T14:30:00Z", ahora)).toBe(true);
    expect(puedeMarcarAsistencia("2026-11-10T15:00:00Z", ahora)).toBe(true);
    expect(puedeMarcarAsistencia("2026-11-10T15:30:00Z", ahora)).toBe(false);
  });

  it("resume asistentes, ausentes y sin marcar; los retirados aparte", () => {
    const r = resumenAsistencia([
      { asistencia: "asistio", retiradoEn: null },
      { asistencia: "asistio", retiradoEn: null },
      { asistencia: "ausente", retiradoEn: null },
      { asistencia: "pendiente", retiradoEn: null },
      { asistencia: "pendiente", retiradoEn: "2026-11-01T10:00:00Z" },
    ]);
    expect(r).toEqual({ vigentes: 4, asistieron: 2, ausentes: 1, sinMarcar: 1, retirados: 1 });
  });

  it("ordena vigentes por inscripción y los retirados al final", () => {
    const lista = ordenarParticipantes([
      { id: "c", inscritoEn: "2026-11-01T10:02:00Z", retiradoEn: null },
      { id: "r", inscritoEn: "2026-11-01T10:00:00Z", retiradoEn: "2026-11-02T10:00:00Z" },
      { id: "a", inscritoEn: "2026-11-01T10:01:00Z", retiradoEn: null },
    ]);
    expect(lista.map((p) => p.id)).toEqual(["a", "c", "r"]);
  });
});

describe("choques con citas grupales (UX-04)", () => {
  const base: Cita = {
    id: "g",
    pacienteId: "p1",
    paciente: "Charla de higiene",
    tratamiento: "Charla",
    profesionalId: "pro-1",
    sucursalId: "s1",
    fecha: "2026-11-10",
    inicio: 120,
    duracion: 60,
    estado: "confirmada",
    grupal: {
      titulo: "Charla de higiene",
      cupo: 10,
      inscritos: 3,
      pacienteIds: ["p1", "p2", "p3"],
    },
  };

  it("los pacientes de la cita son todos sus inscritos", () => {
    expect(pacientesDeCita(base)).toEqual(["p1", "p2", "p3"]);
    expect(pacientesDeCita({ pacienteId: "p9" })).toEqual(["p9"]);
  });

  it("avisa si un inscrito (no solo el titular) tiene otra cita a la misma hora", () => {
    const otra: Cita = {
      ...base,
      id: "i",
      pacienteId: "p3",
      paciente: "Paciente 3",
      profesionalId: "pro-2",
      grupal: undefined,
    };
    const choques = detectarConflictos([base, otra], []);
    expect(choques.get("i")?.map((c) => c.tipo)).toContain("paciente");
  });

  it("la grupal ocupa al profesional una sola vez (no un choque por inscrito)", () => {
    const otra: Cita = {
      ...base,
      id: "i",
      pacienteId: "p9",
      paciente: "Paciente 9",
      grupal: undefined,
    };
    const choques = detectarConflictos([base, otra], []);
    expect(choques.get("i")?.filter((c) => c.tipo === "profesional")).toHaveLength(1);
  });
});
