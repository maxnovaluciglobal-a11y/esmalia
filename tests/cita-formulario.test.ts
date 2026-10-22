import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  atiendePacientes,
  camposFaltantes,
  DURACIONES_PRESET,
  duracionAlElegirProcedimiento,
  elegirProcedimientosFrecuentes,
  esDuracionPreset,
  profesionalesDelSelector,
  textoFaltaCompletar,
  type ProcedimientoCatalogo,
} from "@/lib/clinic-operations/cita-formulario";

// Formulario de cita de la Ola 1 (AGE-11 a AGE-17): las piezas puras.

const proc = (id: string, durationMin: number | null = null, isActive = true) =>
  ({ id, name: `Proc ${id}`, durationMin, isActive }) satisfies ProcedimientoCatalogo;

describe("Falta completar (AGE-16)", () => {
  it("lista lo que falta en el orden del formulario", () => {
    expect(
      camposFaltantes({
        paciente: "",
        sucursal: "s1",
        profesional: "",
        tratamiento: "  ",
        inicio: "",
      }),
    ).toEqual(["paciente", "profesional", "tratamiento", "inicio"]);
  });

  it("solo revisa los campos que el diálogo pide (editar no pide paciente)", () => {
    expect(
      camposFaltantes({ sucursal: "s1", profesional: "p1", tratamiento: "x", inicio: "" }),
    ).toEqual(["inicio"]);
    expect(
      camposFaltantes({ sucursal: "s1", profesional: "p1", tratamiento: "x", inicio: "t" }),
    ).toEqual([]);
  });

  it("arma una frase legible, o null si no falta nada", () => {
    expect(textoFaltaCompletar([])).toBeNull();
    expect(textoFaltaCompletar(["paciente"])).toBe("Falta completar: paciente.");
    expect(textoFaltaCompletar(["paciente", "inicio"])).toBe(
      "Falta completar: paciente y fecha y hora.",
    );
    expect(textoFaltaCompletar(["paciente", "profesional", "tratamiento"])).toBe(
      "Falta completar: paciente, profesional y tratamiento.",
    );
  });
});

describe("Duración (AGE-13 y AGE-09 parcial)", () => {
  it("ofrece 15, 30, 45, 60, 90 y 120", () => {
    expect([...DURACIONES_PRESET]).toEqual([15, 30, 45, 60, 90, 120]);
    expect(esDuracionPreset(45)).toBe(true);
    expect(esDuracionPreset(50)).toBe(false);
  });

  it("el procedimiento propone su duración del arancel", () => {
    expect(
      duracionAlElegirProcedimiento({ actual: 30, delProcedimiento: 60, editadaAMano: false }),
    ).toBe(60);
  });

  it("lo que se eligió a mano se respeta", () => {
    expect(
      duracionAlElegirProcedimiento({ actual: 45, delProcedimiento: 60, editadaAMano: true }),
    ).toBe(45);
  });

  it("sin duración en el arancel (o fuera de rango) no cambia nada", () => {
    expect(
      duracionAlElegirProcedimiento({ actual: 30, delProcedimiento: null, editadaAMano: false }),
    ).toBe(30);
    expect(
      duracionAlElegirProcedimiento({ actual: 30, delProcedimiento: 0, editadaAMano: false }),
    ).toBe(30);
    expect(
      duracionAlElegirProcedimiento({ actual: 30, delProcedimiento: 600, editadaAMano: false }),
    ).toBe(30);
  });
});

describe("Procedimientos frecuentes (AGE-12)", () => {
  const catalogo = Array.from({ length: 20 }, (_, i) => proc(`p${i + 1}`));

  it("primero los favoritos (en el orden del arancel), después los más usados", () => {
    const elegidos = elegirProcedimientosFrecuentes({
      catalogo,
      favoritos: ["p9", "p3"],
      usos: [
        { procedureId: "p5", usos: 3 },
        { procedureId: "p7", usos: 10 },
        { procedureId: "p3", usos: 8 },
      ],
      minimo: 0,
    });
    expect(elegidos.map((p) => p.id)).toEqual(["p3", "p9", "p7", "p5"]);
  });

  it("nunca más de 12 y sin repetidos", () => {
    const elegidos = elegirProcedimientosFrecuentes({
      catalogo,
      favoritos: catalogo.map((p) => p.id),
      usos: catalogo.map((p, i) => ({ procedureId: p.id, usos: i + 1 })),
    });
    expect(elegidos).toHaveLength(12);
    expect(new Set(elegidos.map((p) => p.id)).size).toBe(12);
  });

  it("una clínica nueva (sin favoritos ni historial) ve 8 del arancel", () => {
    const elegidos = elegirProcedimientosFrecuentes({ catalogo, favoritos: [], usos: [] });
    expect(elegidos.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
  });

  it("deja afuera los dados de baja y los que ya no están en el arancel", () => {
    const elegidos = elegirProcedimientosFrecuentes({
      catalogo: [proc("a"), proc("b", null, false)],
      favoritos: ["b"],
      usos: [{ procedureId: "zz", usos: 99 }],
    });
    expect(elegidos.map((p) => p.id)).toEqual(["a"]);
  });

  it("con arancel vacío no hay botones", () => {
    expect(elegirProcedimientosFrecuentes({ catalogo: [], favoritos: [], usos: [] })).toEqual([]);
  });
});

describe("Solo quien atiende pacientes (AGE-17)", () => {
  it("sin usuario vinculado atiende; recepción, contabilidad y asistente no", () => {
    expect(atiendePacientes(null)).toBe(true);
    expect(atiendePacientes("dentist")).toBe(true);
    expect(atiendePacientes("owner")).toBe(true);
    expect(atiendePacientes("admin")).toBe(true);
    expect(atiendePacientes("reception")).toBe(false);
    expect(atiendePacientes("accounting")).toBe(false);
    expect(atiendePacientes("assistant")).toBe(false);
  });

  const pros = [
    { id: "a", sucursalId: "s1", atiende: true },
    { id: "b", sucursalId: "s1", atiende: false },
    { id: "c", sucursalId: "s2" },
  ];

  it("filtra por sucursal y deja afuera a quien no atiende", () => {
    expect(profesionalesDelSelector(pros, "s1").map((p) => p.id)).toEqual(["a"]);
    expect(profesionalesDelSelector(pros, "").map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("al editar, el profesional actual se mantiene aunque no cumpla", () => {
    expect(profesionalesDelSelector(pros, "s1", "b").map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("contrato de la agenda", () => {
  const agenda = readFileSync(
    path.resolve(__dirname, "../src/routes/_authenticated/_clinic/agenda.tsx"),
    "utf8",
  );

  it("los tres diálogos usan el formulario compartido y el aviso de lo que falta", () => {
    expect(agenda.match(/<CamposCita\b/g)).toHaveLength(3);
    expect(agenda.match(/<GuardarCita\b/g)).toHaveLength(3);
    expect(agenda.match(/enfocarPrimerFaltante\(faltan, ids\)/g)).toHaveLength(3);
  });

  it("los tres mandan tipo, box y observaciones al servidor", () => {
    expect(agenda.match(/appointmentTypeId: valores\.tipoId/g)).toHaveLength(3);
    expect(agenda.match(/operatoryId: valores\.boxId \|\| null/g)).toHaveLength(3);
  });
});
