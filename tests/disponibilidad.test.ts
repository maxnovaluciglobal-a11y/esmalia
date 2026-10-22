import { describe, expect, it } from "vitest";

import { huecosLibres, semillaDeHueco } from "@/components/agenda-hueco";
import { profesionalesDelSelector } from "@/lib/clinic-operations/cita-formulario";
import {
  aperturasDelDia,
  aplicaA,
  bloqueosQueChocan,
  cabeEn,
  citasAfectadas,
  conAperturas,
  cuandoAplica,
  filtrarHuecosAgendables,
  franjasDeDisponibilidad,
  minutosDeHHMM,
  problemaDeExcepcion,
  rangoDeExcepcion,
  restarTramos,
  sucursalesPorProfesional,
  sugerirReprogramaciones,
  sumarMinutosLocal,
  tramoDelDia,
  tramosNoAgendables,
  unirTramos,
  type CitaDisponibilidad,
  type ContextoSugerencia,
  type ExcepcionAgenda,
} from "@/lib/clinic-operations/disponibilidad";

/**
 * Ola 2 · frente Disponibilidad: lógica pura de bloqueos (AGE-07), aperturas
 * (AGE-08), horario de atención y grilla (AGE-10), profesional en varias
 * sucursales (AGE-23) y sugerencias de reprogramación (MKT-02).
 *
 * Unidad de los tramos: minutos desde HORA_INICIO (08:00), igual que
 * `Cita.inicio`. `m("13:00")` lo traduce para que los casos se lean en horas.
 */

const m = minutosDeHHMM;

function excepcion(parcial: Partial<ExcepcionAgenda>): ExcepcionAgenda {
  return {
    id: "e1",
    tipo: "bloqueo",
    motivo: "almuerzo",
    nota: null,
    profesionalId: "pro-a",
    sucursalId: null,
    boxId: null,
    boxNombre: null,
    inicio: "2026-10-26T13:00",
    fin: "2026-10-26T14:00",
    repetirSemanal: false,
    repetirHasta: null,
    ...parcial,
  };
}

describe("tramos", () => {
  it("une los que se tocan o se pisan y descarta los vacíos", () => {
    expect(
      unirTramos([
        { inicio: 60, fin: 120 },
        { inicio: 0, fin: 60 },
        { inicio: 200, fin: 200 },
        { inicio: 100, fin: 150 },
      ]),
    ).toEqual([{ inicio: 0, fin: 150 }]);
  });

  it("resta un tramo del medio y deja las dos puntas", () => {
    expect(restarTramos([{ inicio: 0, fin: 600 }], [{ inicio: 240, fin: 300 }])).toEqual([
      { inicio: 0, fin: 240 },
      { inicio: 300, fin: 600 },
    ]);
  });

  it("cabeEn exige que la cita entre entera", () => {
    const tramos = [
      { inicio: m("09:00"), fin: m("13:00") },
      { inicio: m("13:00"), fin: m("18:00") },
    ];
    expect(cabeEn({ inicio: m("12:30"), fin: m("13:30") }, tramos)).toBe(true);
    expect(cabeEn({ inicio: m("17:30"), fin: m("18:30") }, tramos)).toBe(false);
  });

  it("suma minutos a una hora de pared cruzando la medianoche", () => {
    expect(sumarMinutosLocal("2026-10-26T23:30", 45)).toBe("2026-10-27T00:15");
    expect(sumarMinutosLocal("2026-12-31T10:00", 30)).toBe("2026-12-31T10:30");
  });
});

