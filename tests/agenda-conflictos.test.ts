import { describe, expect, it } from "vitest";

import {
  boxDe,
  conflictosDeCandidata,
  describirConflicto,
  detectarConflictos,
  resumenConflictos,
  SIN_BOX,
  tiposDe,
  type CitaConflicto,
  type ProfesionalConflicto,
} from "@/components/agenda-conflictos";
import { minutosDeHora } from "@/components/agenda-movimiento";

const m = minutosDeHora;
const DIA = "2026-10-21";

const profesionales: ProfesionalConflicto[] = [
  { id: "soto", nombre: "Dr. Ignacio Soto", box: "Box 1", sucursalId: "lc" },
  { id: "rojas", nombre: "Dra. Fernanda Rojas", box: "Box 1", sucursalId: "lc" },
  { id: "herrera", nombre: "Dra. Camila Herrera", box: SIN_BOX, sucursalId: "lc" },
  { id: "reyes", nombre: "Dr. Matías Reyes", box: SIN_BOX, sucursalId: "lc" },
  // Mismo nombre de box, otra sucursal: es otro box.
  { id: "lagos", nombre: "Dr. Pedro Lagos", box: "Box 1", sucursalId: "prov" },
];

let n = 0;
function cita(
  profesionalId: string,
  desde: string,
  hasta: string,
  extra: Partial<CitaConflicto> = {},
): CitaConflicto {
  n += 1;
  const sucursalId = profesionales.find((p) => p.id === profesionalId)?.sucursalId ?? "";
  return {
    id: `c${n}`,
    pacienteId: `pac${n}`,
    paciente: `Paciente ${n}`,
    profesionalId,
    sucursalId,
    fecha: DIA,
    inicio: m(desde),
    duracion: m(hasta) - m(desde),
    estado: "confirmada",
    tratamiento: "Control",
    ...extra,
  };
}

const nombre = (id: string) => profesionales.find((p) => p.id === id)?.nombre ?? "—";

describe("boxDe", () => {
  it("'Sin box asignado' y vacío no son box", () => {
    expect(boxDe({ box: SIN_BOX })).toBeNull();
    expect(boxDe({ box: "  " })).toBeNull();
    expect(boxDe(undefined)).toBeNull();
    expect(boxDe({ box: "Box 2" })).toBe("Box 2");
  });
});

describe("detectarConflictos", () => {
  it("mismo paciente con dos profesionales a la vez (el caso de la demo)", () => {
    const a = cita("soto", "11:00", "11:30", { pacienteId: "benja", paciente: "Benjamín Castro" });
    const b = cita("herrera", "11:15", "12:45", {
      pacienteId: "benja",
      paciente: "Benjamín Castro",
    });
    const r = detectarConflictos([a, b], profesionales);
    expect(r.get(a.id)).toEqual([{ tipo: "paciente", cita: b }]);
    expect(r.get(b.id)).toEqual([{ tipo: "paciente", cita: a }]);
  });

  it("mismo profesional con dos pacientes a la vez", () => {
    const a = cita("herrera", "09:00", "10:00");
    const b = cita("herrera", "09:30", "10:00");
    const r = detectarConflictos([a, b], profesionales);
    expect(tiposDe(r.get(a.id))).toEqual(["profesional"]);
    expect(tiposDe(r.get(b.id))).toEqual(["profesional"]);
  });

  it("mismo box con dos profesionales de la misma sucursal", () => {
    const a = cita("soto", "15:00", "16:00");
    const b = cita("rojas", "15:30", "16:30");
    const r = detectarConflictos([a, b], profesionales);
    expect(tiposDe(r.get(a.id))).toEqual(["box"]);
  });

  it("el mismo nombre de box en otra sucursal no choca", () => {
    const a = cita("soto", "15:00", "16:00");
    const b = cita("lagos", "15:00", "16:00");
    expect(detectarConflictos([a, b], profesionales).size).toBe(0);
  });

  it("'Sin box asignado' no es un box compartido", () => {
    const a = cita("herrera", "15:00", "16:00");
    const b = cita("reyes", "15:00", "16:00");
    expect(detectarConflictos([a, b], profesionales).size).toBe(0);
  });

  it("citas que solo se tocan (una termina cuando empieza la otra) no chocan", () => {
    const a = cita("soto", "09:00", "09:30");
    const b = cita("soto", "09:30", "10:00");
    expect(detectarConflictos([a, b], profesionales).size).toBe(0);
  });

  it("otro día, sin choque", () => {
    const a = cita("soto", "09:00", "10:00");
    const b = cita("soto", "09:00", "10:00", { fecha: "2026-10-22" });
    expect(detectarConflictos([a, b], profesionales).size).toBe(0);
  });

  it("una cita ausente no ocupa el horario", () => {
    const a = cita("soto", "09:00", "10:00", { estado: "ausente" });
    const b = cita("soto", "09:00", "10:00");
    expect(detectarConflictos([a, b], profesionales).size).toBe(0);
  });

  it("junta varios tipos y los ordena por gravedad", () => {
    const a = cita("soto", "10:00", "11:00", { pacienteId: "x" });
    const b = cita("soto", "10:30", "11:30", { pacienteId: "x" });
    const c = cita("rojas", "10:45", "11:15");
    const r = detectarConflictos([c, b, a], profesionales);
    expect(tiposDe(r.get(a.id))).toEqual(["paciente", "profesional", "box"]);
    expect(r.get(a.id)?.map((x) => x.tipo)).toEqual(["paciente", "profesional", "box"]);
    expect(resumenConflictos(r.get(a.id))).toBe(
      "Choque de horario: mismo paciente, mismo profesional y mismo box",
    );
  });

  it("una cita larga choca con una que empieza después de otras que ya terminaron", () => {
    const larga = cita("soto", "09:00", "12:00");
    const corta1 = cita("soto", "09:00", "09:30");
    const corta2 = cita("soto", "11:30", "12:30");
    const r = detectarConflictos([larga, corta1, corta2], profesionales);
    expect(r.get(larga.id)?.map((x) => x.cita.id)).toEqual([corta1.id, corta2.id]);
    expect(r.get(corta1.id)?.length).toBe(1);
    expect(r.get(corta2.id)?.length).toBe(1);
  });
});

