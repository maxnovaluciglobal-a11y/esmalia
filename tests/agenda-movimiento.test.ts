import { describe, expect, it } from "vitest";

import {
  aplicarMovimientosPendientes,
  colaciones,
  destinoDeStartsAt,
  destinoPorTeclado,
  diaSemanaDeFecha,
  encajar,
  esMovible,
  fraseDeMovimiento,
  horarioDelDia,
  horasPosibles,
  indiceDeCarril,
  inicioPorArrastre,
  limitarAlRango,
  minutosDeHora,
  payloadDeMovimiento,
  pxAMinutos,
  startsAtDe,
  validarDestino,
  type BloqueHorario,
} from "@/components/agenda-movimiento";
import { citaCabeEnBloques } from "@/lib/clinic-operations/appointments.functions";
import { HORA_INICIO, PIXELES_POR_MINUTO, type Cita } from "@/lib/clinic-operations/clinic-data";

/**
 * Arrastrar para reprogramar (PR 10 del plan A+). Todo en minutos desde
 * HORA_INICIO (08:00), la misma unidad que `Cita.inicio`.
 */

const m = (hhmm: string) => minutosDeHora(hhmm);

function cita(over: Partial<Cita> = {}): Cita {
  return {
    id: "c1",
    pacienteId: "pac-1",
    paciente: "Martina Soto",
    tratamiento: "Endodoncia 36",
    profesionalId: "rojas",
    sucursalId: "suc-1",
    fecha: "2026-10-21", // miércoles
    inicio: m("10:30"),
    duracion: 60,
    estado: "confirmada",
    ...over,
  };
}

// Lunes a viernes 09:00–13:00 y 14:00–18:00 (colación 13–14). Sin fines de semana.
const HORARIO_ROJAS: BloqueHorario[] = [1, 2, 3, 4, 5].flatMap((d) => [
  { dayOfWeek: d, startTime: "09:00", endTime: "13:00" },
  { dayOfWeek: d, startTime: "14:00", endTime: "18:00" },
]);