describe("tramo del día de una excepción (AGE-07)", () => {
  it("un bloqueo de una hora ocupa solo ese día", () => {
    const e = excepcion({});
    expect(tramoDelDia(e, "2026-10-26")).toEqual({ inicio: m("13:00"), fin: m("14:00") });
    expect(tramoDelDia(e, "2026-10-27")).toBeNull();
  });

  it("unas vacaciones de varios días: primer día desde la hora, los del medio enteros", () => {
    const e = excepcion({ inicio: "2026-10-26T15:00", fin: "2026-10-29T00:00" });
    expect(tramoDelDia(e, "2026-10-26")).toEqual({ inicio: m("15:00"), fin: m("00:00") + 1440 });
    expect(tramoDelDia(e, "2026-10-27")).toEqual({ inicio: m("00:00"), fin: m("00:00") + 1440 });
    expect(tramoDelDia(e, "2026-10-28")).not.toBeNull();
    // Termina a las 00:00 del 29: ese día no lo ocupa.
    expect(tramoDelDia(e, "2026-10-29")).toBeNull();
  });

  it("el almuerzo semanal se repite el mismo día de la semana hasta la fecha de fin", () => {
    const e = excepcion({ repetirSemanal: true, repetirHasta: "2026-11-09" }); // lunes
    expect(tramoDelDia(e, "2026-10-26")).not.toBeNull();
    expect(tramoDelDia(e, "2026-11-02")).toEqual({ inicio: m("13:00"), fin: m("14:00") });
    expect(tramoDelDia(e, "2026-11-03")).toBeNull(); // martes
    expect(tramoDelDia(e, "2026-11-09")).not.toBeNull(); // último lunes, inclusive
    expect(tramoDelDia(e, "2026-11-16")).toBeNull();
    expect(tramoDelDia(e, "2026-10-19")).toBeNull(); // antes del primer día
  });

  it("sin fecha de fin, la repetición no termina", () => {
    const e = excepcion({ repetirSemanal: true });
    expect(tramoDelDia(e, "2027-10-25")).not.toBeNull(); // lunes, un año después
  });
});

describe("a quién le toca un bloqueo", () => {
  it("de un profesional: solo a ese profesional", () => {
    const e = excepcion({});
    expect(aplicaA(e, { profesionalId: "pro-a" })).toBe(true);
    expect(aplicaA(e, { profesionalId: "pro-b" })).toBe(false);
  });

  it("de una sucursal: a quien atiende ahí (ficha u horario, AGE-23)", () => {
    const e = excepcion({ profesionalId: null, sucursalId: "suc-1" });
    expect(aplicaA(e, { profesionalId: "x", sucursalId: "suc-1" })).toBe(true);
    expect(aplicaA(e, { profesionalId: "x", sucursalId: "suc-2" })).toBe(false);
    expect(
      aplicaA(e, { profesionalId: "x", sucursalId: "suc-2", sucursalesDelProfesional: ["suc-1"] }),
    ).toBe(true);
  });

  it("de un box: por id en la cita o por nombre del box del profesional en la grilla", () => {
    const e = excepcion({
      profesionalId: null,
      sucursalId: "suc-1",
      boxId: "box-1",
      boxNombre: "Box 2",
    });
    expect(aplicaA(e, { profesionalId: "x", boxId: "box-1" })).toBe(true);
    expect(aplicaA(e, { profesionalId: "x", boxId: "box-9" })).toBe(false);
    expect(aplicaA(e, { profesionalId: "x", sucursalId: "suc-1", boxNombre: "box 2" })).toBe(true);
    expect(aplicaA(e, { profesionalId: "x", sucursalId: "suc-2", boxNombre: "Box 2" })).toBe(false);
  });

  it("sin profesional, sucursal ni box: toda la clínica", () => {
    expect(aplicaA(excepcion({ profesionalId: null }), { profesionalId: "cualquiera" })).toBe(true);
  });
});

describe("crear una cita encima de un bloqueo avisa (AGE-07)", () => {
  const almuerzo = excepcion({ repetirSemanal: true });

  it("una cita que pisa el almuerzo aparece con el bloqueo", () => {
    const choques = bloqueosQueChocan([almuerzo], {
      profesionalId: "pro-a",
      fecha: "2026-11-02",
      inicio: m("12:30"),
      duracion: 45,
    });
    expect(choques).toHaveLength(1);
    expect(choques[0].excepcion.motivo).toBe("almuerzo");
  });

  it("una cita que termina justo cuando empieza el bloqueo no choca", () => {
    expect(
      bloqueosQueChocan([almuerzo], {
        profesionalId: "pro-a",
        fecha: "2026-11-02",
        inicio: m("12:30"),
        duracion: 30,
      }),
    ).toEqual([]);
  });

  it("una apertura no es un bloqueo", () => {
    expect(
      bloqueosQueChocan([excepcion({ tipo: "apertura", motivo: null })], {
        profesionalId: "pro-a",
        fecha: "2026-10-26",
        inicio: m("13:00"),
        duracion: 30,
      }),
    ).toEqual([]);
  });
});

