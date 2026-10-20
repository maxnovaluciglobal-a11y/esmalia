import { describe, expect, it } from "vitest";

import { minutosDeHora, type BloqueHorario } from "@/components/agenda-arrastre";
import {
  etiquetaOcupacion,
  fechaMasAntigua,
  minutosDeTramos,
  minutosOcupados,
  ocupacionDeLaSemana,
  ocupacionDelDia,
  unirIntervalos,
  type CitaOcupacion,
} from "@/components/agenda-ocupacion";

// Semana del lunes 19 al domingo 25 de octubre de 2026.
const LUN = "2026-10-19";
const MAR = "2026-10-20";
const MIE = "2026-10-21";
const SAB = "2026-10-24";

const m = minutosDeHora;

function cita(profesionalId: string, fecha: string, desde: string, hasta: string): CitaOcupacion {
  return { profesionalId, fecha, inicio: m(desde), duracion: m(hasta) - m(desde) };
}

/** Lunes a viernes, mañana y tarde con colación de 13:00 a 14:00. */
function jornadaConColacion(): BloqueHorario[] {
  return [1, 2, 3, 4, 5].flatMap((dayOfWeek) => [
    { dayOfWeek, startTime: "09:00", endTime: "13:00" },
    { dayOfWeek, startTime: "14:00", endTime: "18:00" },
  ]);
}

describe("unirIntervalos y minutosDeTramos", () => {
  it("une los que se pisan o se tocan y descarta los vacíos", () => {
    expect(
      unirIntervalos([
        { inicio: 60, fin: 120 },
        { inicio: 100, fin: 150 },
        { inicio: 150, fin: 180 },
        { inicio: 300, fin: 300 },
        { inicio: 240, fin: 270 },
      ]),
    ).toEqual([
      { inicio: 60, fin: 180 },
      { inicio: 240, fin: 270 },
    ]);
    expect(
      minutosDeTramos([
        { inicio: 0, fin: 60 },
        { inicio: 30, fin: 90 },
      ]),
    ).toBe(90);
  });
});

describe("minutosOcupados", () => {
  const tramos = [
    { inicio: m("09:00"), fin: m("13:00") },
    { inicio: m("14:00"), fin: m("18:00") },
  ];

  it("no cuenta la colación aunque una cita la cruce", () => {
    // 12:30 a 14:30 = 120 min, pero solo 60 caen en horario.
    expect(minutosOcupados([{ inicio: m("12:30"), duracion: 120 }], tramos)).toBe(60);
  });

  it("cuenta una sola vez dos citas que se pisan", () => {
    expect(
      minutosOcupados(
        [
          { inicio: m("09:00"), duracion: 60 },
          { inicio: m("09:30"), duracion: 60 },
        ],
        tramos,
      ),
    ).toBe(90);
  });

  it("ignora lo que cae fuera del horario declarado", () => {
    expect(minutosOcupados([{ inicio: m("08:00"), duracion: 90 }], tramos)).toBe(30);
    expect(minutosOcupados([{ inicio: m("18:00"), duracion: 60 }], tramos)).toBe(0);
  });

  it("acepta citas antes de HORA_INICIO (minutos negativos)", () => {
    const temprano = [{ inicio: m("07:00"), fin: m("09:00") }];
    expect(minutosOcupados([{ inicio: m("07:30"), duracion: 30 }], temprano)).toBe(30);
  });
});