describe("conflictosDeCandidata", () => {
  const existentes = [
    cita("soto", "11:00", "11:30", { pacienteId: "benja", paciente: "Benjamín Castro" }),
    cita("rojas", "14:00", "15:00", { paciente: "Antonia Pizarro" }),
  ];

  it("avisa antes de guardar si el paciente ya tiene una cita a esa hora", () => {
    const r = conflictosDeCandidata(
      {
        pacienteId: "benja",
        profesionalId: "herrera",
        fecha: DIA,
        inicio: m("11:15"),
        duracion: 30,
      },
      existentes,
      profesionales,
    );
    expect(r).toHaveLength(1);
    expect(r[0].tipo).toBe("paciente");
    expect(describirConflicto(r[0], nombre)).toBe(
      "Mismo paciente: Benjamín Castro con Dr. Ignacio Soto, 11:00–11:30",
    );
  });

  it("mismo box: muestra el box en el texto", () => {
    const r = conflictosDeCandidata(
      { pacienteId: "otro", profesionalId: "soto", fecha: DIA, inicio: m("14:30"), duracion: 60 },
      existentes,
      profesionales,
    );
    expect(r.map((x) => x.tipo)).toEqual(["box"]);
    expect(describirConflicto(r[0], nombre, "Box 1")).toBe(
      "Mismo box (Box 1): Antonia Pizarro con Dra. Fernanda Rojas, 14:00–15:00",
    );
  });

  it("al editar, la propia cita no choca consigo misma", () => {
    const propia = existentes[0];
    const r = conflictosDeCandidata(
      {
        id: propia.id,
        pacienteId: "benja",
        profesionalId: "soto",
        fecha: DIA,
        inicio: m("11:00"),
        duracion: 45,
      },
      existentes,
      profesionales,
    );
    expect(r).toEqual([]);
  });

  it("sin fecha o sin duración no hay aviso", () => {
    expect(
      conflictosDeCandidata(
        { pacienteId: "benja", profesionalId: "soto", fecha: "", inicio: 0, duracion: 30 },
        existentes,
        profesionales,
      ),
    ).toEqual([]);
    expect(
      conflictosDeCandidata(
        { pacienteId: "benja", profesionalId: "soto", fecha: DIA, inicio: m("11:00"), duracion: 0 },
        existentes,
        profesionales,
      ),
    ).toEqual([]);
  });

  it("sin paciente elegido todavía, igual avisa del profesional", () => {
    const r = conflictosDeCandidata(
      { pacienteId: "", profesionalId: "soto", fecha: DIA, inicio: m("11:00"), duracion: 30 },
      existentes,
      profesionales,
    );
    expect(r.map((x) => x.tipo)).toEqual(["profesional"]);
  });
});