describe("apertura excepcional (AGE-08)", () => {
  const sabado = excepcion({
    id: "ap",
    tipo: "apertura",
    motivo: null,
    inicio: "2026-10-31T09:00",
    fin: "2026-10-31T13:00",
  });

  it("suma el rango al horario declarado del día", () => {
    const horario = { declarado: true, tramos: [] }; // el sábado no atiende
    const aperturas = aperturasDelDia([sabado], "2026-10-31", "pro-a");
    expect(conAperturas(horario, aperturas).tramos).toEqual([
      { inicio: m("09:00"), fin: m("13:00") },
    ]);
  });

  it("sin horario declarado no cambia nada (ya se puede agendar)", () => {
    const horario = { declarado: false, tramos: [] };
    expect(conAperturas(horario, [{ inicio: 0, fin: 60 }])).toBe(horario);
  });

  it("le gana a la sucursal cerrada en la grilla", () => {
    const franjas = franjasDeDisponibilidad({
      fecha: "2026-10-31",
      destino: { profesionalId: "pro-a", sucursalId: "suc-1" },
      excepciones: [sabado],
      horarioSucursal: [{ dayOfWeek: 1, startTime: "09:00", endTime: "19:00" }],
    });
    const cerrado = franjas.filter((f) => f.tipo === "cerrado");
    expect(franjas.some((f) => f.tipo === "apertura")).toBe(true);
    // Lo cerrado no tapa la apertura.
    expect(cerrado.some((f) => f.inicio < m("13:00") && f.fin > m("09:00"))).toBe(false);
  });
});