describe("ocupacionDelDia", () => {
  it("día con colación: 480 min disponibles, no 540", () => {
    const o = ocupacionDelDia({
      fecha: LUN,
      citas: [cita("pr", LUN, "09:00", "10:00"), cita("pr", LUN, "14:00", "15:00")],
      profesionalIds: ["pr"],
      horarios: { pr: jornadaConColacion() },
    });
    expect(o).toMatchObject({ ocupados: 120, disponibles: 480, porcentaje: 25, motivo: null });
  });

  it("día de varios bloques: tres tramos y dos colaciones", () => {
    const horarios = {
      pr: [
        { dayOfWeek: 1, startTime: "08:00", endTime: "10:00" },
        { dayOfWeek: 1, startTime: "11:00", endTime: "13:00" },
        { dayOfWeek: 1, startTime: "15:00", endTime: "19:00" },
      ],
    };
    const o = ocupacionDelDia({
      fecha: LUN,
      citas: [
        cita("pr", LUN, "09:30", "11:30"), // 30 + 30 (10:00-11:00 es colación)
        cita("pr", LUN, "15:00", "17:00"), // 120
      ],
      profesionalIds: ["pr"],
      horarios,
    });
    expect(o.disponibles).toBe(120 + 120 + 240);
    expect(o.ocupados).toBe(180);
    expect(o.porcentaje).toBe(38); // 180 / 480 = 37,5 %
  });

  it("bloques contiguos cuentan como un solo tramo", () => {
    const o = ocupacionDelDia({
      fecha: LUN,
      citas: [cita("pr", LUN, "10:30", "11:30")],
      profesionalIds: ["pr"],
      horarios: {
        pr: [
          { dayOfWeek: 1, startTime: "09:00", endTime: "11:00" },
          { dayOfWeek: 1, startTime: "11:00", endTime: "13:00" },
        ],
      },
    });
    expect(o).toMatchObject({ ocupados: 60, disponibles: 240, porcentaje: 25 });
  });

  it("suma los profesionales y deja afuera al que no declaró horario", () => {
    const o = ocupacionDelDia({
      fecha: LUN,
      citas: [
        cita("a", LUN, "09:00", "13:00"),
        cita("b", LUN, "09:00", "11:00"),
        cita("sin", LUN, "09:00", "18:00"),
      ],
      profesionalIds: ["a", "b", "sin"],
      horarios: { a: jornadaConColacion(), b: jornadaConColacion() },
    });
    expect(o).toMatchObject({ ocupados: 360, disponibles: 960, porcentaje: 38 });
  });

  it("nunca pasa de 100 % y no mira otros días ni otros profesionales", () => {
    const o = ocupacionDelDia({
      fecha: LUN,
      citas: [
        cita("pr", LUN, "08:00", "19:00"),
        cita("pr", MAR, "09:00", "18:00"),
        cita("otro", LUN, "09:00", "18:00"),
      ],
      profesionalIds: ["pr"],
      horarios: { pr: jornadaConColacion() },
    });
    expect(o).toMatchObject({ ocupados: 480, disponibles: 480, porcentaje: 100 });
  });

  it("sin horario declarado no inventa un 0 %", () => {
    const o = ocupacionDelDia({
      fecha: LUN,
      citas: [cita("pr", LUN, "09:00", "10:00")],
      profesionalIds: ["pr"],
      horarios: {},
    });
    expect(o).toMatchObject({ porcentaje: null, motivo: "sin-horario" });
    expect(etiquetaOcupacion(o)).toMatch(/sin horario/i);
  });

  it("día que no atiende (sábado) queda sin porcentaje", () => {
    const o = ocupacionDelDia({
      fecha: SAB,
      citas: [],
      profesionalIds: ["pr"],
      horarios: { pr: jornadaConColacion() },
    });
    expect(o).toMatchObject({ disponibles: 0, porcentaje: null, motivo: "sin-horario" });
  });
});