describe("px a minutos y encaje", () => {
  it("convierte píxeles a minutos con la escala de la grilla", () => {
    expect(pxAMinutos(60 * PIXELES_POR_MINUTO)).toBeCloseTo(60);
    expect(pxAMinutos(76, 76 / 60)).toBeCloseTo(60);
    expect(pxAMinutos(Number.NaN)).toBe(0);
  });

  it("encaja al cuarto de hora más cercano, o a 5 minutos en modo fino", () => {
    expect(encajar(37)).toBe(30);
    expect(encajar(38)).toBe(45);
    expect(encajar(-8)).toBe(-15);
    expect(encajar(37, 5)).toBe(35);
    expect(encajar(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("deja la cita entera dentro de la grilla", () => {
    const rango = { desde: 0, hasta: 12 * 60 };
    expect(limitarAlRango(-30, 60, rango)).toBe(0);
    expect(limitarAlRango(700, 60, rango)).toBe(660);
    expect(limitarAlRango(120, 60, rango)).toBe(120);
  });

  it("calcula la hora destino desde el desplazamiento del puntero", () => {
    const rango = { desde: 0, hasta: 12 * 60 };
    // Bajar 50 minutos de píxeles desde las 10:30 cae a las 11:15 (encaje).
    expect(
      inicioPorArrastre({
        inicioOriginal: m("10:30"),
        deltaPx: 50 * PIXELES_POR_MINUTO,
        duracion: 60,
        rango,
      }),
    ).toBe(m("11:15"));
    // Subir mucho no sale de la grilla.
    expect(inicioPorArrastre({ inicioOriginal: 30, deltaPx: -2000, duracion: 60, rango })).toBe(0);
  });
});

describe("carril bajo el puntero (cambio de profesional)", () => {
  const carriles = [
    { izquierda: 72, derecha: 216 },
    { izquierda: 216, derecha: 360 },
    { izquierda: 360, derecha: 504 },
  ];

  it("elige el carril que contiene al puntero", () => {
    expect(indiceDeCarril(100, carriles)).toBe(0);
    expect(indiceDeCarril(216, carriles)).toBe(1);
    expect(indiceDeCarril(503, carriles)).toBe(2);
  });

  it("fuera de todos, el más cercano; los ocultos (ancho 0) no cuentan", () => {
    expect(indiceDeCarril(10, carriles)).toBe(0);
    expect(indiceDeCarril(900, carriles)).toBe(2);
    expect(indiceDeCarril(100, [{ izquierda: 0, derecha: 0 }, ...carriles])).toBe(1);
    expect(indiceDeCarril(100, [])).toBe(-1);
  });
});

describe("horario declarado y colación", () => {
  it("lee el día de la semana de una fecha de calendario sin depender del huso", () => {
    expect(diaSemanaDeFecha("2026-10-19")).toBe(1); // lunes
    expect(diaSemanaDeFecha("2026-10-25")).toBe(0); // domingo
  });

  it("arma los tramos del día y la colación entre ellos", () => {
    const h = horarioDelDia(HORARIO_ROJAS, "2026-10-21");
    expect(h).toEqual({
      declarado: true,
      tramos: [
        { inicio: m("09:00"), fin: m("13:00") },
        { inicio: m("14:00"), fin: m("18:00") },
      ],
    });
    expect(colaciones(h)).toEqual([{ inicio: m("13:00"), fin: m("14:00") }]);
  });

  it("une bloques que se tocan (no hay colación de cero minutos)", () => {
    const h = horarioDelDia(
      [
        { dayOfWeek: 3, startTime: "09:00", endTime: "13:00" },
        { dayOfWeek: 3, startTime: "13:00", endTime: "18:00" },
      ],
      "2026-10-21",
    );
    expect(h.tramos).toEqual([{ inicio: m("09:00"), fin: m("18:00") }]);
    expect(colaciones(h)).toEqual([]);
  });

  it("sin ningún bloque declarado no hay restricción", () => {
    expect(horarioDelDia([], "2026-10-21")).toEqual({ declarado: false, tramos: [] });
    expect(horarioDelDia(undefined, "2026-10-21").declarado).toBe(false);
  });

  it("las horas que ofrece 'Mover a…' respetan los tramos y saltan la colación", () => {
    const horas = horasPosibles(HORARIO_ROJAS, "2026-10-21", 60);
    expect(horas[0]).toBe(m("09:00"));
    expect(horas).toContain(m("12:00"));
    expect(horas).not.toContain(m("12:15")); // terminaría 13:15, en la colación
    expect(horas).not.toContain(m("13:00"));
    expect(horas).toContain(m("14:00"));
    expect(horas.at(-1)).toBe(m("17:00"));
    // Sin horario declarado: de 07:00 a 21:00.
    const amplias = horasPosibles(undefined, "2026-10-21", 30);
    expect(amplias[0]).toBe(m("07:00"));
    expect(amplias.at(-1)).toBe(m("20:30"));
  });
});

describe("validarDestino", () => {
  const horario = horarioDelDia(HORARIO_ROJAS, "2026-10-21");
  const base = {
    cita: cita(),
    horario,
    citasDelCarril: [] as Cita[],
    nombreProfesional: "Dra. Rojas",
  };

  it("acepta un destino libre dentro del horario", () => {
    expect(
      validarDestino({
        ...base,
        destino: { fecha: "2026-10-21", inicio: m("11:30"), profesionalId: "rojas" },
      }),
    ).toEqual({ ok: true });
  });

  it("soltar donde estaba no es un movimiento", () => {
    const v = validarDestino({
      ...base,
      destino: { fecha: "2026-10-21", inicio: m("10:30"), profesionalId: "rojas" },
    });
    expect(v).toMatchObject({ ok: false, motivo: "sin-cambio" });
  });

  it("rechaza fuera del horario del profesional", () => {
    const v = validarDestino({
      ...base,
      destino: { fecha: "2026-10-21", inicio: m("17:30"), profesionalId: "rojas" },
    });
    expect(v).toEqual({
      ok: false,
      motivo: "fuera-de-horario",
      mensaje: "Fuera del horario de Dra. Rojas (09:00–13:00 y 14:00–18:00).",
    });
  });

  it("rechaza si cae en la colación, con su propio mensaje", () => {
    const v = validarDestino({
      ...base,
      destino: { fecha: "2026-10-21", inicio: m("12:30"), profesionalId: "rojas" },
    });
    expect(v).toMatchObject({ ok: false, motivo: "colacion" });
    expect(!v.ok && v.mensaje).toMatch(/colación de Dra\. Rojas/);
  });

  it("rechaza un día que el profesional no atiende", () => {
    const v = validarDestino({
      ...base,
      horario: horarioDelDia(HORARIO_ROJAS, "2026-10-25"),
      destino: { fecha: "2026-10-25", inicio: m("10:00"), profesionalId: "rojas" },
    });
    expect(v).toEqual({
      ok: false,
      motivo: "no-atiende",
      mensaje: "Dra. Rojas no atiende los domingos.",
    });
  });

  it("sin horario declarado, cualquier hora libre vale", () => {
    expect(
      validarDestino({
        ...base,
        horario: { declarado: false, tramos: [] },
        destino: { fecha: "2026-10-25", inicio: m("20:00"), profesionalId: "rojas" },
      }),
    ).toEqual({ ok: true });
  });

  it("rechaza si el destino está ocupado por otra cita del carril (pero no por sí misma)", () => {
    const otra = cita({ id: "c2", inicio: m("11:30"), duracion: 30 });
    const v = validarDestino({
      ...base,
      citasDelCarril: [base.cita, otra],
      destino: { fecha: "2026-10-21", inicio: m("11:00"), profesionalId: "rojas" },
    });
    expect(v).toMatchObject({ ok: false, motivo: "ocupado" });
    // Moverla 15 minutos se pisa consigo misma: eso no es choque.
    expect(
      validarDestino({
        ...base,
        citasDelCarril: [base.cita],
        destino: { fecha: "2026-10-21", inicio: m("10:45"), profesionalId: "rojas" },
      }),
    ).toEqual({ ok: true });
    // Pegada a la otra (termina 11:30 justo cuando empieza) no choca.
    expect(
      validarDestino({
        ...base,
        cita: cita({ duracion: 30 }),
        citasDelCarril: [otra],
        destino: { fecha: "2026-10-21", inicio: m("11:00"), profesionalId: "rojas" },
      }),
    ).toEqual({ ok: true });
  });

  it("cambio de carril: valida contra el horario y las citas del profesional destino", () => {
    const v = validarDestino({
      ...base,
      horario: horarioDelDia(
        [{ dayOfWeek: 3, startTime: "11:00", endTime: "19:00" }],
        "2026-10-21",
      ),
      citasDelCarril: [],
      nombreProfesional: "Dr. Vidal",
      destino: { fecha: "2026-10-21", inicio: m("10:30"), profesionalId: "vidal" },
    });
    expect(v).toMatchObject({ ok: false, motivo: "fuera-de-horario" });
    expect(!v.ok && v.mensaje).toContain("Dr. Vidal (11:00–19:00)");
  });

  it("solo se mueven citas por confirmar o confirmadas", () => {
    expect(esMovible({ estado: "tentativa" })).toBe(true);
    expect(esMovible({ estado: "confirmada" })).toBe(true);
    for (const estado of ["en-sala", "finalizada", "ausente"] as const) {
      expect(esMovible({ estado })).toBe(false);
      const v = validarDestino({
        ...base,
        cita: cita({ estado }),
        destino: { fecha: "2026-10-21", inicio: m("11:30"), profesionalId: "rojas" },
      });
      expect(v).toMatchObject({ ok: false, motivo: "estado" });
    }
  });
});

describe("teclado: Alt + flechas", () => {
  const carriles = [
    { fecha: "2026-10-21", profesionalId: "rojas" },
    { fecha: "2026-10-21", profesionalId: "vidal" },
    { fecha: "2026-10-21", profesionalId: "fuentes" },
  ];
  const rango = { desde: 0, hasta: 12 * 60 };

  it("arriba y abajo mueven 15 minutos", () => {
    expect(destinoPorTeclado(cita(), "ArrowDown", carriles, rango)).toEqual({
      fecha: "2026-10-21",
      inicio: m("10:45"),
      profesionalId: "rojas",
    });
    expect(destinoPorTeclado(cita(), "ArrowUp", carriles, rango)?.inicio).toBe(m("10:15"));
  });

  it("los lados cambian de profesional (carril vecino)", () => {
    expect(destinoPorTeclado(cita(), "ArrowRight", carriles, rango)?.profesionalId).toBe("vidal");
    expect(destinoPorTeclado(cita(), "ArrowLeft", carriles, rango)).toBeNull();
    expect(
      destinoPorTeclado(cita({ profesionalId: "fuentes" }), "ArrowRight", carriles, rango),
    ).toBeNull();
  });

  it("no sale de la grilla y otras teclas no hacen nada", () => {
    expect(destinoPorTeclado(cita({ inicio: 0 }), "ArrowUp", carriles, rango)).toBeNull();
    expect(destinoPorTeclado(cita(), "Enter", carriles, rango)).toBeNull();
  });
});

describe("payload, cola y textos", () => {
  it("el destino viaja como hora de pared 'YYYY-MM-DDTHH:mm' y se lee de vuelta", () => {
    const destino = { fecha: "2026-10-21", inicio: m("11:30"), profesionalId: "vidal" };
    expect(startsAtDe(destino)).toBe("2026-10-21T11:30");
    expect(payloadDeMovimiento("clin-1", "c1", destino)).toEqual({
      appointmentId: "c1",
      clinicId: "clin-1",
      professionalId: "vidal",
      startsAt: "2026-10-21T11:30",
    });
    expect(destinoDeStartsAt("2026-10-21T11:30")).toEqual({
      fecha: "2026-10-21",
      inicio: 11 * 60 + 30 - HORA_INICIO * 60,
    });
    expect(destinoDeStartsAt("basura")).toBeNull();
  });

  it("pinta en su destino solo los movimientos pendientes de la cola", () => {
    const citas = [cita(), cita({ id: "c2", inicio: m("15:00") })];
    const items = [
      {
        kind: "reprogramar-cita",
        estado: "pendiente",
        payload: payloadDeMovimiento("k", "c1", {
          fecha: "2026-10-22",
          inicio: m("09:00"),
          profesionalId: "vidal",
        }),
      },
      {
        kind: "reprogramar-cita",
        estado: "fallido",
        payload: payloadDeMovimiento("k", "c2", {
          fecha: "2026-10-22",
          inicio: m("09:00"),
          profesionalId: "vidal",
        }),
      },
      { kind: "crear-cita", estado: "pendiente", payload: { appointmentId: "c2" } },
    ];
    const { citas: pintadas, enCola } = aplicarMovimientosPendientes(citas, items);
    expect(pintadas[0]).toMatchObject({
      fecha: "2026-10-22",
      inicio: m("09:00"),
      profesionalId: "vidal",
    });
    expect(pintadas[1]).toBe(citas[1]);
    expect([...enCola]).toEqual(["c1"]);
    // Sin movimientos devuelve la misma lista (no re-renderiza la grilla).
    expect(aplicarMovimientosPendientes(citas, []).citas).toBe(citas);
  });

  it("la frase del aviso dice paciente, día, hora y, si cambió, el profesional", () => {
    expect(
      fraseDeMovimiento({
        paciente: "Martina Soto",
        destino: { fecha: "2026-10-21", inicio: m("11:30") },
        nombreProfesional: "Dra. Rojas",
        cambioProfesional: true,
      }),
    ).toBe("Cita de Martina Soto movida al mié 21 oct a las 11:30 con Dra. Rojas.");
    expect(
      fraseDeMovimiento({
        paciente: "Martina Soto",
        destino: { fecha: "2026-10-21", inicio: m("11:30") },
        nombreProfesional: "Dra. Rojas",
        cambioProfesional: false,
      }),
    ).toBe("Cita de Martina Soto movida al mié 21 oct a las 11:30.");
  });
});

describe("servidor: la colación también vale en validarHorarioYSolapamiento", () => {
  const bloques = [
    { inicio: "09:00", fin: "13:00" },
    { inicio: "14:00", fin: "18:00" },
  ];

  it("una cita de la tarde entra en el segundo bloque (antes se miraba solo el primero)", () => {
    expect(citaCabeEnBloques("15:00", "16:00", bloques)).toBe(true);
    expect(citaCabeEnBloques("09:00", "13:00", bloques)).toBe(true);
  });

  it("una cita que pisa la colación o se sale del horario no entra", () => {
    expect(citaCabeEnBloques("12:30", "13:30", bloques)).toBe(false);
    expect(citaCabeEnBloques("17:30", "18:30", bloques)).toBe(false);
    expect(citaCabeEnBloques("08:30", "09:30", bloques)).toBe(false);
  });

  it("bloques contiguos cuentan como uno", () => {
    expect(
      citaCabeEnBloques("12:30", "13:30", [
        { inicio: "13:00", fin: "18:00" },
        { inicio: "09:00", fin: "13:00" },
      ]),
    ).toBe(true);
  });
});