describe("grilla: horario de atención, bloqueos e intervalo (AGE-10)", () => {
  it("fuera del horario de la sucursal se marca cerrado; sin horario declarado, nada", () => {
    const horario = [{ dayOfWeek: 1, startTime: "09:00", endTime: "19:00" }];
    const lunes = franjasDeDisponibilidad({
      fecha: "2026-10-26",
      destino: { profesionalId: "pro-a" },
      excepciones: [],
      horarioSucursal: horario,
    });
    expect(lunes.map((f) => f.tipo)).toEqual(["cerrado", "cerrado"]);
    expect(lunes[0].fin).toBe(m("09:00"));
    expect(lunes[1].inicio).toBe(m("19:00"));

    const domingo = franjasDeDisponibilidad({
      fecha: "2026-10-25",
      destino: { profesionalId: "pro-a" },
      excepciones: [],
      horarioSucursal: horario,
    });
    expect(domingo).toHaveLength(1);
    expect(domingo[0].etiqueta).toBe("Sucursal cerrada");

    expect(
      franjasDeDisponibilidad({
        fecha: "2026-10-26",
        destino: { profesionalId: "pro-a" },
        excepciones: [],
      }),
    ).toEqual([]);
  });

  it("los huecos del almuerzo no se ofrecen para agendar con un clic", () => {
    const franjas = franjasDeDisponibilidad({
      fecha: "2026-10-26",
      destino: { profesionalId: "pro-a" },
      excepciones: [excepcion({ nota: "con el equipo" })],
    });
    expect(franjas[0].etiqueta).toBe("Almuerzo: con el equipo");
    const libres = huecosLibres([], m("16:00"), m("12:00"), 30);
    const agendables = filtrarHuecosAgendables(libres, 30, tramosNoAgendables(franjas));
    expect(agendables).toEqual([
      m("12:00"),
      m("12:30"),
      m("14:00"),
      m("14:30"),
      m("15:00"),
      m("15:30"),
    ]);
  });

  it("el intervalo de la grilla define los huecos y el redondeo del clic", () => {
    expect(huecosLibres([], 60, 0, 10)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(huecosLibres([], 60, 0, 20)).toEqual([0, 20, 40]);
    expect(
      semillaDeHueco({ fecha: "2026-10-26", minutos: 135, profesional: { id: "p" }, paso: 20 })
        .startsAt,
    ).toBe("2026-10-26T10:00");
    expect(
      semillaDeHueco({ fecha: "2026-10-26", minutos: 135, profesional: { id: "p" } }).startsAt,
    ).toBe("2026-10-26T10:15");
  });
});

describe("validación al crear (par del CHECK de la base)", () => {
  const base = {
    tipo: "bloqueo" as const,
    motivo: "almuerzo" as const,
    profesionalId: "pro-a",
    inicio: "2026-10-26T13:00",
    fin: "2026-10-26T14:00",
    repetirSemanal: false,
    repetirHasta: null,
  };

  it("acepta un bloqueo válido", () => {
    expect(problemaDeExcepcion(base)).toBeNull();
  });

  it("el término tiene que ser después del inicio", () => {
    expect(problemaDeExcepcion({ ...base, fin: "2026-10-26T12:00" })).toMatch(/después/);
  });

  it("un bloqueo pide motivo y una apertura pide profesional", () => {
    expect(problemaDeExcepcion({ ...base, motivo: null })).toMatch(/motivo/);
    expect(
      problemaDeExcepcion({ ...base, tipo: "apertura", motivo: null, profesionalId: null }),
    ).toMatch(/profesional/);
  });

  it("lo que se repite empieza y termina el mismo día (o a la medianoche)", () => {
    expect(problemaDeExcepcion({ ...base, repetirSemanal: true, fin: "2026-10-27T10:00" })).toMatch(
      /mismo día/,
    );
    expect(
      problemaDeExcepcion({ ...base, repetirSemanal: true, fin: "2026-10-27T00:00" }),
    ).toBeNull();
  });

  it("tope de 120 días", () => {
    expect(problemaDeExcepcion({ ...base, fin: "2027-06-01T00:00" })).toMatch(/120 días/);
  });
});

describe("profesional en varias sucursales (AGE-23)", () => {
  const horarios = {
    "pro-a": [
      { dayOfWeek: 1, startTime: "09:00", endTime: "13:00", branchId: "suc-1" },
      { dayOfWeek: 2, startTime: "09:00", endTime: "13:00", branchId: "suc-2" },
    ],
    "pro-b": [{ dayOfWeek: 1, startTime: "09:00", endTime: "18:00", branchId: null }],
  };

  it("deduce las sucursales de cada profesional desde su horario", () => {
    expect(sucursalesPorProfesional(horarios)).toEqual({ "pro-a": ["suc-1", "suc-2"] });
  });

  it("el selector de la cita muestra al profesional en todas sus sucursales", () => {
    const profesionales = [
      { id: "pro-a", sucursalId: "suc-1" },
      { id: "pro-b", sucursalId: "suc-1" },
    ];
    const extra = sucursalesPorProfesional(horarios);
    expect(
      profesionalesDelSelector(profesionales, "suc-2", undefined, extra).map((p) => p.id),
    ).toEqual(["pro-a"]);
    // Sin el horario por sucursal, el comportamiento de antes.
    expect(profesionalesDelSelector(profesionales, "suc-2")).toEqual([]);
  });
});

describe("citas afectadas y reprogramación masiva (MKT-02)", () => {
  const vacaciones = excepcion({
    id: "vac",
    motivo: "vacaciones",
    inicio: "2026-10-26T00:00",
    fin: "2026-10-28T00:00",
  });
  const cita = (p: Partial<CitaDisponibilidad>): CitaDisponibilidad => ({
    id: "c",
    profesionalId: "pro-a",
    sucursalId: "suc-1",
    fecha: "2026-10-26",
    inicio: m("10:00"),
    duracion: 30,
    estado: "confirmada",
    ...p,
  });

  it("lista solo las por confirmar y confirmadas del profesional dentro del rango", () => {
    const citas = [
      cita({ id: "1" }),
      cita({ id: "2", fecha: "2026-10-27", estado: "tentativa" }),
      cita({ id: "3", estado: "finalizada" }),
      cita({ id: "4", profesionalId: "pro-b" }),
      cita({ id: "5", fecha: "2026-10-28" }),
    ];
    expect(citasAfectadas(vacaciones, citas).map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("el rango de una ausencia no incluye el día en que termina a las 00:00", () => {
    expect(rangoDeExcepcion(vacaciones, "2026-10-20")).toEqual(["2026-10-26", "2026-10-27"]);
    // Lo que ya pasó no se reprograma.
    expect(rangoDeExcepcion(vacaciones, "2026-10-27")).toEqual(["2026-10-27", "2026-10-27"]);
  });

  function contexto(citas: CitaDisponibilidad[]): ContextoSugerencia {
    return {
      profesionales: [
        { id: "pro-a", sucursalId: "suc-1" },
        { id: "pro-b", sucursalId: "suc-1" },
        { id: "pro-c", sucursalId: "suc-2" },
        { id: "recepcion", sucursalId: "suc-1", atiende: false },
      ],
      horarios: {
        "pro-a": [1, 2, 3, 4, 5].map((d) => ({
          dayOfWeek: d,
          startTime: "09:00",
          endTime: "13:00",
        })),
      },
      citas,
      excepciones: [vacaciones],
      paso: 15,
    };
  }

  it("primero propone otro profesional de la sucursal a la misma hora", () => {
    const afectada = cita({ id: "1" });
    const s = sugerirReprogramaciones([afectada], contexto([afectada])).get("1");
    expect(s).toEqual({
      tipo: "otro-profesional",
      profesionalId: "pro-b",
      fecha: "2026-10-26",
      inicio: m("10:00"),
    });
  });

  it("dos afectadas a la misma hora no reciben el mismo lugar", () => {
    const a = cita({ id: "1" });
    const b = cita({ id: "2", sucursalId: "suc-1" });
    // pro-b ya tiene algo a esa hora para la segunda: pasa al mismo profesional después.
    const s = sugerirReprogramaciones([a, b], contexto([a, b]));
    expect(s.get("1")?.profesionalId).toBe("pro-b");
    expect(s.get("2")).toEqual({
      tipo: "otro-horario",
      profesionalId: "pro-a",
      fecha: "2026-10-28",
      inicio: m("09:00"),
    });
  });

  it("si nadie está libre, busca el primer horario del mismo profesional después del bloqueo", () => {
    const afectada = cita({ id: "1" });
    const ocupada = cita({ id: "otra", profesionalId: "pro-b", estado: "confirmada" });
    const s = sugerirReprogramaciones([afectada], contexto([afectada, ocupada])).get("1");
    expect(s).toEqual({
      tipo: "otro-horario",
      profesionalId: "pro-a",
      fecha: "2026-10-28",
      inicio: m("09:00"),
    });
  });

  it("sin lugar en la ventana de búsqueda, no inventa nada", () => {
    const afectada = cita({ id: "1" });
    const ctx = { ...contexto([afectada]), profesionales: [{ id: "pro-a", sucursalId: "suc-1" }] };
    const s = sugerirReprogramaciones([afectada], { ...ctx, diasHaciaAdelante: 1 }).get("1");
    expect(s).toBeNull();
  });
});

describe("resumen de cuándo aplica", () => {
  it("todo el día muestra el último día, no el siguiente", () => {
    const c = cuandoAplica(excepcion({ inicio: "2026-10-26T00:00", fin: "2026-10-29T00:00" }));
    expect(c).toMatchObject({ tipo: "rango", todoElDia: true, hastaFecha: "2026-10-28" });
  });

  it("semanal: día y horas", () => {
    expect(cuandoAplica(excepcion({ repetirSemanal: true }))).toMatchObject({
      tipo: "semanal",
      dia: "Lunes",
      desdeHora: "13:00",
      hastaHora: "14:00",
    });
  });
});