describe("ocupacionDeLaSemana: cálculo a mano de tres días de la demo", () => {
  // Dra. Rojas (pr): L-V 09-13 y 14-18. Dr. Vidal (tv): L-V 09-13 y 14-17.
  // Dra. Fuentes (cf): solo lunes y miércoles, 09-13.
  const horarios: Record<string, BloqueHorario[]> = {
    pr: jornadaConColacion(),
    tv: [1, 2, 3, 4, 5].flatMap((dayOfWeek) => [
      { dayOfWeek, startTime: "09:00", endTime: "13:00" },
      { dayOfWeek, startTime: "14:00", endTime: "17:00" },
    ]),
    cf: [
      { dayOfWeek: 1, startTime: "09:00", endTime: "13:00" },
      { dayOfWeek: 3, startTime: "09:00", endTime: "13:00" },
    ],
  };
  const citas: CitaOcupacion[] = [
    // Lunes
    cita("pr", LUN, "09:00", "10:00"),
    cita("pr", LUN, "10:00", "11:30"),
    cita("pr", LUN, "15:00", "16:30"),
    cita("tv", LUN, "09:30", "10:30"),
    cita("tv", LUN, "12:30", "14:30"), // cruza la colación
    cita("cf", LUN, "11:00", "12:00"),
    // Martes (cf no atiende: su cita no suma)
    cita("pr", MAR, "09:00", "13:00"),
    cita("pr", MAR, "14:00", "18:00"),
    cita("tv", MAR, "16:00", "17:30"), // pasa el fin del horario
    cita("cf", MAR, "10:00", "11:00"),
    // Miércoles (dos citas de pr que se pisan)
    cita("pr", MIE, "09:00", "10:00"),
    cita("pr", MIE, "09:30", "10:30"),
    cita("cf", MIE, "09:00", "13:00"),
  ];
  const semana = ocupacionDeLaSemana({
    dias: [LUN, MAR, MIE],
    citas,
    profesionalIds: ["pr", "tv", "cf"],
    horarios,
  });

  it("lunes: 420 de 1140 min = 37 %", () => {
    // Disponibles: pr 480 + tv 420 + cf 240 = 1140.
    // Ocupados: pr 60+90+90 = 240; tv 60 + 30 (12:30-13) + 30 (14-14:30) = 120; cf 60. Total 420.
    expect(semana.get(LUN)).toMatchObject({ ocupados: 420, disponibles: 1140, porcentaje: 37 });
  });

  it("martes: 540 de 900 min = 60 %", () => {
    // Disponibles: pr 480 + tv 420 = 900 (cf no atiende martes).
    // Ocupados: pr 480; tv 60 (16:00-17:00). Total 540.
    expect(semana.get(MAR)).toMatchObject({ ocupados: 540, disponibles: 900, porcentaje: 60 });
  });

  it("miércoles: 330 de 1140 min = 29 %", () => {
    // Ocupados: pr 90 (09:00-10:30 unidas); tv 0; cf 240. Total 330.
    expect(semana.get(MIE)).toMatchObject({ ocupados: 330, disponibles: 1140, porcentaje: 29 });
  });

  it("solo cuenta los carriles visibles (filtro de profesional)", () => {
    const soloPr = ocupacionDeLaSemana({ dias: [LUN], citas, profesionalIds: ["pr"], horarios });
    expect(soloPr.get(LUN)).toMatchObject({ ocupados: 240, disponibles: 480, porcentaje: 50 });
  });
});

describe("lista cortada por el tope de filas", () => {
  it("los días anteriores a la cita más vieja quedan sin datos", () => {
    const citas = [cita("pr", MAR, "09:00", "10:00"), cita("pr", MIE, "09:00", "10:00")];
    const semana = ocupacionDeLaSemana({
      dias: [LUN, MAR],
      citas,
      profesionalIds: ["pr"],
      horarios: { pr: jornadaConColacion() },
      datosDesde: fechaMasAntigua(citas),
    });
    expect(semana.get(LUN)).toMatchObject({ porcentaje: null, motivo: "sin-datos" });
    expect(etiquetaOcupacion(semana.get(LUN)!)).toMatch(/sin datos/i);
    expect(semana.get(MAR)).toMatchObject({ porcentaje: 13 }); // 60 / 480 = 12,5 %
  });

  it("fechaMasAntigua de una lista vacía es null", () => {
    expect(fechaMasAntigua([])).toBeNull();
  });
});
